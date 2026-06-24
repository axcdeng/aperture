// On-demand Discord-CDN image proxy.
//
// The frontend embeds /api/img/<media_id>?v=thumb instead of a raw signed
// CDN URL. On every request we check the row's cdn_expires_at — if the
// stored URL is still valid we 302 to it; otherwise we hit Discord's
// /attachments/refresh-urls endpoint live, save the fresh URLs, and 302 to
// the new one. This means images keep working even if the cron refresher
// missed a row.
//
// next/image fetches this route directly and caches the optimized result at
// Vercel's edge per `minimumCacheTTL` in next.config. We return the upstream
// bytes instead of redirecting so the optimizer never has to chase Discord's
// expiring signed URL itself.

import { and, eq, isNull } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/lib/db/client';
import { parseCdnExpiry, refreshAttachmentUrls } from '@/lib/discord/refresh';
import { r2PublicUrl } from '@/lib/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// If the stored URL expires within this many ms from now, refresh inline
// before redirecting. 1 hour is comfortable headroom on Discord's ~24h
// signed-URL lifetime.
const REFRESH_HORIZON_MS = 60 * 60 * 1000;
const DEVICE_CACHE_SECONDS = 60 * 60 * 24;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const variant = req.nextUrl.searchParams.get('v') === 'full' ? 'full' : 'thumb';

  const db = getDb();
  const [row] = await db
    .select({
      id: schema.media.id,
      source: schema.media.source,
      r2Key: schema.media.r2Key,
      cdnUrl: schema.media.cdnUrl,
      cdnThumbUrl: schema.media.cdnThumbUrl,
      cdnExpiresAt: schema.media.cdnExpiresAt,
    })
    .from(schema.media)
    .where(and(eq(schema.media.id, id), isNull(schema.media.deletedAt)))
    .limit(1);

  if (!row) return new NextResponse('Not found', { status: 404 });

  // If a durable R2 copy exists, send the client straight there (free egress,
  // never expires). Covers any caller still hitting the proxy directly.
  const r2 = r2PublicUrl(row.r2Key);
  if (r2) return NextResponse.redirect(r2, 308);

  if (row.source !== 'discord' || !row.cdnUrl) {
    return new NextResponse('Not a Discord-hosted asset', { status: 400 });
  }

  const expiresAt = row.cdnExpiresAt ? row.cdnExpiresAt.getTime() : 0;
  const needsRefresh = !expiresAt || expiresAt - Date.now() < REFRESH_HORIZON_MS;

  let cdnUrl = row.cdnUrl;
  let cdnThumbUrl = row.cdnThumbUrl ?? row.cdnUrl;

  if (needsRefresh) {
    try {
      const candidates = Array.from(
        new Set([row.cdnUrl, row.cdnThumbUrl].filter((u): u is string => Boolean(u))),
      );
      const fresh = await refreshAttachmentUrls(candidates);
      const newCdn = fresh.get(row.cdnUrl) ?? cdnUrl;
      const newThumb =
        (row.cdnThumbUrl && fresh.get(row.cdnThumbUrl)) ?? cdnThumbUrl;
      const newExpiry = parseCdnExpiry(newCdn);

      if (newCdn !== cdnUrl || newThumb !== cdnThumbUrl) {
        await db
          .update(schema.media)
          .set({
            cdnUrl: newCdn,
            cdnThumbUrl: newThumb,
            cdnExpiresAt: newExpiry,
          })
          .where(eq(schema.media.id, id));
      }
      cdnUrl = newCdn;
      cdnThumbUrl = newThumb;
    } catch (err) {
      // Refresh failed — fall through and try the existing URL anyway. If
      // it's truly expired, Discord will return 404 to the optimizer; the
      // cron refresher will pick it up on its next pass.
      console.warn('[img-proxy] refresh failed for', id, err);
    }
  }

  const target = variant === 'full' ? cdnUrl : cdnThumbUrl;
  if (!target) return new NextResponse('No URL available', { status: 404 });

  const upstream = await fetch(target, {
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    },
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    return new NextResponse(`Discord asset fetch failed (${upstream.status}) ${text.slice(0, 120)}`, {
      status: upstream.status === 404 ? 404 : 502,
    });
  }

  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) {
    return new NextResponse(`Unexpected Discord asset type: ${contentType}`, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${DEVICE_CACHE_SECONDS}`,
    },
  });
}
