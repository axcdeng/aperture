// Backwards-paginating scraper for one-shot historical imports.
// Triggered manually via the discord-scrape workflow with the
// `backfill_before_message_id` input set.
//
// Reads BACKFILL_BEFORE_MESSAGE_ID from env. If unset, errors out.
//
// IMPORTANT: this NEVER advances scrape_state.last_synced_message_id — that
// belongs to the routine forward scraper. Backfill only inserts media rows
// older than the cursor and updates scrape_state.last_run_at/status.

import { configuredChannels, isPlaceholder, CHANNELS } from './lib/channels';
import {
  ensureScrapeStateRow,
  saveCursor,
  scrapeChannel,
} from './lib/scrape-channel';
import { startSyncLog } from './lib/sync-log';
import { pool } from './lib/db';

async function main() {
  const cursor = process.env.BACKFILL_BEFORE_MESSAGE_ID;
  if (!cursor) {
    console.error(
      'BACKFILL_BEFORE_MESSAGE_ID is not set. Run the discord-scrape workflow with the input filled in, or set the env var locally.',
    );
    await pool.end();
    process.exit(2);
  }

  const placeholders = CHANNELS.filter((c) => isPlaceholder(c.id));
  if (placeholders.length > 0) {
    console.warn(
      `[backfill] Skipping unconfigured channels: ${placeholders.map((c) => c.name).join(', ')}`,
    );
  }

  const channels = configuredChannels();
  if (channels.length === 0) {
    console.error('[backfill] No channels configured. Nothing to do.');
    await pool.end();
    process.exit(0);
  }

  const log = await startSyncLog('backfill', `before=${cursor}`);
  let totalAdded = 0;
  let totalQueued = 0;
  let totalErrors = 0;
  const notes: string[] = [];

  for (const channel of channels) {
    try {
      await ensureScrapeStateRow(channel);
      const result = await scrapeChannel(channel, { before: cursor });
      await saveCursor(channel, result, 'backward');
      totalAdded += result.itemsAdded;
      totalQueued += result.youtubeQueued;
      if (result.status !== 'ok') totalErrors++;
      notes.push(
        `#${channel.name}: msgs=${result.messagesProcessed} added=${result.itemsAdded} ytq=${result.youtubeQueued} status=${result.status} oldest=${result.lowestMessageId ?? '—'}`,
      );
    } catch (err) {
      totalErrors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[backfill] fatal on ${channel.name}: ${msg}`);
      notes.push(`#${channel.name}: FATAL ${msg.slice(0, 120)}`);
    }
  }

  await log.finish({
    itemsAdded: totalAdded,
    errors: totalErrors,
    notes: `before=${cursor} | ${notes.join(' | ')}`.slice(0, 1000),
  });
  console.log(
    `[backfill] DONE. items_added=${totalAdded} youtube_queued=${totalQueued} errors=${totalErrors}`,
  );
  console.log(
    '[backfill] Re-run with the `oldest=` value above as the next BACKFILL_BEFORE_MESSAGE_ID to continue paging further back.',
  );
  await pool.end();
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[backfill] unhandled error:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
