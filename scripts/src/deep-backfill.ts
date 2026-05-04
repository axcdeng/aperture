// Deep backfill: for each configured channel, paginate backwards through
// history until the next page would be older than a date floor (default
// 2023-01-01 UTC). Designed to be run ONCE locally — it can take hours
// because of human-paced delays. Resume-safe: every batch commits its rows
// before moving to the next.
//
// Run:
//   cd scripts
//   BACKFILL_STOP_DATE=2023-01-01 npm run deep-backfill
//
// Optional env:
//   BACKFILL_STOP_DATE     ISO date the walker stops at (default 2023-01-01)
//   BACKFILL_START_BEFORE  optional snowflake to start from per channel.
//                          If unset, starts from "now" (current time).
//   MAX_PAGES_PER_CHANNEL  safety cap — pages, not messages (default 1000)
//
// You can interrupt with Ctrl-C; the next run resumes from where the
// channel's oldest-seen message left off (we read scrape_state internally
// and pick up there if BACKFILL_START_BEFORE isn't set).

import { configuredChannels, isPlaceholder, CHANNELS } from './lib/channels';
import { ensureScrapeStateRow, scrapeChannel } from './lib/scrape-channel';
import { startSyncLog } from './lib/sync-log';
import { dateToSnowflake, snowflakeToDate } from './lib/snowflake';
import { db, schema, pool } from './lib/db';
import { eq } from 'drizzle-orm';

interface ChannelProgress {
  oldestSnowflake: string | null;
}

// Track per-channel progress in memory only — DB persistence isn't needed
// since we reread the channel's oldest scraped row on each fresh start.
async function getResumeSnowflake(channelId: string): Promise<string | null> {
  // The smallest discord_message_id we've already inserted for this channel.
  // If found, we resume `before` that snowflake to keep walking older.
  const row = await db
    .select({ id: schema.media.discordMessageId })
    .from(schema.media)
    .where(eq(schema.media.discordChannelId, channelId))
    .orderBy(schema.media.discordMessageId)
    .limit(1);
  return row[0]?.id ?? null;
}

async function main() {
  const stopDateStr = process.env.BACKFILL_STOP_DATE ?? '2023-01-01';
  const stopDate = new Date(stopDateStr);
  if (Number.isNaN(stopDate.getTime())) {
    console.error(`BACKFILL_STOP_DATE is not a valid date: ${stopDateStr}`);
    await pool.end();
    process.exit(2);
  }
  const stopSnowflake = dateToSnowflake(stopDate);
  const maxPages = parseInt(process.env.MAX_PAGES_PER_CHANNEL ?? '1000', 10);
  const startBeforeOverride = process.env.BACKFILL_START_BEFORE;

  console.log(`[deep-backfill] floor = ${stopDate.toISOString()} (snowflake ${stopSnowflake})`);
  console.log(`[deep-backfill] max pages per channel = ${maxPages}`);

  const placeholders = CHANNELS.filter((c) => isPlaceholder(c.id));
  if (placeholders.length > 0) {
    console.warn(
      `[deep-backfill] skipping unconfigured: ${placeholders.map((c) => c.name).join(', ')}`,
    );
  }
  const channels = configuredChannels();
  if (channels.length === 0) {
    console.error('[deep-backfill] No channels configured.');
    await pool.end();
    process.exit(0);
  }

  const log = await startSyncLog('backfill', `deep until ${stopDate.toISOString()}`);
  let grandAdded = 0;
  let grandQueued = 0;
  let grandErrors = 0;
  const notes: string[] = [];

  for (const channel of channels) {
    await ensureScrapeStateRow(channel);

    // Pick a starting "before" cursor: explicit override → channel's
    // oldest stored message → "now" (i.e. start from the most recent message).
    let cursor: string | null = startBeforeOverride ?? null;
    if (!cursor) cursor = await getResumeSnowflake(channel.id);
    if (!cursor) cursor = dateToSnowflake(new Date());

    const startedAt = snowflakeToDate(cursor);
    console.log(
      `[deep-backfill] === #${channel.name} starting at cursor=${cursor} (≈${startedAt.toISOString()})`,
    );

    let pagesThisChannel = 0;
    let addedThisChannel = 0;
    let queuedThisChannel = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (pagesThisChannel >= maxPages) {
        notes.push(`#${channel.name}: hit MAX_PAGES_PER_CHANNEL (${maxPages})`);
        break;
      }
      // Refuse to fetch a page whose `before` cursor is already older than
      // the floor — saves an API call and keeps the walker honest.
      if (cursor && cursor <= stopSnowflake) {
        notes.push(`#${channel.name}: cursor reached floor`);
        break;
      }

      const result = await scrapeChannel(channel, {
        before: cursor!,
        // Process pages incrementally — 100 messages per scrapeChannel call
        // (the inner loop's PAGE_SIZE) means we can checkpoint between
        // batches and watch progress in real time.
        perRunMessageCap: 100,
      });

      pagesThisChannel++;
      addedThisChannel += result.itemsAdded;
      queuedThisChannel += result.youtubeQueued;

      if (result.status === 'no_access') {
        notes.push(`#${channel.name}: no_access — skipping`);
        break;
      }
      if (result.status !== 'ok' && result.status !== 'rate_limited') {
        grandErrors++;
        notes.push(
          `#${channel.name} page ${pagesThisChannel}: status=${result.status} ${result.error ?? ''}`,
        );
        break;
      }

      if (result.messagesProcessed === 0 || !result.lowestMessageId) {
        notes.push(`#${channel.name}: reached oldest message in channel`);
        break;
      }

      const oldestDate = snowflakeToDate(result.lowestMessageId);
      console.log(
        `[deep-backfill] #${channel.name} page ${pagesThisChannel}: msgs=${result.messagesProcessed} added=${result.itemsAdded} ytq=${result.youtubeQueued} oldest=${oldestDate.toISOString()}`,
      );

      if (oldestDate < stopDate) {
        notes.push(`#${channel.name}: crossed floor at ${oldestDate.toISOString()}`);
        break;
      }

      cursor = result.lowestMessageId;

      if (result.status === 'rate_limited') {
        // scrapeChannel already slept inside its 429 path; back off another
        // 30s here for good measure.
        console.warn(`[deep-backfill] rate-limited on #${channel.name}, sleeping 30s`);
        await new Promise((r) => setTimeout(r, 30000));
      }
    }

    grandAdded += addedThisChannel;
    grandQueued += queuedThisChannel;
    notes.push(
      `#${channel.name}: pages=${pagesThisChannel} added=${addedThisChannel} ytq=${queuedThisChannel}`,
    );
  }

  await log.finish({
    itemsAdded: grandAdded,
    errors: grandErrors,
    notes: `floor=${stopDate.toISOString()} | ${notes.join(' | ')}`.slice(0, 1000),
  });
  console.log(
    `[deep-backfill] DONE. items_added=${grandAdded} youtube_queued=${grandQueued} errors=${grandErrors}`,
  );
  await pool.end();
  process.exit(grandErrors > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[deep-backfill] fatal:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
