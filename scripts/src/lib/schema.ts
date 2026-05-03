// KEEP IN SYNC with /web/lib/db/schema.ts.
// /scripts and /web each have their own drizzle-orm install, so the schema
// must be defined inside whichever package is using it — sharing across
// packages causes Symbol-mismatch failures at runtime. When you change one
// file, copy the change to the other.

import {
  pgTable,
  text,
  integer,
  timestamp,
  serial,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// teams
// ---------------------------------------------------------------------------
export const teams = pgTable('teams', {
  teamNumber: text('team_number').primaryKey(),
  organization: text('organization'),
  region: text('region'),
  country: text('country'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  mediaCount: integer('media_count').default(0).notNull(),
});

// ---------------------------------------------------------------------------
// media
// ---------------------------------------------------------------------------
export const media = pgTable(
  'media',
  {
    id: text('id').primaryKey(),
    teamNumber: text('team_number').references(() => teams.teamNumber, {
      onDelete: 'set null',
    }),
    seasonId: text('season_id').notNull(),
    source: text('source').notNull(), // 'discord' | 'youtube'
    sourceChannel: text('source_channel'),
    contentType: text('content_type').notNull(), // 'image' | 'video' | 'youtube'
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
    scrapedAt: timestamp('scraped_at', { withTimezone: true }).defaultNow().notNull(),
    title: text('title'),
    description: text('description'),
    authorDisplayName: text('author_display_name'),
    width: integer('width'),
    height: integer('height'),
    durationSeconds: integer('duration_seconds'),
    multiTeamGroupId: text('multi_team_group_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    // Discord-specific
    discordChannelId: text('discord_channel_id'),
    discordMessageId: text('discord_message_id'),
    discordAttachmentId: text('discord_attachment_id'),
    discordFilename: text('discord_filename'),
    cdnUrl: text('cdn_url'),
    cdnThumbUrl: text('cdn_thumb_url'),
    cdnExpiresAt: timestamp('cdn_expires_at', { withTimezone: true }),

    // YouTube-specific
    youtubeVideoId: text('youtube_video_id'),
    youtubeChannelName: text('youtube_channel_name'),
    discordSourceMessageId: text('discord_source_message_id'),
    discordSourceChannelId: text('discord_source_channel_id'),
  },
  (t) => [
    index('media_team_posted_idx').on(t.teamNumber, t.postedAt.desc()),
    index('media_posted_idx').on(t.postedAt.desc()),
    index('media_season_posted_idx').on(t.seasonId, t.postedAt.desc()),
    index('media_cdn_expires_idx').on(t.cdnExpiresAt),
    index('media_youtube_video_idx').on(t.youtubeVideoId),
    // Discord dedupe (per (channel, message, attachment) — also per team since
    // multi-team reveals share message+attachment but with different team rows).
    uniqueIndex('media_discord_dedupe_idx').on(
      t.discordMessageId,
      t.discordAttachmentId,
      t.teamNumber,
    ),
    // YouTube dedupe per team
    uniqueIndex('media_youtube_dedupe_idx').on(t.youtubeVideoId, t.teamNumber),
  ],
);

// ---------------------------------------------------------------------------
// scrape_state — one row per Discord channel
// ---------------------------------------------------------------------------
export const scrapeState = pgTable('scrape_state', {
  channelId: text('channel_id').primaryKey(),
  channelName: text('channel_name').notNull(),
  lastSyncedMessageId: text('last_synced_message_id'),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastRunStatus: text('last_run_status'), // 'ok' | 'error' | 'rate_limited' | 'pending'
  lastRunError: text('last_run_error'),
  messagesSeenTotal: integer('messages_seen_total').default(0).notNull(),
});

// ---------------------------------------------------------------------------
// youtube_enrichment_queue
// ---------------------------------------------------------------------------
export const youtubeEnrichmentQueue = pgTable(
  'youtube_enrichment_queue',
  {
    youtubeVideoId: text('youtube_video_id').primaryKey(),
    discordSourceChannelId: text('discord_source_channel_id').notNull(),
    discordSourceMessageId: text('discord_source_message_id').notNull(),
    discordAuthorDisplayName: text('discord_author_display_name'),
    discoveredAt: timestamp('discovered_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    enrichedAt: timestamp('enriched_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [index('youtube_queue_unenriched_idx').on(t.enrichedAt, t.discoveredAt)],
);

// ---------------------------------------------------------------------------
// sync_log — append-only run log
// ---------------------------------------------------------------------------
export const syncLog = pgTable('sync_log', {
  id: serial('id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  jobType: text('job_type').notNull(), // 'discord_scrape' | 'discord_refresh' | 'youtube_enrich' | 'backfill'
  itemsAdded: integer('items_added').default(0).notNull(),
  itemsRefreshed: integer('items_refreshed').default(0).notNull(),
  errors: integer('errors').default(0).notNull(),
  notes: text('notes'),
});

// ---------------------------------------------------------------------------
// Convenience types
// ---------------------------------------------------------------------------
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
export type ScrapeState = typeof scrapeState.$inferSelect;
export type NewScrapeState = typeof scrapeState.$inferInsert;
export type YoutubeEnrichmentQueueRow = typeof youtubeEnrichmentQueue.$inferSelect;
export type NewYoutubeEnrichmentQueueRow = typeof youtubeEnrichmentQueue.$inferInsert;
export type SyncLogRow = typeof syncLog.$inferSelect;
export type NewSyncLogRow = typeof syncLog.$inferInsert;
