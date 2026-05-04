// Deep backfill: for each configured channel, paginate backwards through
// history until either the configured floor date is reached OR the runtime
// budget is exhausted (designed to fit inside GitHub Actions' 6h job
// timeout). Every page is committed as it completes, and the channel's
// progress is persisted in scrape_state.backfill_cursor — so re-running
// the workflow picks up exactly where the previous run left off.
//
// Tunables (env):
//   BACKFILL_STOP_DATE       ISO date floor (default 2023-01-01)
//   BACKFILL_START_BEFORE    optional snowflake to seed channels with no
//                            existing backfill_cursor (default: now)
//   BACKFILL_REDO_ALL        true/1/yes = ignore stored cursors and start
//                            from now, so old rows are rechecked/repaired.
//   MAX_PAGES_PER_CHANNEL    cap pages per channel per run (default 1000)
//   MAX_RUNTIME_MINUTES      bail out after this many minutes elapsed
//                            (default 340 — leaves 20m of buffer under
//                            GitHub Actions' 360m limit)
//   HUMAN_BASE_MS, HUMAN_JITTER_MS, etc. — see rate-limit.ts

import { eq } from 'drizzle-orm';
import { configuredChannels, isPlaceholder, CHANNELS, type ChannelConfig } from './lib/channels';
import { ensureScrapeStateRow, scrapeChannel } from './lib/scrape-channel';
import { startSyncLog } from './lib/sync-log';
import { dateToSnowflake, snowflakeToDate } from './lib/snowflake';
import { db, schema, pool } from './lib/db';

const STOP_DATE = new Date(process.env.BACKFILL_STOP_DATE ?? '2023-01-01');
const STOP_SNOWFLAKE = dateToSnowflake(STOP_DATE);
const MAX_PAGES = Math.max(1, parseInt(process.env.MAX_PAGES_PER_CHANNEL ?? '1000', 10));
const MAX_RUNTIME_MS = Math.max(60, parseInt(process.env.MAX_RUNTIME_MINUTES ?? '340', 10)) * 60_000;
const START_BEFORE_OVERRIDE = process.env.BACKFILL_START_BEFORE ?? null;
const REDO_ALL = /^(1|true|yes)$/i.test(process.env.BACKFILL_REDO_ALL ?? '');

const startedAt = Date.now();
function elapsedMs() { return Date.now() - startedAt; }
function elapsedMin() { return Math.floor(elapsedMs() / 60_000); }
function budgetExpired() { return elapsedMs() >= MAX_RUNTIME_MS; }

async function loadCursor(channel: ChannelConfig): Promise<string | null> {
  // 1) explicit env override
  if (START_BEFORE_OVERRIDE) return START_BEFORE_OVERRIDE;
  // 2) explicit redo: ignore persisted cursor and re-walk from now.
  if (REDO_ALL) return dateToSnowflake(new Date());
  // 3) prior persisted backfill cursor
  const [row] = await db
    .select({ cursor: schema.scrapeState.backfillCursor })
    .from(schema.scrapeState)
    .where(eq(schema.scrapeState.channelId, channel.id))
    .limit(1);
  if (row?.cursor) return row.cursor;
  // 4) fall back to oldest known media row for this channel — handles
  //    channels that were partially backfilled before this column existed.
  const oldest = await db
    .select({ id: schema.media.discordMessageId })
    .from(schema.media)
    .where(eq(schema.media.discordChannelId, channel.id))
    .orderBy(schema.media.discordMessageId)
    .limit(1);
  if (oldest[0]?.id) return oldest[0].id;
  // 5) brand-new channel — start at "now" and walk back
  return dateToSnowflake(new Date());
}

async function saveCursor(channel: ChannelConfig, cursor: string): Promise<void> {
  await db
    .update(schema.scrapeState)
    .set({ backfillCursor: cursor, lastRunAt: new Date() })
    .where(eq(schema.scrapeState.channelId, channel.id));
}

