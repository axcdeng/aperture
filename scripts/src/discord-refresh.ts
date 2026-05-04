// Workflow B: Refresh signed Discord CDN URLs that are about to expire.
//
// Strategy: use Discord's POST /attachments/refresh-urls endpoint, which
// accepts up to 50 URLs per call and returns freshly-signed counterparts.
// This is the only viable approach for user-token clients — the per-message
// lookup (GET /channels/.../messages/{id}) is bot-only and returns 403.
//
// We refresh both `cdn_url` (full-res) and `cdn_thumb_url` (proxy) per row.
// Rows whose URLs don't come back in the response are left alone — we don't
// soft-delete on a missing-from-response, since that signal is ambiguous
// (could be expired link, could be transient API hiccup).

import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { db, schema, pool } from './lib/db';
import { parseCdnExpiry, refreshAttachmentUrls } from './lib/discord-api';
import { startSyncLog } from './lib/sync-log';
import { GiveUpError, RateLimitError } from './lib/rate-limit';

const BATCH = 50;

async function main() {
  const log = await startSyncLog('discord_refresh');
  let refreshed = 0;
  let errors = 0;
  const notes: string[] = [];

  const horizon = new Date(Date.now() + 12 * 3600 * 1000);

  const rows = await db
    .select({
      id: schema.media.id,
      cdnUrl: schema.media.cdnUrl,
      cdnThumbUrl: schema.media.cdnThumbUrl,
    })
    .from(schema.media)
    .where(
      and(
        eq(schema.media.source, 'discord'),
        isNull(schema.media.deletedAt),
        // Refresh anything expiring within the horizon, OR any row whose
        // expiry was never parsed (cdn_expires_at IS NULL). Otherwise NULL
        // rows would never get refreshed and the proxy would keep re-doing
        // the work on every render.
        or(
          lt(schema.media.cdnExpiresAt, horizon),
          isNull(schema.media.cdnExpiresAt),
        ),
      ),
    );

  console.log(`[refresh] ${rows.length} candidate rows (expiring within 12h)`);

  // Build a unique URL → row(s) map. The same URL can appear in multiple
  // rows (e.g. multi-team reveals share an attachment).
  const urlToRowIds = new Map<string, string[]>();
  for (const r of rows) {
    for (const u of [r.cdnUrl, r.cdnThumbUrl]) {
      if (!u) continue;
      const arr = urlToRowIds.get(u) ?? [];
      arr.push(r.id);
      urlToRowIds.set(u, arr);
    }
  }

  const allUrls = Array.from(urlToRowIds.keys());
  console.log(`[refresh] ${allUrls.length} unique URLs to refresh`);

  for (let i = 0; i < allUrls.length; i += BATCH) {
    const slice = allUrls.slice(i, i + BATCH);
    let map: Map<string, string>;
    try {
      map = await refreshAttachmentUrls(slice);
    } catch (e) {
      errors++;
      if (e instanceof RateLimitError) {
        notes.push(`rate-limited at batch ${i}`);
        console.warn('[refresh] rate-limited, stopping early.');
        break;
      }
      const msg = e instanceof GiveUpError ? e.message : (e as Error).message ?? String(e);
      console.error(`[refresh] batch ${i} error: ${msg}`);
      notes.push(`batch err: ${msg.slice(0, 80)}`);
      continue;
    }

    for (const [originalUrl, freshUrl] of map.entries()) {
      const expires = parseCdnExpiry(freshUrl);
      // Update any column that currently holds the original URL.
      const r1 = await db
        .update(schema.media)
        .set({ cdnUrl: freshUrl, cdnExpiresAt: expires })
        .where(
          and(eq(schema.media.cdnUrl, originalUrl), isNull(schema.media.deletedAt)),
        )
        .returning({ id: schema.media.id });
      const r2 = await db
        .update(schema.media)
        .set({ cdnThumbUrl: freshUrl })
        .where(
          and(eq(schema.media.cdnThumbUrl, originalUrl), isNull(schema.media.deletedAt)),
        )
        .returning({ id: schema.media.id });
      refreshed += r1.length + r2.length;
    }
  }

  await log.finish({
    itemsRefreshed: refreshed,
    errors,
    notes: `refreshed=${refreshed} ${notes.join(' | ')}`.slice(0, 1000),
  });
  console.log(`[refresh] DONE. refreshed=${refreshed} errors=${errors}`);
  await pool.end();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[refresh] unhandled error:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
