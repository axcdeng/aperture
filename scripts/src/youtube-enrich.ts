// Workflow C: Look up queued YouTube video IDs via the YouTube Data API,
// then create one media row per extracted team (multi-team reveals share a
// multi_team_group_id).

import { asc, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema, pool } from './lib/db';
import { lookupVideos, type YoutubeVideo } from './lib/youtube-api';
import { extractTeams } from './lib/team-extraction';
import { seasonForDate } from './lib/seasons';
import { startSyncLog } from './lib/sync-log';

const QUEUE_BATCH = 200;
const API_BATCH = 50;

interface QueueRow {
  youtubeVideoId: string;
  discordSourceChannelId: string;
  discordSourceMessageId: string;
  discordAuthorDisplayName: string | null;
}

async function main() {
  const log = await startSyncLog('youtube_enrich');
  let totalAdded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const notes: string[] = [];

  const queue = (await db
    .select({
      youtubeVideoId: schema.youtubeEnrichmentQueue.youtubeVideoId,
      discordSourceChannelId: schema.youtubeEnrichmentQueue.discordSourceChannelId,
      discordSourceMessageId: schema.youtubeEnrichmentQueue.discordSourceMessageId,
      discordAuthorDisplayName: schema.youtubeEnrichmentQueue.discordAuthorDisplayName,
    })
    .from(schema.youtubeEnrichmentQueue)
    .where(isNull(schema.youtubeEnrichmentQueue.enrichedAt))
    .orderBy(asc(schema.youtubeEnrichmentQueue.discoveredAt))
    .limit(QUEUE_BATCH)) as QueueRow[];

  console.log(`[enrich] queue has ${queue.length} unenriched rows (cap ${QUEUE_BATCH})`);

  for (let i = 0; i < queue.length; i += API_BATCH) {
    const slice = queue.slice(i, i + API_BATCH);
    const ids = slice.map((q) => q.youtubeVideoId);
    let videos: YoutubeVideo[] = [];
    try {
      videos = await lookupVideos(ids);
    } catch (e) {
      totalErrors++;
      const msg = (e as Error).message ?? String(e);
      console.error(`[enrich] batch lookup failed: ${msg}`);
      notes.push(`api err: ${msg.slice(0, 120)}`);
      // Mark this batch as errored so they aren't retried forever.
      for (const q of slice) {
        await db
          .update(schema.youtubeEnrichmentQueue)
          .set({ enrichedAt: new Date(), error: msg.slice(0, 240) })
          .where(eq(schema.youtubeEnrichmentQueue.youtubeVideoId, q.youtubeVideoId));
      }
      continue;
    }

    const byId = new Map(videos.map((v) => [v.id, v]));
    for (const q of slice) {
      const video = byId.get(q.youtubeVideoId);
      if (!video) {
        // Private / deleted / region-blocked.
        totalSkipped++;
        await db
          .update(schema.youtubeEnrichmentQueue)
          .set({ enrichedAt: new Date(), error: 'video unavailable' })
          .where(eq(schema.youtubeEnrichmentQueue.youtubeVideoId, q.youtubeVideoId));
        continue;
      }

      const teams = extractTeams({
        channelType: 'admin-reposted-youtube',
        youtubeTitle: video.title,
        youtubeDescription: video.description,
        youtubeChannelName: video.channelTitle,
        posterNickname: q.discordAuthorDisplayName ?? undefined,
        posterUsername: q.discordAuthorDisplayName ?? undefined,
      });

      const groupId = teams.length > 1 ? nanoid(12) : null;
      const teamSlots = teams.length > 0 ? teams : [null];

      for (const team of teamSlots) {
        // Upsert the team FIRST so the media FK doesn't violate.
        if (team) {
          await db
            .insert(schema.teams)
            .values({
              teamNumber: team,
              firstSeenAt: new Date(video.publishedAt),
              lastSeenAt: new Date(video.publishedAt),
              mediaCount: 0,
            })
            .onConflictDoNothing({ target: schema.teams.teamNumber });
        }

        const id = nanoid(16);
        const inserted = await db
          .insert(schema.media)
          .values({
            id,
            teamNumber: team,
            seasonId: seasonForDate(video.publishedAt),
            source: 'youtube',
            sourceChannel: video.channelTitle || null,
            contentType: 'youtube',
            postedAt: new Date(video.publishedAt),
            title: video.title || null,
            description: video.description || null,
            authorDisplayName: q.discordAuthorDisplayName,
            durationSeconds: video.durationSeconds || null,
            multiTeamGroupId: groupId,
            // No CDN URL for YouTube; the frontend builds embed URL from videoId.
            cdnUrl: null,
            cdnThumbUrl: video.thumbnailUrl,
            cdnExpiresAt: null,
            youtubeVideoId: video.id,
            youtubeChannelName: video.channelTitle || null,
            discordSourceMessageId: q.discordSourceMessageId,
            discordSourceChannelId: q.discordSourceChannelId,
          })
          .onConflictDoNothing({
            target: [schema.media.youtubeVideoId, schema.media.teamNumber],
          })
          .returning({ id: schema.media.id });
        if (inserted.length > 0) totalAdded++;
      }

      await db
        .update(schema.youtubeEnrichmentQueue)
        .set({ enrichedAt: new Date(), error: null })
        .where(eq(schema.youtubeEnrichmentQueue.youtubeVideoId, q.youtubeVideoId));
    }
  }

  await log.finish({
    itemsAdded: totalAdded,
    errors: totalErrors,
    notes: `added=${totalAdded} skipped=${totalSkipped} errs=${totalErrors} ${notes.join(' | ')}`.slice(0, 1000),
  });
  console.log(`[enrich] DONE. added=${totalAdded} skipped=${totalSkipped} errors=${totalErrors}`);
  await pool.end();
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[enrich] unhandled error:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
