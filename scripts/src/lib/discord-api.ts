import {
  GiveUpError,
  NoAccessError,
  RateLimitError,
  humanDelay,
  sleep,
} from './rate-limit';

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

// Headers Discord's web client sends. Mimicking these makes the requests
// look like an ordinary browser session instead of a bare scripted client.
// Build numbers change every few weeks; if Discord stops accepting this one,
// open https://discord.com/app, F12 → Network → any /api request → copy the
// request's `x-super-properties` header value.
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const SUPER_PROPS_OBJ = {
  os: 'Mac OS X',
  browser: 'Chrome',
  device: '',
  system_locale: 'en-US',
  browser_user_agent: CHROME_UA,
  browser_version: '130.0.0.0',
  os_version: '10.15.7',
  referrer: '',
  referring_domain: '',
  referrer_current: '',
  referring_domain_current: '',
  release_channel: 'stable',
  client_build_number: 357671,
  client_event_source: null,
};
const X_SUPER_PROPERTIES = Buffer.from(JSON.stringify(SUPER_PROPS_OBJ)).toString('base64');

function browserHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: authHeader(),
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': CHROME_UA,
    'X-Super-Properties': X_SUPER_PROPERTIES,
    'X-Discord-Locale': 'en-US',
    'X-Discord-Timezone': 'America/Los_Angeles',
    'X-Debug-Options': 'bugReporterEnabled',
    Origin: 'https://discord.com',
    Referer: 'https://discord.com/channels/@me',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    Connection: 'keep-alive',
    ...extra,
  };
}

interface DiscordReqOpts {
  query?: Record<string, string | undefined>;
  // If true, treat 404 as a normal "not found" return value instead of throwing.
  allow404?: boolean;
  method?: 'GET' | 'POST';
  body?: unknown;
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
  user?: DiscordUser;
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
    const headers = browserHeaders();
    let bodyInit: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyInit = JSON.stringify(opts.body);
    }
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: bodyInit,
    });
    // Randomized inter-call delay with occasional longer pauses (see
    // humanDelay() in rate-limit.ts). Replaces the previous flat 200ms.
    await humanDelay();

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

    if (res.status === 401) {
      const text = await res.text().catch(() => '<no body>');
      throw new GiveUpError(`Discord 401 (token invalid/expired) on ${path}: ${text.slice(0, 300)}`);
    }

    if (res.status === 403) {
      const text = await res.text().catch(() => '<no body>');
      throw new NoAccessError(`Discord 403 on ${path}: ${text.slice(0, 300)}`);
    }

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
 * GET /guilds/{guild.id}/members/{user.id}
 *
 * Channel message history often omits `message.member` for user-token
 * requests, even though the web client can still show server nicknames.
 * Self-posted channels need that per-server nickname for team extraction, so
 * the scraper falls back to this endpoint and caches the result per run.
 */
export async function fetchGuildMember(
  guildId: string,
  userId: string,
): Promise<DiscordMember | null> {
  const result = (await discordRequest(`/guilds/${guildId}/members/${userId}`, {
    allow404: true,
  })) as DiscordMember | null;
  return result;
}

/**
 * POST /attachments/refresh-urls
 *
 * Sends up to 50 expiring CDN URLs and gets back their newly-signed
 * counterparts. Works for both bot AND user tokens (unlike the single-message
 * endpoint, which is bot-only). Body shape:
 *   { "attachment_urls": ["https://cdn.discordapp.com/...", ...] }
 * Response shape:
 *   { "refreshed_urls": [{ "original": "...", "refreshed": "..." }, ...] }
 */
export async function refreshAttachmentUrls(
  urls: string[],
): Promise<Map<string, string>> {
  if (urls.length === 0) return new Map();
  const result = (await discordRequest('/attachments/refresh-urls', {
    method: 'POST',
    body: { attachment_urls: urls },
  })) as { refreshed_urls?: { original: string; refreshed: string }[] };
  const out = new Map<string, string>();
  for (const r of result.refreshed_urls ?? []) {
    if (r.original && r.refreshed) out.set(r.original, r.refreshed);
  }
  return out;
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
