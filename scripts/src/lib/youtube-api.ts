import { sleep } from './rate-limit';

const YOUTUBE_BASE = 'https://www.googleapis.com/youtube/v3';

export interface YoutubeVideo {
  id: string;
  title: string;
  description: string;
  channelTitle: string;
  publishedAt: string;
  durationSeconds: number;
  thumbnailUrl: string;
}

interface RawVideo {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url: string }>;
  };
  contentDetails?: {
    duration?: string;
  };
}

interface RawListResponse {
  items?: RawVideo[];
  error?: { message: string };
}

function apiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new Error(
      'YOUTUBE_API_KEY is not set. Add it to .env.local or as a GitHub Actions secret.',
    );
  }
  return key;
}

// Parse ISO 8601 duration (PT#H#M#S) → seconds.
export function parseIso8601Duration(iso?: string): number {
  if (!iso) return 0;
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const [, d, h, mn, s] = m;
  return (
    (parseInt(d ?? '0', 10) || 0) * 86400 +
    (parseInt(h ?? '0', 10) || 0) * 3600 +
    (parseInt(mn ?? '0', 10) || 0) * 60 +
    (parseInt(s ?? '0', 10) || 0)
  );
}

/**
 * Look up up to 50 video IDs in a single API call. Returns one entry per
 * found video; missing IDs simply don't appear in the result, which is the
 * caller's signal to mark them as enrichment errors.
 */
export async function lookupVideos(ids: string[]): Promise<YoutubeVideo[]> {
  if (ids.length === 0) return [];
  if (ids.length > 50) {
    throw new Error('lookupVideos accepts up to 50 ids per call (YouTube API limit).');
  }
  const url = `${YOUTUBE_BASE}/videos?part=snippet,contentDetails&id=${ids.join(',')}&key=${apiKey()}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  await sleep(50);

  if (res.status === 403) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `YouTube API 403 (likely quota exceeded or restricted key). Body: ${body.slice(0, 300)}`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`YouTube API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as RawListResponse;
  if (data.error) throw new Error(`YouTube API error: ${data.error.message}`);

  const out: YoutubeVideo[] = [];
  for (const item of data.items ?? []) {
    if (!item.id || !item.snippet) continue;
    const thumb =
      item.snippet.thumbnails?.maxres?.url ??
      item.snippet.thumbnails?.high?.url ??
      item.snippet.thumbnails?.medium?.url ??
      item.snippet.thumbnails?.default?.url ??
      `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;
    out.push({
      id: item.id,
      title: item.snippet.title ?? '',
      description: item.snippet.description ?? '',
      channelTitle: item.snippet.channelTitle ?? '',
      publishedAt: item.snippet.publishedAt ?? new Date().toISOString(),
      durationSeconds: parseIso8601Duration(item.contentDetails?.duration),
      thumbnailUrl: thumb,
    });
  }
  return out;
}
