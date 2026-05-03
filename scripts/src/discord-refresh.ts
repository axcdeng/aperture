// Workflow B: Refresh signed Discord CDN URLs that are about to expire.
//
// Strategy:
//   1. Find media rows where source='discord' AND deletedAt IS NULL AND
//      cdn_expires_at < NOW() + 12h.
//   2. Group by (channel_id, message_id). One Discord call per unique message.
//   3. Update every row whose attachment_id appears in the fresh response.
//   4. If the message returned 404, soft-delete every row tied to it.
//   5. If a specific attachment is missing from a fresh message, soft-delete
//      that single row.

import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { db, schema } from './lib/db';
import { fetchMessage, parseCdnExpiry } from './lib/discord-api';
import { startSyncLog } from './lib/sync-log';
import { pool } from './lib/db';
import { GiveUpError, RateLimitError } from './lib/rate-limit';

async function main() {
  const log = await startSyncLog('discord_refresh');
  let refreshed = 0;
  let softDeleted = 0;
  let errors = 0;
  const notes: string[] = [];

  const horizon = new Date(Date.now() + 12 * 3600 * 1000);

  const rows = await db
    .select({
      id: schema.media.id,
      channelId: schema.media.discordChannelId,
      messageId: schema.media.discordMessageId,
      attachmentId: schema.media.discordAttachmentId,
    })
    .from(schema.media)
    .where(
      and(
        eq(schema.media.source, 'discord'),
        isNull(schema.media.deletedAt),
        lt(schema.media.cdnExpiresAt, horizon),
      ),
    );

  console.log(`[refresh] ${rows.length} candidate rows (expiring within 12h)`);

  // Group by (channel_id, message_id)
  const groups = new Map<string, { channelId: string; messageId: string; attachmentIds: string[] }>();
  for (const r of rows) {
    if (!r.channelId || !r.messageId || !r.attachmentId) continue;
    const key = `${r.channelId}::${r.messageId}`;
    const existing = groups.get(key);
    if (existing) existing.attachmentIds.push(r.attachmentId);
    else
      groups.set(key, {
        channelId: r.channelId,
        messageId: r.messageId,
        attachmentIds: [r.attachmentId],
      });
  }

  console.log(`[refresh] ${groups.size} unique messages to fetch`);

  for (const { channelId, messageId, attachmentIds } of groups.values()) {
    try {
      const msg = await fetchMessage(channelId, messageId);

      if (!msg) {
        // Message was deleted from Discord. Soft-delete all rows tied to it.
        const result = await db
          .update(schema.media)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(schema.media.discordChannelId, channelId),
              eq(schema.media.discordMessageId, messageId),
              isNull(schema.media.deletedAt),
            ),
          )
          .returning({ id: schema.media.id });
        softDeleted += result.length;
        console.log(`[refresh] message ${messageId} 404 — soft-deleted ${result.length} rows`);
        continue;
      }

      const freshById = new Map(msg.attachments.map((a) => [a.id, a]));
      for (const attId of attachmentIds) {
        const att = freshById.get(attId);
        if (!att) {
          // Attachment removed from message (rare). Soft-delete just this row.
          const r = await db
            .update(schema.media)
            .set({ deletedAt: new Date() })
            .where(
              and(
                eq(schema.media.discordChannelId, channelId),
                eq(schema.media.discordMessageId, messageId),
                eq(schema.media.discordAttachmentId, attId),
                isNull(schema.media.deletedAt),
              ),
            )
            .returning({ id: schema.media.id });
          softDeleted += r.length;
          continue;
        }

        const expiresAt = parseCdnExpiry(att.url);
        const r = await db
          .update(schema.media)
          .set({
            cdnUrl: att.url,
            cdnThumbUrl: att.proxy_url ?? att.url,
            cdnExpiresAt: expiresAt,
          })
          .where(
            and(
              eq(schema.media.discordChannelId, channelId),
              eq(schema.media.discordMessageId, messageId),
              eq(schema.media.discordAttachmentId, attId),
              isNull(schema.media.deletedAt),
            ),
          )
          .returning({ id: schema.media.id });
        refreshed += r.length;
      }
    } catch (e) {
      errors++;
      if (e instanceof RateLimitError) {
        notes.push(`rate-limited at ${messageId}: ${e.message}`);
        console.warn(`[refresh] rate-limited at ${messageId}, stopping early.`);
        break;
      }
      const msg = e instanceof GiveUpError ? e.message : (e as Error).message ?? String(e);
      console.error(`[refresh] error refreshing ${messageId}: ${msg}`);
      notes.push(`err ${messageId}: ${msg.slice(0, 80)}`);
    }
  }

  await log.finish({
    itemsRefreshed: refreshed,
    errors,
    notes: `refreshed=${refreshed} softDeleted=${softDeleted} ${notes.join(' | ')}`.slice(0, 1000),
  });
  console.log(`[refresh] DONE. refreshed=${refreshed} softDeleted=${softDeleted} errors=${errors}`);
  await pool.end();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[refresh] unhandled error:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});

// Silence unused-import lint
void sql;
