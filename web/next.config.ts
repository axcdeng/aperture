import type { NextConfig } from 'next';

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
    ],
  },
};

export default nextConfig;
