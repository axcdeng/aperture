// Workflow A: Forward-paginate every configured Discord channel and ingest
// new attachments + queue YouTube links for enrichment.

import { configuredChannels, isPlaceholder, CHANNELS } from './lib/channels';
import {
  ensureScrapeStateRow,
  loadCursor,
  saveCursor,
  scrapeChannel,
} from './lib/scrape-channel';
import { startSyncLog } from './lib/sync-log';
import { pool } from './lib/db';

async function main() {
  const placeholders = CHANNELS.filter((c) => isPlaceholder(c.id));
  if (placeholders.length > 0) {
    console.warn(
      `[scrape] ${placeholders.length} channel(s) still have <TODO_CHANNEL_ID> placeholders: ${placeholders.map((c) => c.name).join(', ')}.`,
    );
    console.warn('[scrape] Skipping those. Fill in the IDs in scripts/src/lib/channels.ts.');
  }

  const channels = configuredChannels();
  if (channels.length === 0) {
    console.error('[scrape] No channels configured. Nothing to do.');
    await pool.end();
    process.exit(0);
  }

  const log = await startSyncLog('discord_scrape');
  let totalAdded = 0;
  let totalQueued = 0;
  let totalErrors = 0;
  const notes: string[] = [];

  for (const channel of channels) {
    try {
      await ensureScrapeStateRow(channel);
      const cursor = await loadCursor(channel.id);
      const result = await scrapeChannel(channel, { after: cursor ?? undefined });
      await saveCursor(channel, result, 'forward');
      totalAdded += result.itemsAdded;
      totalQueued += result.youtubeQueued;
      // 'no_access' is an expected, non-fatal state (channel is role-gated for
      // the throwaway). Don't count it toward totalErrors so the workflow run
      // stays green when only that channel is blocked.
      if (result.status !== 'ok' && result.status !== 'no_access') totalErrors++;
      notes.push(
        `#${channel.name}: msgs=${result.messagesProcessed} added=${result.itemsAdded} ytq=${result.youtubeQueued} status=${result.status}${result.error ? ' err=' + result.error.slice(0, 80) : ''}`,
      );
    } catch (err) {
      totalErrors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[scrape] fatal on ${channel.name}: ${msg}`);
      notes.push(`#${channel.name}: FATAL ${msg.slice(0, 120)}`);
    }
  }

  await log.finish({
    itemsAdded: totalAdded,
    errors: totalErrors,
    notes: notes.join(' | '),
  });

  console.log(
    `[scrape] DONE. items_added=${totalAdded} youtube_queued=${totalQueued} errors=${totalErrors}`,
  );
  await pool.end();
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[scrape] unhandled error:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
