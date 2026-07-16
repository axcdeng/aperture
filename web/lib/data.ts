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
  AlbumSummary,
  ContentType,
  FeedCursor,
  MediaItem,
  SearchSuggestion,
  SeasonId,
  Source,
  Team,
} from './types';
import { SEED_EVENTS, SEED_LAST_SYNC, SEED_MEDIA, SEED_TEAMS } from './seed';
import { getDb, schema } from './db/client';
import type { Media as DbMedia, Team as DbTeam } from './db/schema';
import { r2PublicUrl } from './r2';

// ---------------------------------------------------------------------------
// Toggle: seed data is an *explicit* opt-in via USE_SEED_DATA=true. We do NOT
// fall back to it just because DATABASE_URL is unset — that once let a
// misconfigured deploy silently serve fabricated demo data. With the fallback
// gone, a missing DATABASE_URL surfaces as a loud error from getDb() instead.
// ---------------------------------------------------------------------------
function shouldUseSeed(): boolean {
  return process.env.USE_SEED_DATA === 'true';
}

// Discord messages often contain raw URLs, mention tokens like <@123>, custom
// emoji like <:name:123>, and channel refs <#123>. Stripping these gives us a
// readable title; the original text stays in `description` for anyone who
// wants the source.
function cleanTitle(raw: string | null | undefined, max = 120): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/<a?:[A-Za-z0-9_~]+:\d+>/g, '') // custom emoji
    .replace(/<@!?\d+>/g, '')                // user mentions
    .replace(/<#\d+>/g, '')                  // channel mentions
    .replace(/<@&\d+>/g, '')                 // role mentions
    .replace(/<https?:\/\/\S+>/g, '')        // bracketed URLs
    .replace(/https?:\/\/\S+/g, '')          // bare URLs
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  return cleaned.length > max ? cleaned.slice(0, max - 1).trim() + '…' : cleaned;
}

function rowToMediaItem(m: DbMedia): MediaItem {
  // Build the URL the frontend should render.
  //
  // For Discord-hosted media we point at our own /api/img/<id> proxy. The
  // proxy checks the row's cdn_expires_at on every request and re-signs via
  // Discord's /attachments/refresh-urls endpoint if needed, so images keep
  // working even if the cron refresher missed a row.
  //
  // For YouTube we synthesize the embed URL and thumbnail directly — those
  // don't need signing.
  //
  // Once a Discord image has been mirrored to R2 (r2_key set), we serve the
  // durable 720p WebP straight from R2's public origin for BOTH the grid and
  // the lightbox — nothing breaks when the Discord URL expires. Un-mirrored
  // rows fall back to the on-demand /api/img proxy.
  let fullUrl: string;
  let thumbnailUrl: string;
  const r2Url = m.source === 'discord' ? r2PublicUrl(m.r2Key) : null;
  if (m.source === 'youtube' && m.youtubeVideoId) {
    fullUrl = `https://www.youtube.com/embed/${m.youtubeVideoId}`;
    thumbnailUrl =
      m.cdnThumbUrl ?? `https://i.ytimg.com/vi/${m.youtubeVideoId}/hqdefault.jpg`;
  } else if (m.source === 'album') {
    // Album photos always live in R2: r2Key = ~480px thumb, r2FullKey =
    // ~1080px display. Fall back to the thumb if the full is missing.
    const thumb = r2PublicUrl(m.r2Key);
    const full = r2PublicUrl(m.r2FullKey);
    thumbnailUrl = thumb ?? full ?? '';
    fullUrl = full ?? thumb ?? '';
  } else if (m.source === 'discord' && r2Url && m.contentType === 'image') {
    fullUrl = r2Url;
    thumbnailUrl = r2Url;
  } else if (m.source === 'discord') {
    fullUrl = `/api/img/${m.id}?v=full`;
    thumbnailUrl = `/api/img/${m.id}?v=thumb`;
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
    title: cleanTitle(m.title),
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
    eventId: m.eventId ?? undefined,
    originalFilename: m.originalFilename ?? undefined,
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
// assignMediaToTeam — tag an untagged media row with a team number. The team
// is upserted (created with just its number if we haven't scraped it yet) so
// scouts can tag reveals for teams that aren't in the table yet; the richer
// metadata fills in later from a scrape.
// ---------------------------------------------------------------------------
export async function assignMediaToTeam(mediaId: string, rawTeamNumber: string): Promise<void> {
  const teamNumber = rawTeamNumber.trim().toUpperCase();
  if (!teamNumber) throw new Error('Team number is required.');
  if (shouldUseSeed()) {
    throw new Error('Cannot assign media in seed mode — connect a database.');
  }
  const db = getDb();
  await db.insert(schema.teams).values({ teamNumber }).onConflictDoNothing();
  await db
    .update(schema.media)
    .set({ teamNumber })
    .where(and(eq(schema.media.id, mediaId), isNull(schema.media.deletedAt)));
}

// ---------------------------------------------------------------------------
// dismissMedia — "Not a reveal": soft-delete so it drops out of every query
// (all reads filter on deletedAt IS NULL), including the untagged queue.
// ---------------------------------------------------------------------------
export async function dismissMedia(mediaId: string): Promise<void> {
  if (shouldUseSeed()) {
    throw new Error('Cannot dismiss media in seed mode — connect a database.');
  }
  const db = getDb();
  await db
    .update(schema.media)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.media.id, mediaId), isNull(schema.media.deletedAt)));
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
// Albums (the `events` table). Album photos are `media` rows with
// source='album'; a multi-team photo is several rows sharing
// (event_id, original_filename). The album views collapse those rows by
// filename into one MediaItem carrying teamNumbers[].
// ---------------------------------------------------------------------------

