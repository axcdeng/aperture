import type { NextConfig } from 'next';

// Allowlist the R2 public origin (custom domain or r2.dev) for next/image.
// Derived from R2_PUBLIC_BASE_URL at build time; falls back to the generic
// r2.dev wildcard so a dev-URL bucket works even if the var is unset.
function r2RemotePatterns() {
  const patterns: { protocol: 'https'; hostname: string }[] = [
    { protocol: 'https', hostname: '*.r2.dev' },
  ];
  let base = process.env.R2_PUBLIC_BASE_URL;
  if (base) {
    // Tolerate a scheme-less value (e.g. "media.example.com") so a valid
    // custom domain isn't silently dropped from the allowlist.
    if (!/^https?:\/\//.test(base)) base = `https://${base}`;
    try {
      patterns.push({ protocol: 'https', hostname: new URL(base).hostname });
    } catch {
      // ignore an unparseable value
    }
  }
  return patterns;
}

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  images: {
    // Hold optimized variants on the edge for 24h. Once a request resolves
    // through /api/img and Vercel caches the optimized bytes, subsequent
    // requests for the same variant skip both our proxy AND Discord.
    minimumCacheTTL: 60 * 60 * 24,
    // /api/img/<id>?v=thumb is our on-demand Discord proxy. Local URLs with
    // query strings have to be explicitly allowed.
    localPatterns: [
      { pathname: '/aperture.png', search: '' },
      { pathname: '/api/img/**', search: '' },
      { pathname: '/api/img/**' },
    ],
    remotePatterns: [
      { protocol: 'https', hostname: 'picsum.photos' },
      { protocol: 'https', hostname: 'fastly.picsum.photos' },
      { protocol: 'https', hostname: 'i.ytimg.com' },
      { protocol: 'https', hostname: 'i9.ytimg.com' },
      { protocol: 'https', hostname: 'cdn.discordapp.com' },
      { protocol: 'https', hostname: 'media.discordapp.net' },
      ...r2RemotePatterns(),
    ],
  },
};

export default nextConfig;
