// Core Discord channel-scrape loop. Used by both the routine scraper
// (forward pagination via after=cursor) and the backfill tool (backward
// pagination via before=).

import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from './db';
import {
  classifyContentType,
  fetchMessages,
  parseCdnExpiry,
  type DiscordMessage,
} from './discord-api';
import { extractTeams, extractYoutubeVideoIds } from './team-extraction';
import { seasonForDate } from './seasons';
import { GiveUpError, NoAccessError, RateLimitError } from './rate-limit';
import type { ChannelConfig } from './channels';

export interface ScrapeResult {
  channel: ChannelConfig;
  messagesProcessed: number;
  itemsAdded: number;
  youtubeQueued: number;
  status: 'ok' | 'rate_limited' | 'error' | 'no_access';
  error?: string;
  highestMessageId?: string;
  lowestMessageId?: string;
}

export interface ScrapeChannelOpts {
  perRunMessageCap?: number;
  // Forward pagination from this snowflake (used by the routine scraper).
  // Mutually exclusive with `before`.
  after?: string;
  // Backward pagination starting before this snowflake (used by backfill).
  before?: string;
}

const PAGE_SIZE = 100;
const DEFAULT_CAP = 5000;

export async function scrapeChannel(
  channel: ChannelConfig,
  opts: ScrapeChannelOpts = {},
): Promise<ScrapeResult> {
  const cap = opts.perRunMessageCap ?? DEFAULT_CAP;
  const direction: 'forward' | 'backward' = opts.before ? 'backward' : 'forward';
  let cursor = direction === 'forward' ? opts.after : opts.before;

  let processed = 0;
  let itemsAdded = 0;
  let youtubeQueued = 0;
  let highestMessageId: string | undefined;
  let lowestMessageId: string | undefined;

  console.log(
    `[scrape] channel=${channel.name} type=${channel.type} dir=${direction} cursor=${cursor ?? 'null'}`,
  );

  try {
    while (processed < cap) {
      const want = Math.min(PAGE_SIZE, cap - processed);
      const messages = await fetchMessages(
        channel.id,
        direction === 'forward' ? { after: cursor } : { before: cursor },
        want,
      );
      if (messages.length === 0) break;

      // Discord returns messages newest-first regardless of after/before.
      // For "after" we want to advance cursor to the highest id seen.
      // For "before" we want to advance to the lowest id seen.
      for (const msg of messages) {
        if (!highestMessageId || compareSnowflake(msg.id, highestMessageId) > 0)
          highestMessageId = msg.id;
        if (!lowestMessageId || compareSnowflake(msg.id, lowestMessageId) < 0)
          lowestMessageId = msg.id;
      }

      // Process each message
      for (const msg of messages) {
        const added = await processMessage(channel, msg);
        itemsAdded += added.itemsAdded;
        youtubeQueued += added.youtubeQueued;
        processed++;
      }

      cursor =
        direction === 'forward'
          ? highestMessageId
          : lowestMessageId;

      if (messages.length < want) break;
    }

    return {
      channel,
      messagesProcessed: processed,
      itemsAdded,
      youtubeQueued,
      status: 'ok',
      highestMessageId,
      lowestMessageId,
    };
  } catch (e) {
    if (e instanceof RateLimitError) {
      console.warn(`[scrape] rate-limited on ${channel.name}: ${e.message}`);
      return {
        channel,
        messagesProcessed: processed,
        itemsAdded,
        youtubeQueued,
        status: 'rate_limited',
        error: e.message,
        highestMessageId,
        lowestMessageId,
      };
    }
    if (e instanceof NoAccessError) {
      console.warn(`[scrape] no access to ${channel.name} — skipping (grant the throwaway a role to enable)`);
      return {
        channel,
        messagesProcessed: processed,
        itemsAdded,
        youtubeQueued,
        status: 'no_access',
        error: e.message,
        highestMessageId,
        lowestMessageId,
      };
    }
    if (e instanceof GiveUpError) {
      console.error(`[scrape] error on ${channel.name}: ${e.message}`);
      return {
        channel,
        messagesProcessed: processed,
        itemsAdded,
        youtubeQueued,
        status: 'error',
        error: e.message,
        highestMessageId,
        lowestMessageId,
      };
    }
    throw e;
  }
}

interface MessageProcessResult {
  itemsAdded: number;
  youtubeQueued: number;
}

