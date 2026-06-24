// Public URL builder for R2-mirrored images.
//
// R2_PUBLIC_BASE_URL is the bucket's public origin — a custom domain (behind
// Cloudflare's CDN, recommended) or the bucket's r2.dev dev URL, e.g.
//   https://media.example.com
//   https://pub-xxxx….r2.dev
// Object keys are produced by the scripts r2-mirror job as thumbs/<id>.webp.
//
// Must be set at build time on Vercel so next.config can allowlist the host.

const RAW_BASE = process.env.R2_PUBLIC_BASE_URL ?? '';
// Normalize: prepend https:// if given without a scheme (e.g. "media.example.com")
// and strip any trailing slash. Without a scheme, new URL()/NextResponse.redirect()
// would throw.
const BASE = RAW_BASE
  ? (/^https?:\/\//.test(RAW_BASE) ? RAW_BASE : `https://${RAW_BASE}`).replace(/\/+$/, '')
  : '';

export function isR2Configured(): boolean {
  return BASE.length > 0;
}

/** Build the public URL for an R2 object key, or null if R2 isn't configured. */
export function r2PublicUrl(key: string | null | undefined): string | null {
  if (!key || !BASE) return null;
  return `${BASE}/${key.replace(/^\/+/, '')}`;
}

/** Hostname of the public base, for next.config remotePatterns. null if unset. */
export function r2PublicHost(): string | null {
  if (!BASE) return null;
  try {
    return new URL(BASE).hostname;
  } catch {
    return null;
  }
}
