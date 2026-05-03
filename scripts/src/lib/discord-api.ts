import { DEFAULT_INTERCALL_DELAY_MS, GiveUpError, RateLimitError, sleep } from './rate-limit';

const DISCORD_BASE = 'https://discord.com/api/v10';
const MAX_429_RETRIES = 3;

function authHeader(): string {
  const token = process.env.DISCORD_USER_TOKEN;
  if (!token) {
    throw new Error(
      'DISCORD_USER_TOKEN is not set. Add it to .env.local locally, or as a GitHub Actions secret in CI.',
    );
  }
  // User tokens use the token directly (no "Bot " prefix).
  return token;
}

interface DiscordReqOpts {
  query?: Record<string, string | undefined>;
  // If true, treat 404 as a normal "not found" return value instead of throwing.
  allow404?: boolean;
}

export interface DiscordAttachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  proxy_url: string;
  width?: number;
  height?: number;
  content_type?: string;
  duration_secs?: number;
}

export interface DiscordMember {
  nick?: string | null;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  display_name?: string | null;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordUser;
  member?: DiscordMember;
  content: string;
  timestamp: string;
  edited_timestamp?: string | null;
  attachments: DiscordAttachment[];
}

async function discordRequest(
  path: string,
  opts: DiscordReqOpts = {},
): Promise<unknown> {
  let attempt = 0;
  while (true) {
    let url = DISCORD_BASE + path;
    if (opts.query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== '') params.set(k, v);
      }
      const qs = params.toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: authHeader(),
        Accept: 'application/json',
        'User-Agent': 'VEXScout/0.1 (+https://github.com/your-org/vex-scout)',
      },
    });
    await sleep(DEFAULT_INTERCALL_DELAY_MS);

    if (res.status === 429) {
      attempt++;
      let retryAfter = 1;
      try {
        const body = (await res.json()) as { retry_after?: number };
        retryAfter = body.retry_after ?? 1;
      } catch {
        retryAfter = parseFloat(res.headers.get('retry-after') ?? '1') || 1;
      }
      if (attempt >= MAX_429_RETRIES) throw new RateLimitError(retryAfter);
      console.warn(
        `[discord] 429 on ${path} — sleeping ${retryAfter + 0.5}s (attempt ${attempt}/${MAX_429_RETRIES})`,
      );
      await sleep((retryAfter + 0.5) * 1000);
      continue;
    }

    if (res.status === 404 && opts.allow404) return null;

    if (!res.ok) {
      const text = await res.text().catch(() => '<no body>');
      throw new GiveUpError(`Discord ${res.status} on ${path}: ${text.slice(0, 300)}`);
    }

    return res.json();
  }
}

/**
 * GET /channels/{channel.id}/messages
 * Used for both forward (after=) and backward (before=) pagination.
 */
export async function fetchMessages(
  channelId: string,
  cursor: { after?: string; before?: string },
  limit = 100,
): Promise<DiscordMessage[]> {
  const result = (await discordRequest(`/channels/${channelId}/messages`, {
    query: {
      limit: String(limit),
      after: cursor.after,
      before: cursor.before,
    },
  })) as DiscordMessage[];
  return result;
}

/**
 * GET /channels/{channel.id}/messages/{message.id}
 * Used by the refresher to re-sign attachment URLs. Returns null if the
 * message has been deleted (404).
 */
export async function fetchMessage(
  channelId: string,
  messageId: string,
): Promise<DiscordMessage | null> {
  const result = (await discordRequest(`/channels/${channelId}/messages/${messageId}`, {
    allow404: true,
  })) as DiscordMessage | null;
  return result;
}

/**
 * Discord CDN signed URLs include "?ex=<hex_unix_seconds>&is=...&hm=...".
 * Parse out the expiry so we know when to refresh.
 */
export function parseCdnExpiry(url: string): Date | null {
  try {
    const u = new URL(url);
    const ex = u.searchParams.get('ex');
    if (!ex) return null;
    const seconds = parseInt(ex, 16);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return new Date(seconds * 1000);
  } catch {
    return null;
  }
}

export function classifyContentType(att: DiscordAttachment): 'image' | 'video' | null {
  const mime = (att.content_type ?? '').toLowerCase();
  const name = att.filename.toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|heic)$/.test(name)) return 'image';
  if (mime.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv)$/.test(name)) return 'video';
  return null;
}