async function processMessage(
  channel: ChannelConfig,
  msg: DiscordMessage,
): Promise<MessageProcessResult> {
  const youtubeIds = extractYoutubeVideoIds(msg.content ?? '');
  const attachments = msg.attachments ?? [];

  if (attachments.length === 0 && youtubeIds.length === 0) {
    return { itemsAdded: 0, youtubeQueued: 0 };
  }

  const posterNickname = msg.member?.nick ?? msg.author.display_name ?? msg.author.global_name ?? null;
  const posterUsername = msg.author.username;
  const teamsForMessage = extractTeams({
    channelType: channel.type,
    messageContent: msg.content,
    posterNickname: posterNickname ?? undefined,
    posterUsername,
  });

  let itemsAdded = 0;
  let youtubeQueued = 0;

  // 1) Attachments
  for (const att of attachments) {
    const contentType = classifyContentType(att);
    if (!contentType) continue;
    const expiresAt = parseCdnExpiry(att.url);
    const teams = teamsForMessage.length > 0 ? teamsForMessage : [null];
    const groupId = teamsForMessage.length > 1 ? nanoid(12) : null;

    for (const team of teams) {
      // Upsert the team FIRST so the media foreign key never references a
      // nonexistent team_number.
      if (team) await touchTeam(team, msg.timestamp);

      const id = nanoid(16);
      const inserted = await db
        .insert(schema.media)
        .values({
          id,
          teamNumber: team,
          seasonId: seasonForDate(msg.timestamp),
          source: 'discord',
          sourceChannel: channel.name,
          contentType,
          postedAt: new Date(msg.timestamp),
          title: msg.content?.slice(0, 240) || null,
          description: msg.content || null,
          authorDisplayName: posterNickname ?? posterUsername,
          width: att.width ?? null,
          height: att.height ?? null,
          durationSeconds: att.duration_secs ? Math.round(att.duration_secs) : null,
          multiTeamGroupId: groupId,
          discordChannelId: channel.id,
          discordMessageId: msg.id,
          discordAttachmentId: att.id,
          discordFilename: att.filename,
          cdnUrl: att.url,
          cdnThumbUrl: att.proxy_url ?? att.url,
          cdnExpiresAt: expiresAt,
        })
        .onConflictDoNothing({
          target: [
            schema.media.discordMessageId,
            schema.media.discordAttachmentId,
            schema.media.teamNumber,
          ],
        })
        .returning({ id: schema.media.id });
      if (inserted.length > 0) itemsAdded++;
    }
  }

  // 2) YouTube links → enrichment queue (do not create media rows here;
  //    Workflow C handles them).
  for (const videoId of youtubeIds) {
    const inserted = await db
      .insert(schema.youtubeEnrichmentQueue)
      .values({
        youtubeVideoId: videoId,
        discordSourceChannelId: channel.id,
        discordSourceMessageId: msg.id,
        discordAuthorDisplayName: posterNickname ?? posterUsername,
      })
      .onConflictDoNothing({ target: schema.youtubeEnrichmentQueue.youtubeVideoId })
      .returning({ id: schema.youtubeEnrichmentQueue.youtubeVideoId });
    if (inserted.length > 0) youtubeQueued++;
  }

  // 3) If the message has neither attachments-with-known-types nor YouTube
  //    links AND there's a team to tag, we still want one untagged-style row
  //    per spec ("if extractTeams returned empty array, insert one media row
  //    with team_number = null"). Per the spec this only applies when the
  //    message had attachments — i.e. step 2(e) under Section 7 — but
  //    extractTeams produced nothing. We've already handled that case in the
  //    attachments loop above (teamsForMessage.length === 0 → teams = [null]).

  return { itemsAdded, youtubeQueued };
}

async function touchTeam(teamNumber: string, postedAt: string): Promise<void> {
  const postedDate = new Date(postedAt);
  await db
    .insert(schema.teams)
    .values({
      teamNumber,
      firstSeenAt: postedDate,
      lastSeenAt: postedDate,
      mediaCount: 1,
    })
    .onConflictDoUpdate({
      target: schema.teams.teamNumber,
      set: {
        lastSeenAt: sql`greatest(${schema.teams.lastSeenAt}, ${postedDate})`,
        mediaCount: sql`${schema.teams.mediaCount} + 1`,
      },
    });
}

// Compare Discord snowflake IDs as bigints.
function compareSnowflake(a: string, b: string): number {
  const ai = BigInt(a);
  const bi = BigInt(b);
  if (ai < bi) return -1;
  if (ai > bi) return 1;
  return 0;
}

export async function loadCursor(channelId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(schema.scrapeState)
    .where(eq(schema.scrapeState.channelId, channelId))
    .limit(1);
  return row?.lastSyncedMessageId ?? null;
}

export async function ensureScrapeStateRow(channel: ChannelConfig): Promise<void> {
  await db
    .insert(schema.scrapeState)
    .values({
      channelId: channel.id,
      channelName: channel.name,
      lastRunStatus: 'pending',
      messagesSeenTotal: 0,
    })
    .onConflictDoNothing({ target: schema.scrapeState.channelId });
}

export async function saveCursor(
  channel: ChannelConfig,
  result: ScrapeResult,
  direction: 'forward' | 'backward',
): Promise<void> {
  const advancedTo =
    direction === 'forward' ? result.highestMessageId : result.lowestMessageId;
  // Only advance the routine "forward" cursor — backfill must NOT clobber it.
  if (direction === 'forward') {
    await db
      .update(schema.scrapeState)
      .set({
        lastSyncedMessageId: advancedTo ?? undefined,
        lastRunAt: new Date(),
        lastRunStatus: result.status,
        lastRunError: result.error ?? null,
        messagesSeenTotal: sql`${schema.scrapeState.messagesSeenTotal} + ${result.messagesProcessed}`,
      })
      .where(eq(schema.scrapeState.channelId, channel.id));
  } else {
    await db
      .update(schema.scrapeState)
      .set({
        lastRunAt: new Date(),
        lastRunStatus: result.status,
        lastRunError: result.error ?? null,
        messagesSeenTotal: sql`${schema.scrapeState.messagesSeenTotal} + ${result.messagesProcessed}`,
      })
      .where(eq(schema.scrapeState.channelId, channel.id));
  }
}

export const __test__ = { compareSnowflake };