// Collapse per-team album rows into one MediaItem per photo (keyed by
// original_filename), gathering every team tag into teamNumbers[].
function collapseAlbumPhotos(items: MediaItem[]): MediaItem[] {
  const groups = new Map<string, MediaItem[]>();
  const order: string[] = [];
  for (const item of items) {
    const key = item.originalFilename ?? item.id;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(item);
  }
  return order.map((key) => {
    const group = groups.get(key)!;
    const primary = group[0];
    const teamNumbers = Array.from(
      new Set(group.map((m) => m.teamNumber).filter((n): n is string => Boolean(n))),
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return {
      ...primary,
      teamNumber: teamNumbers.length ? teamNumbers.join(' & ') : null,
      teamNumbers,
    };
  });
}

function seedAlbumSummary(e: (typeof SEED_EVENTS)[number]): AlbumSummary {
  const photos = SEED_MEDIA.filter((m) => m.eventId === e.id);
  const filenames = new Set(photos.map((m) => m.originalFilename));
  const teams = new Set(
    photos.map((m) => m.teamNumber).filter((n): n is string => Boolean(n)),
  );
  const cover =
    photos.find((m) => m.originalFilename === e.coverOriginalFilename) ?? photos[0];
  return {
    id: e.id,
    name: e.name,
    slug: e.slug,
    date: e.date,
    location: e.location,
    coverUrl: cover?.thumbnailUrl,
    photoCount: filenames.size,
    teamCount: teams.size,
  };
}

export async function listAlbums(): Promise<AlbumSummary[]> {
  if (shouldUseSeed()) {
    return SEED_EVENTS.map(seedAlbumSummary).sort((a, b) =>
      (b.date ?? '').localeCompare(a.date ?? ''),
    );
  }

  const db = getDb();
  const evs = await db
    .select()
    .from(schema.events)
    .orderBy(desc(schema.events.date), desc(schema.events.createdAt));

  const summaries: AlbumSummary[] = [];
  for (const e of evs) {
    const [agg] = await db
      .select({
        // count(distinct filename) = photos; count(distinct team) excludes
        // NULL, so untagged photos don't inflate the team count.
        photoCount: sql<number>`count(distinct ${schema.media.originalFilename})`,
        teamCount: sql<number>`count(distinct ${schema.media.teamNumber})`,
      })
      .from(schema.media)
      .where(and(eq(schema.media.eventId, e.id), isNull(schema.media.deletedAt)));

    const [cover] = await db
      .select({ r2Key: schema.media.r2Key, r2FullKey: schema.media.r2FullKey })
      .from(schema.media)
      .where(
        and(
          eq(schema.media.eventId, e.id),
          isNull(schema.media.deletedAt),
          e.coverOriginalFilename
            ? eq(schema.media.originalFilename, e.coverOriginalFilename)
            : sql`true`,
        ),
      )
      .limit(1);

    summaries.push({
      id: e.id,
      name: e.name,
      slug: e.slug,
      date: e.date?.toISOString(),
      location: e.location ?? undefined,
      note: e.note ?? undefined,
      coverUrl: r2PublicUrl(cover?.r2Key ?? cover?.r2FullKey) ?? undefined,
      photoCount: Number(agg?.photoCount ?? 0),
      teamCount: Number(agg?.teamCount ?? 0),
    });
  }
  return summaries;
}

export async function getAlbum(slug: string): Promise<AlbumSummary | null> {
  if (shouldUseSeed()) {
    const e = SEED_EVENTS.find((ev) => ev.slug.toLowerCase() === slug.toLowerCase());
    return e ? seedAlbumSummary(e) : null;
  }
  const albums = await listAlbums();
  return albums.find((a) => a.slug.toLowerCase() === slug.toLowerCase()) ?? null;
}

export async function getAlbumPhotos(eventId: string): Promise<MediaItem[]> {
  if (shouldUseSeed()) {
    const rows = SEED_MEDIA.filter((m) => m.eventId === eventId);
    return collapseAlbumPhotos(rows);
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.eventId, eventId), isNull(schema.media.deletedAt)))
    .orderBy(schema.media.originalFilename, schema.media.id);
  return collapseAlbumPhotos(rows.map(rowToMediaItem));
}

