// R2 mirror: make a durable 720p WebP copy of every Discord image in
// Cloudflare R2, so the web app stops depending on Discord's signed CDN URLs
// (which expire ~24h and vanish entirely if the message is deleted).
//
// For each un-mirrored image row (r2_key IS NULL) it:
//   1. ensures the row's cdn_url is fresh (re-signs via Discord if expiring),
//   2. downloads the original bytes from the Discord CDN,
//   3. resizes to max 720px and re-encodes as WebP q80 with sharp,
//   4. uploads to R2 at thumbs/<media-id>.webp,
//   5. stamps media.r2_key + media.r2_mirrored_at.
//
// It walks newest-first with a keyset cursor (so each run makes forward
// progress and never loops on permanently-dead rows) and exits cleanly when
// the runtime budget is hit — the next run resumes from the newest still-null
// row. New items from the forward scraper are picked up automatically.
//
// Tunables (env):
//   MAX_RUNTIME_MINUTES   bail out after this many minutes (default 20)
//   R2_MIRROR_BATCH       rows fetched per DB page (default 50; ≤50 keeps the
//                         Discord refresh-urls call to a single request)

import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import sharp from 'sharp';
import { db, schema, pool } from './lib/db';
import { parseCdnExpiry, refreshAttachmentUrls } from './lib/discord-api';
import { startSyncLog } from './lib/sync-log';
import { uploadObject, thumbKey } from './lib/r2';
import { GiveUpError, RateLimitError } from './lib/rate-limit';

const MAX_RUNTIME_MS = Math.max(1, parseInt(process.env.MAX_RUNTIME_MINUTES ?? '20', 10)) * 60_000;
const BATCH = Math.min(50, Math.max(1, parseInt(process.env.R2_MIRROR_BATCH ?? '50', 10)));
const MAX_DIM = 720;
const WEBP_QUALITY = 80;
// Re-sign a row's CDN URL if it expires within this window (or has no expiry).
const REFRESH_HORIZON_MS = 60 * 60 * 1000;

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const startedAt = Date.now();
function elapsedMs() { return Date.now() - startedAt; }
function elapsedMin() { return Math.floor(elapsedMs() / 60_000); }
function budgetExpired() { return elapsedMs() >= MAX_RUNTIME_MS; }

interface Row {
  id: string;
  cdnUrl: string | null;
  cdnThumbUrl: string | null;
  cdnExpiresAt: Date | null;
  postedAt: Date;
}

type Cursor = { postedAt: Date; id: string } | null;

async function nextBatch(cursor: Cursor): Promise<Row[]> {
  const conds = [
    eq(schema.media.source, 'discord'),
    eq(schema.media.contentType, 'image'),
    isNull(schema.media.deletedAt),
    isNull(schema.media.r2Key),
  ];
  if (cursor) {
    conds.push(
      or(
        lt(schema.media.postedAt, cursor.postedAt),
        and(eq(schema.media.postedAt, cursor.postedAt), lt(schema.media.id, cursor.id)),
      )!,
    );
  }
  return db
    .select({
      id: schema.media.id,
      cdnUrl: schema.media.cdnUrl,
      cdnThumbUrl: schema.media.cdnThumbUrl,
      cdnExpiresAt: schema.media.cdnExpiresAt,
      postedAt: schema.media.postedAt,
    })
    .from(schema.media)
    .where(and(...conds))
    .orderBy(desc(schema.media.postedAt), desc(schema.media.id))
    .limit(BATCH);
}

// Re-sign any rows whose CDN URL is expiring/unknown, in one batched call.
// Mutates the rows' cdnUrl/cdnExpiresAt in place and persists the refresh.
async function refreshStale(rows: Row[]): Promise<void> {
  const now = Date.now();
  const stale = rows.filter(
    (r) => r.cdnUrl && (!r.cdnExpiresAt || r.cdnExpiresAt.getTime() - now < REFRESH_HORIZON_MS),
  );
  if (stale.length === 0) return;

  const urls = Array.from(new Set(stale.map((r) => r.cdnUrl!).filter(Boolean)));
  const fresh = await refreshAttachmentUrls(urls);
  if (fresh.size === 0) return;

  for (const r of stale) {
    const newUrl = r.cdnUrl ? fresh.get(r.cdnUrl) : undefined;
    if (!newUrl || newUrl === r.cdnUrl) continue;
    const expires = parseCdnExpiry(newUrl);
    r.cdnUrl = newUrl;
    r.cdnExpiresAt = expires;
    await db
      .update(schema.media)
      .set({ cdnUrl: newUrl, cdnExpiresAt: expires })
      .where(eq(schema.media.id, r.id));
  }
}

interface RowOutcome {
  // mirrored  = uploaded to R2
  // dead      = attachment permanently gone; soft-deleted so it's hidden + never retried
  // transient = temporary failure (stale signature we couldn't refresh, network, 5xx); retry next run
  // error     = unexpected failure (decode/upload); counts toward the run's exit code
  status: 'mirrored' | 'dead' | 'transient' | 'error';
  detail?: string;
}

