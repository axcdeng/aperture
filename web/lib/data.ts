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

export async function getTeam(teamNumber: string): Promise<Team | null> {
  return SEED_TEAMS.find((t) => t.number.toLowerCase() === teamNumber.toLowerCase()) ?? null;
}

export async function getTeamMedia(teamNumber: string): Promise<MediaItem[]> {
  return SEED_MEDIA.filter(
    (m) => m.teamNumber && m.teamNumber.toLowerCase() === teamNumber.toLowerCase(),
  ).sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());
}

export async function getTeamSeasons(teamNumber: string): Promise<SeasonId[]> {
  const media = await getTeamMedia(teamNumber);
  const set = new Set<SeasonId>();
  media.forEach((m) => set.add(m.seasonId));
  return Array.from(set);
}

export async function searchTeams(query: string, limit = 8): Promise<SearchSuggestion[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches = SEED_TEAMS.filter(
    (t) =>
      t.number.toLowerCase().includes(q) ||
      t.organization.toLowerCase().includes(q) ||
      t.region.toLowerCase().includes(q),
  );
  matches.sort((a, b) => {
    const aStarts = a.number.toLowerCase().startsWith(q) ? 0 : 1;
    const bStarts = b.number.toLowerCase().startsWith(q) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return a.number.localeCompare(b.number);
  });
  const out: SearchSuggestion[] = [];
  for (const team of matches.slice(0, limit)) {
    const count = SEED_MEDIA.filter((m) => m.teamNumber === team.number).length;
    out.push({ team, contentCount: count });
  }
  return out;
}

export async function getFeed(opts: {
  cursor?: FeedCursor;
  limit?: number;
  seasonId?: SeasonId;
  sources?: Source[];
  contentTypes?: ContentType[];
}): Promise<{ items: MediaItem[]; nextCursor?: FeedCursor }> {
  const limit = opts.limit ?? 24;
  let pool = SEED_MEDIA.filter((m) => m.teamNumber !== null);
  if (opts.seasonId) pool = pool.filter((m) => m.seasonId === opts.seasonId);
  if (opts.sources && opts.sources.length) pool = pool.filter((m) => opts.sources!.includes(m.source));
  if (opts.contentTypes && opts.contentTypes.length)
    pool = pool.filter((m) => opts.contentTypes!.includes(m.contentType));

  if (opts.cursor) {
    const before = new Date(opts.cursor.postedBefore).getTime();
    pool = pool.filter((m) => new Date(m.postedAt).getTime() < before);
  }

  const items = pool.slice(0, limit);
  const nextCursor = items.length === limit ? { postedBefore: items[items.length - 1].postedAt } : undefined;
  return { items, nextCursor };
}

export async function getRecentMedia(limit: number): Promise<MediaItem[]> {
  return SEED_MEDIA.filter((m) => m.teamNumber !== null).slice(0, limit);
}

export async function getMostActiveTeams(
  seasonId: SeasonId,
  limit: number,
): Promise<{ team: Team; count: number }[]> {
  const counts = new Map<string, number>();
  for (const m of SEED_MEDIA) {
    if (!m.teamNumber) continue;
    if (seasonId !== 'unknown' && m.seasonId !== seasonId) continue;
    counts.set(m.teamNumber, (counts.get(m.teamNumber) ?? 0) + 1);
  }
  const ranked = Array.from(counts.entries())
    .map(([num, count]) => ({ team: SEED_TEAMS.find((t) => t.number === num)!, count }))
    .filter((r) => r.team)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  return ranked;
}

export async function getUntaggedMedia(): Promise<MediaItem[]> {
  return SEED_MEDIA.filter((m) => m.teamNumber === null);
}

export async function getMediaItem(id: string): Promise<MediaItem | null> {
  return SEED_MEDIA.find((m) => m.id === id) ?? null;
}

export async function getStats(): Promise<{
  totalTeams: number;
  totalMedia: number;
  lastSyncAt: string;
}> {
  return {
    totalTeams: SEED_TEAMS.length,
    totalMedia: SEED_MEDIA.length,
    lastSyncAt: SEED_LAST_SYNC,
  };
}
