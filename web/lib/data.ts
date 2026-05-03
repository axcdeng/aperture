import {
  and,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  isNotNull,
  lt,
  or,
  sql,
} from 'drizzle-orm';
import type {
  ContentType,
  FeedCursor,
  MediaItem,
  SearchSuggestion,
  SeasonId,
  Source,
  Team,
} from './types';
import { SEED_LAST_SYNC, SEED_MEDIA, SEED_TEAMS } from './seed';
import { getDb, schema } from './db/client';
import type { Media as DbMedia, Team as DbTeam } from './db/schema';

// ---------------------------------------------------------------------------
// Toggle: when USE_SEED_DATA=true (or DATABASE_URL is missing), all functions
// fall back to the in-repo seed so the UI demos cleanly without a DB.
// ---------------------------------------------------------------------------
function shouldUseSeed(): boolean {
  if (process.env.USE_SEED_DATA === 'true') return true;
  if (!process.env.DATABASE_URL) return true;
  return false;
}

function rowToMediaItem(m: DbMedia): MediaItem {
  // Build the URL the frontend should render. For Discord, cdnUrl/cdnThumbUrl
  // are signed CDN URLs (~24h lifetime). For YouTube, we synthesize embed URLs
  // from the video ID — there is no Discord CDN URL.
  let fullUrl: string;
  let thumbnailUrl: string;
  if (m.source === 'youtube' && m.youtubeVideoId) {
    fullUrl = `https://www.youtube.com/embed/${m.youtubeVideoId}`;
    thumbnailUrl =
      m.cdnThumbUrl ?? `https://i.ytimg.com/vi/${m.youtubeVideoId}/hqdefault.jpg`;
  } else {
    fullUrl = m.cdnUrl ?? '';
    thumbnailUrl = m.cdnThumbUrl ?? m.cdnUrl ?? '';
  }

  return {
    id: m.id,
    teamNumber: m.teamNumber,
    source: m.source as Source,
    sourceChannel: m.sourceChannel ?? undefined,
    contentType: m.contentType as ContentType,
    postedAt: m.postedAt.toISOString(),
    seasonId: m.seasonId as SeasonId,
    thumbnailUrl,
    fullUrl,
    title: m.title ?? undefined,
    description: m.description ?? undefined,
    width: m.width ?? undefined,
    height: m.height ?? undefined,
    durationSeconds: m.durationSeconds ?? undefined,
    originalUrl:
      m.source === 'youtube' && m.youtubeVideoId
        ? `https://www.youtube.com/watch?v=${m.youtubeVideoId}`
        : m.discordChannelId && m.discordMessageId
          ? `https://discord.com/channels/@me/${m.discordChannelId}/${m.discordMessageId}`
          : '',
    authorDisplayName: m.authorDisplayName ?? undefined,
  };
}