async function markDeleted(id: string): Promise<void> {
  await db.update(schema.media).set({ deletedAt: new Date() }).where(eq(schema.media.id, id));
}

async function mirrorRow(row: Row): Promise<RowOutcome> {
  if (!row.cdnUrl) return { status: 'transient', detail: 'no cdn_url' };

  let res: Response;
  try {
    res = await fetch(row.cdnUrl, {
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent': CHROME_UA,
      },
    });
  } catch (e) {
    // Network/DNS blip — retry next run, don't soft-delete.
    return { status: 'transient', detail: `fetch: ${(e as Error).message?.slice(0, 80)}` };
  }
  if (!res.ok) {
    // A 404 means the attachment/message is gone from Discord — the path no
    // longer exists, so re-signing can't revive it. Permanent → soft-delete the
    // row to hide the broken image and stop retrying it forever.
    if (res.status === 404) {
      await markDeleted(row.id);
      return { status: 'dead', detail: 'http 404 (gone upstream → soft-deleted)' };
    }
    // A 403 means the signed URL is expired/rejected, not that the content is
    // gone — refreshStale() re-signs it on a later run. Treat 403 (and 5xx) as
    // transient and never soft-delete on that ambiguous signal.
    return { status: 'transient', detail: `http ${res.status}` };
  }

  const input = Buffer.from(await res.arrayBuffer());
  let webp: Buffer;
  try {
    webp = await sharp(input)
      .rotate() // honor EXIF orientation before stripping metadata
      .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch (e) {
    return { status: 'error', detail: `decode: ${(e as Error).message?.slice(0, 80)}` };
  }

  const key = thumbKey(row.id);
  await uploadObject(key, webp, 'image/webp');
  await db
    .update(schema.media)
    .set({ r2Key: key, r2MirroredAt: new Date() })
    .where(eq(schema.media.id, row.id));

  return { status: 'mirrored' };
}

async function main() {
  // Fail fast on missing R2 config before touching the DB or downloading anything.
  const missing = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].filter(
    (name) => !process.env[name],
  );
  if (missing.length > 0) {
    console.error(`[r2-mirror] missing required env: ${missing.join(', ')}`);
    await pool.end().catch(() => {});
    process.exit(2);
  }

  console.log(`[r2-mirror] max runtime = ${MAX_RUNTIME_MS / 60_000} min, batch = ${BATCH}`);

  const log = await startSyncLog('r2_mirror');
  let mirrored = 0;
  let dead = 0;
  let transient = 0;
  let errors = 0;
  let stopReason = 'done';
  let cursor: Cursor = null;

  outer: while (!budgetExpired()) {
    const rows = await nextBatch(cursor);
    if (rows.length === 0) { stopReason = 'done'; break; }

    try {
      await refreshStale(rows);
    } catch (e) {
      // Don't abort the whole run on a refresh hiccup — rows with still-valid
      // URLs proceed; rows left with a stale signature get a transient 403/404
      // below and are retried next run (never soft-deleted on an ambiguous signal).
      if (e instanceof RateLimitError) {
        stopReason = 'rate_limited';
        console.warn('[r2-mirror] rate-limited during refresh, stopping early.');
        break;
      }
      const msg = e instanceof GiveUpError ? e.message : (e as Error).message ?? String(e);
      console.warn(`[r2-mirror] refresh batch error (continuing): ${msg.slice(0, 120)}`);
    }

    for (const row of rows) {
      if (budgetExpired()) { stopReason = 'budget'; break outer; }
      try {
        const out = await mirrorRow(row);
        if (out.status === 'mirrored') mirrored++;
        else if (out.status === 'dead') { dead++; console.warn(`[r2-mirror] dead ${row.id}: ${out.detail}`); }
        else if (out.status === 'transient') { transient++; console.warn(`[r2-mirror] transient ${row.id}: ${out.detail}`); }
        else { errors++; console.error(`[r2-mirror] error ${row.id}: ${out.detail}`); }
      } catch (e) {
        errors++;
        console.error(`[r2-mirror] unexpected ${row.id}:`, (e as Error).message ?? e);
      }
    }

    // Advance the keyset cursor past this page so dead/transient/error rows
    // never block forward progress within a run.
    const last = rows[rows.length - 1];
    cursor = { postedAt: last.postedAt, id: last.id };
    console.log(
      `[r2-mirror] page done mirrored=${mirrored} dead=${dead} transient=${transient} errors=${errors} elapsed=${elapsedMin()}m`,
    );
  }
  if (budgetExpired() && stopReason === 'done') stopReason = 'budget';

  await log.finish({
    itemsAdded: mirrored,
    errors,
    notes: `mirrored=${mirrored} dead=${dead} transient=${transient} errors=${errors} stop=${stopReason} elapsed=${elapsedMin()}m`.slice(0, 1000),
  });
  console.log(
    `[r2-mirror] DONE mirrored=${mirrored} dead=${dead} transient=${transient} errors=${errors} stop=${stopReason} elapsed=${elapsedMin()}m`,
  );
  await pool.end();
  // Budget/rate-limit stops are clean partial runs, not failures.
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[r2-mirror] fatal:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