// Resolve a set of photo keys ("<eventId>/<filename>") to MediaItems, across
// albums. Used by the Tags page, whose tag→photo membership lives client-side.
// Collapses per-team rows by (eventId, filename) into one item with teamNumbers.
export async function getMediaByKeys(keys: string[]): Promise<MediaItem[]> {
  const pairs = keys
    .map((k) => {
      const i = k.indexOf('/');
      return i > 0 ? { eventId: k.slice(0, i), filename: k.slice(i + 1) } : null;
    })
    .filter((p): p is { eventId: string; filename: string } => p !== null);
  if (pairs.length === 0) return [];

  const collapse = (items: MediaItem[]) => {
    const groups = new Map<string, MediaItem[]>();
    const order: string[] = [];
    for (const it of items) {
      const key = `${it.eventId ?? '?'}/${it.originalFilename ?? it.id}`;
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(key);
      }
      groups.get(key)!.push(it);
    }
    return order.map((key) => {
      const group = groups.get(key)!;
      const primary = group[0];
      const teamNumbers = Array.from(
        new Set(group.map((m) => m.teamNumber).filter((n): n is string => Boolean(n))),
      ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return {
        ...primary,
        teamNumber: teamNumbers.length ? teamNumbers.join(' & ') : null,
        teamNumbers,
      };
    });
  };

  if (shouldUseSeed()) {
    const want = new Set(pairs.map((p) => `${p.eventId}/${p.filename}`));
    const rows = SEED_MEDIA.filter((m) => want.has(`${m.eventId ?? '?'}/${m.originalFilename ?? ''}`));
    return collapse(rows);
  }

  const db = getDb();
  const conds = pairs.map((p) =>
    and(eq(schema.media.eventId, p.eventId), eq(schema.media.originalFilename, p.filename)),
  );
  const rows = await db
    .select()
    .from(schema.media)
    .where(and(isNull(schema.media.deletedAt), or(...conds)))
    .orderBy(schema.media.eventId, schema.media.originalFilename, schema.media.id);
  return collapse(rows.map(rowToMediaItem));
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
