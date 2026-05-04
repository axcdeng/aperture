// Tiny Discord client used by the on-demand image proxy at /api/img/[id].
// Mirrors scripts/src/lib/discord-api.ts but kept independent so the two
// packages stay decoupled. Server-side only.

const DISCORD_BASE = 'https://discord.com/api/v10';

function authHeader(): string {
  const token = process.env.DISCORD_USER_TOKEN;
  if (!token) {
    throw new Error('DISCORD_USER_TOKEN not configured for the web app.');
  }
  return token;
}

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

/** POST /attachments/refresh-urls — accepts up to 50 URLs at a time. */
export async function refreshAttachmentUrls(
  urls: string[],
): Promise<Map<string, string>> {
  if (urls.length === 0) return new Map();
  const res = await fetch(`${DISCORD_BASE}/attachments/refresh-urls`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ attachment_urls: urls }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Discord refresh-urls ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    refreshed_urls?: { original: string; refreshed: string }[];
  };
  const out = new Map<string, string>();
  for (const r of data.refreshed_urls ?? []) {
    if (r.original && r.refreshed) out.set(r.original, r.refreshed);
  }
  return out;
}