function rowToTeam(t: DbTeam): Team {
  return {
    number: t.teamNumber,
    organization: t.organization ?? '',
    region: t.region ?? '',
    country: t.country ?? '',
    firstSeenAt: t.firstSeenAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// getTeam
// ---------------------------------------------------------------------------
export async function getTeam(teamNumber: string): Promise<Team | null> {
  if (shouldUseSeed()) {
    return (
      SEED_TEAMS.find((t) => t.number.toLowerCase() === teamNumber.toLowerCase()) ?? null
    );
  }
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.teams)
    .where(sql`lower(${schema.teams.teamNumber}) = lower(${teamNumber})`)
    .limit(1);
  return row ? rowToTeam(row) : null;
}

// ---------------------------------------------------------------------------
// getTeamMedia
// ---------------------------------------------------------------------------
export async function getTeamMedia(teamNumber: string): Promise<MediaItem[]> {
  if (shouldUseSeed()) {
    return SEED_MEDIA.filter(
      (m) => m.teamNumber && m.teamNumber.toLowerCase() === teamNumber.toLowerCase(),
    ).sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.media)
    .where(
      and(
        sql`lower(${schema.media.teamNumber}) = lower(${teamNumber})`,
        isNull(schema.media.deletedAt),
      ),
    )
    .orderBy(desc(schema.media.postedAt));
  return rows.map(rowToMediaItem);
}

// ---------------------------------------------------------------------------
// getTeamSeasons
// ---------------------------------------------------------------------------
export async function getTeamSeasons(teamNumber: string): Promise<SeasonId[]> {
  if (shouldUseSeed()) {
    const media = await getTeamMedia(teamNumber);
    return Array.from(new Set(media.map((m) => m.seasonId)));
  }
  const db = getDb();
  const rows = await db
    .selectDistinct({ seasonId: schema.media.seasonId })
    .from(schema.media)
    .where(
      and(
        sql`lower(${schema.media.teamNumber}) = lower(${teamNumber})`,
        isNull(schema.media.deletedAt),
      ),
    );
  return rows.map((r) => r.seasonId as SeasonId);
}

// ---------------------------------------------------------------------------
// searchTeams
// ---------------------------------------------------------------------------
export async function searchTeams(query: string, limit = 10): Promise<SearchSuggestion[]> {
  const q = query.trim();
  if (!q) return [];

  if (shouldUseSeed()) {
    const lq = q.toLowerCase();
    const matches = SEED_TEAMS.filter(
      (t) =>
        t.number.toLowerCase().includes(lq) ||
        t.organization.toLowerCase().includes(lq) ||
        t.region.toLowerCase().includes(lq),
    );
    matches.sort((a, b) => {
      const aStarts = a.number.toLowerCase().startsWith(lq) ? 0 : 1;
      const bStarts = b.number.toLowerCase().startsWith(lq) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.number.localeCompare(b.number);
    });
    return matches.slice(0, limit).map((team) => ({
      team,
      contentCount: SEED_MEDIA.filter((m) => m.teamNumber === team.number).length,
    }));
  }

  const db = getDb();
  const like = `%${q}%`;
  const rows = await db
    .select({
      team: schema.teams,
      contentCount: sql<number>`count(${schema.media.id}) filter (where ${schema.media.deletedAt} is null)`.as(
        'content_count',
      ),
    })
    .from(schema.teams)
    .leftJoin(schema.media, eq(schema.media.teamNumber, schema.teams.teamNumber))
    .where(or(ilike(schema.teams.teamNumber, like), ilike(schema.teams.organization, like)))
    .groupBy(schema.teams.teamNumber)
    .orderBy(
      sql`case when ${schema.teams.teamNumber} ilike ${q + '%'} then 0 else 1 end`,
      schema.teams.teamNumber,
    )
    .limit(limit);

  return rows.map((r) => ({
    team: rowToTeam(r.team),
    contentCount: Number(r.contentCount ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// getFeed
// ---------------------------------------------------------------------------
export async function getFeed(opts: {
  cursor?: FeedCursor;
  limit?: number;
  seasonId?: SeasonId;
  sources?: Source[];
  contentTypes?: ContentType[];
}): Promise<{ items: MediaItem[]; nextCursor?: FeedCursor }> {
  const limit = opts.limit ?? 24;

  if (shouldUseSeed()) {
    let pool = SEED_MEDIA.filter((m) => m.teamNumber !== null);
    if (opts.seasonId) pool = pool.filter((m) => m.seasonId === opts.seasonId);
    if (opts.sources?.length) pool = pool.filter((m) => opts.sources!.includes(m.source));
    if (opts.contentTypes?.length)
      pool = pool.filter((m) => opts.contentTypes!.includes(m.contentType));
    if (opts.cursor) {
      const before = new Date(opts.cursor.postedBefore).getTime();
      pool = pool.filter((m) => new Date(m.postedAt).getTime() < before);
    }
    const items = pool.slice(0, limit);
    const nextCursor =
      items.length === limit
        ? { postedBefore: items[items.length - 1].postedAt }
        : undefined;
    return { items, nextCursor };
  }

  const db = getDb();
  const conditions = [isNull(schema.media.deletedAt), isNotNull(schema.media.teamNumber)];
  if (opts.seasonId) conditions.push(eq(schema.media.seasonId, opts.seasonId));
  if (opts.sources?.length) conditions.push(inArray(schema.media.source, opts.sources));
  if (opts.contentTypes?.length)
    conditions.push(inArray(schema.media.contentType, opts.contentTypes));
  if (opts.cursor)
    conditions.push(lt(schema.media.postedAt, new Date(opts.cursor.postedBefore)));

  const rows = await db
    .select()
    .from(schema.media)
    .where(and(...conditions))
    .orderBy(desc(schema.media.postedAt))
    .limit(limit);

  const items = rows.map(rowToMediaItem);
  const nextCursor =
    items.length === limit
      ? { postedBefore: items[items.length - 1].postedAt }
      : undefined;
  return { items, nextCursor };
}

// ---------------------------------------------------------------------------
// getRecentMedia
// ---------------------------------------------------------------------------
export async function getRecentMedia(limit: number): Promise<MediaItem[]> {
  if (shouldUseSeed()) {
    return SEED_MEDIA.filter((m) => m.teamNumber !== null).slice(0, limit);
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.media)
    .where(and(isNull(schema.media.deletedAt), isNotNull(schema.media.teamNumber)))
    .orderBy(desc(schema.media.postedAt))
    .limit(limit);
  return rows.map(rowToMediaItem);
}

// ---------------------------------------------------------------------------
// getMostActiveTeams
// ---------------------------------------------------------------------------
export async function getMostActiveTeams(
  seasonId: SeasonId,
  limit: number,
): Promise<{ team: Team; count: number }[]> {
  if (shouldUseSeed()) {
    const counts = new Map<string, number>();
    for (const m of SEED_MEDIA) {
      if (!m.teamNumber) continue;
      if (seasonId !== 'unknown' && m.seasonId !== seasonId) continue;
      counts.set(m.teamNumber, (counts.get(m.teamNumber) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([num, c]) => ({ team: SEED_TEAMS.find((t) => t.number === num)!, count: c }))
      .filter((r) => r.team)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  const db = getDb();
  const rows = await db
    .select({
      team: schema.teams,
      count: count(schema.media.id).as('active_count'),
    })
    .from(schema.media)
    .innerJoin(schema.teams, eq(schema.media.teamNumber, schema.teams.teamNumber))
    .where(
      and(
        isNull(schema.media.deletedAt),
        seasonId === 'unknown' ? sql`true` : eq(schema.media.seasonId, seasonId),
      ),
    )
    .groupBy(schema.teams.teamNumber)
    .orderBy(desc(sql`active_count`))
    .limit(limit);

  return rows.map((r) => ({ team: rowToTeam(r.team), count: Number(r.count) }));
}

// ---------------------------------------------------------------------------
// getUntaggedMedia
// ---------------------------------------------------------------------------
export async function getUntaggedMedia(): Promise<MediaItem[]> {
  if (shouldUseSeed()) {
    return SEED_MEDIA.filter((m) => m.teamNumber === null);
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.media)
    .where(and(isNull(schema.media.teamNumber), isNull(schema.media.deletedAt)))
    .orderBy(desc(schema.media.postedAt))
    .limit(200);
  return rows.map(rowToMediaItem);
}

// ---------------------------------------------------------------------------
// getMediaItem
// ---------------------------------------------------------------------------
export async function getMediaItem(id: string): Promise<MediaItem | null> {
  if (shouldUseSeed()) {
    return SEED_MEDIA.find((m) => m.id === id) ?? null;
  }
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.id, id), isNull(schema.media.deletedAt)))
    .limit(1);
  return row ? rowToMediaItem(row) : null;
}

// ---------------------------------------------------------------------------
// listTeams — used by the browse page so the right-rail TeamDetailPanel
// has metadata for any selected card. Not part of the original spec but
// added so the feed UI can hydrate selections without re-querying per click.
// ---------------------------------------------------------------------------
export async function listTeams(limit = 1000): Promise<Team[]> {
  if (shouldUseSeed()) {
    return SEED_TEAMS.slice(0, limit);
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.teams)
    .orderBy(desc(schema.teams.lastSeenAt))
    .limit(limit);
  return rows.map(rowToTeam);
}

// ---------------------------------------------------------------------------
// getStats
// ---------------------------------------------------------------------------
export async function getStats(): Promise<{
  totalTeams: number;
  totalMedia: number;
  lastSyncAt: string;
}> {
  if (shouldUseSeed()) {
    return {
      totalTeams: SEED_TEAMS.length,
      totalMedia: SEED_MEDIA.length,
      lastSyncAt: SEED_LAST_SYNC,
    };
  }

  const db = getDb();
  const [teamCount] = await db
    .select({ c: count() })
    .from(schema.teams);
  const [mediaCount] = await db
    .select({ c: count() })
    .from(schema.media)
    .where(isNull(schema.media.deletedAt));
  const [lastSync] = await db
    .select({ finishedAt: schema.syncLog.finishedAt })
    .from(schema.syncLog)
    .where(and(isNotNull(schema.syncLog.finishedAt), eq(schema.syncLog.errors, 0)))
    .orderBy(desc(schema.syncLog.finishedAt))
    .limit(1);

  return {
    totalTeams: Number(teamCount?.c ?? 0),
    totalMedia: Number(mediaCount?.c ?? 0),
    lastSyncAt: (lastSync?.finishedAt ?? new Date()).toISOString(),
  };
}

// Suppress unused-import noise for `gt` (kept for parity if needed later).
void gt;