async function main() {
  if (Number.isNaN(STOP_DATE.getTime())) {
    console.error(`BACKFILL_STOP_DATE is not a valid date: ${process.env.BACKFILL_STOP_DATE}`);
    await pool.end();
    process.exit(2);
  }

  console.log(`[deep-backfill] floor       = ${STOP_DATE.toISOString()} (snowflake ${STOP_SNOWFLAKE})`);
  console.log(`[deep-backfill] max pages   = ${MAX_PAGES} per channel`);
  console.log(`[deep-backfill] max runtime = ${MAX_RUNTIME_MS / 60_000} min`);
  console.log(`[deep-backfill] redo all    = ${REDO_ALL ? 'yes' : 'no'}`);

  const placeholders = CHANNELS.filter((c) => isPlaceholder(c.id));
  if (placeholders.length > 0) {
    console.warn(`[deep-backfill] skipping unconfigured: ${placeholders.map((c) => c.name).join(', ')}`);
  }
  const channels = configuredChannels();
  if (channels.length === 0) {
    console.error('[deep-backfill] no channels configured');
    await pool.end();
    process.exit(0);
  }

  const log = await startSyncLog('backfill', `deep_until=${STOP_DATE.toISOString()}`);
  let grandAdded = 0;
  let grandQueued = 0;
  let grandErrors = 0;
  const notes: string[] = [];

  for (const channel of channels) {
    if (budgetExpired()) {
      notes.push(`#${channel.name}: skipped (runtime budget hit before start)`);
      continue;
    }

    await ensureScrapeStateRow(channel);
    let cursor = await loadCursor(channel);
    const startCursorDate = cursor ? snowflakeToDate(cursor) : null;
    console.log(
      `[deep-backfill] === #${channel.name} ${REDO_ALL ? 'redo' : 'resume'} cursor=${cursor} (≈${startCursorDate?.toISOString() ?? 'unknown'})`,
    );

    let pages = 0;
    let added = 0;
    let queued = 0;
    let stopReason = 'budget';

    while (pages < MAX_PAGES) {
      if (budgetExpired()) { stopReason = 'budget'; break; }
      if (!cursor) { stopReason = 'no_cursor'; break; }
      if (cursor <= STOP_SNOWFLAKE) { stopReason = 'floor'; break; }

      const result = await scrapeChannel(channel, {
        before: cursor,
        // Use 100 messages per inner-loop call so we checkpoint after every
        // single Discord page. Fine-grained progress = clean resume.
        perRunMessageCap: 100,
      });

      pages++;
      added += result.itemsAdded;
      queued += result.youtubeQueued;

      if (result.status === 'no_access') { stopReason = 'no_access'; break; }
      if (result.status === 'rate_limited') {
        // The inner client already slept for retry_after. Re-run the same
        // cursor next iteration; don't advance.
        console.warn(`[deep-backfill] #${channel.name} rate-limited mid-page, retrying`);
        continue;
      }
      if (result.status === 'error') {
        grandErrors++;
        notes.push(`#${channel.name} page ${pages}: error ${result.error?.slice(0, 80) ?? ''}`);
        stopReason = 'error';
        break;
      }
      if (result.messagesProcessed === 0 || !result.lowestMessageId) {
        stopReason = 'channel_exhausted';
        break;
      }

      cursor = result.lowestMessageId;
      const oldestDate = snowflakeToDate(cursor);
      // Persist after every page so a kill/timeout never loses progress.
      await saveCursor(channel, cursor);

      console.log(
        `[deep-backfill] #${channel.name} page=${pages} added=${result.itemsAdded} ytq=${result.youtubeQueued} oldest=${oldestDate.toISOString()} elapsed=${elapsedMin()}m`,
      );

      if (oldestDate < STOP_DATE) { stopReason = 'floor_crossed'; break; }
    }

    grandAdded += added;
    grandQueued += queued;
    notes.push(`#${channel.name}: mode=${REDO_ALL ? 'redo' : 'resume'} pages=${pages} added=${added} ytq=${queued} stop=${stopReason}`);
  }

  await log.finish({
    itemsAdded: grandAdded,
    errors: grandErrors,
    notes: `mode=${REDO_ALL ? 'redo' : 'resume'} floor=${STOP_DATE.toISOString()} elapsed=${elapsedMin()}m | ${notes.join(' | ')}`.slice(
      0,
      1000,
    ),
  });
  console.log(
    `[deep-backfill] DONE elapsed=${elapsedMin()}m added=${grandAdded} ytq=${grandQueued} errors=${grandErrors}`,
  );
  await pool.end();
  // Exit 0 when we hit the runtime budget — that's a clean partial run, not
  // a failure. The next workflow run will resume from the persisted cursor.
  process.exit(grandErrors > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[deep-backfill] fatal:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
