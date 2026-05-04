// On-demand Discord-CDN image proxy.
//
// The frontend embeds /api/img/<media_id>?v=thumb instead of a raw signed
// CDN URL. On every request we check the row's cdn_expires_at — if the
// stored URL is still valid we 302 to it; otherwise we hit Discord's
// /attachments/refresh-urls endpoint live, save the fresh URLs, and 302 to
// the new one. This means images keep working even if the cron refresher
// missed a row.
//
// next/image follows the redirect upstream and caches the optimized result
// at Vercel's edge per `minimumCacheTTL` in next.config.

import { and, eq, isNull } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/lib/db/client';
import { parseCdnExpiry, refreshAttachmentUrls } from '@/lib/discord/refresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// If the stored URL expires within this many ms from now, refresh inline
// before redirecting. 1 hour is comfortable headroom on Discord's ~24h
// signed-URL lifetime.
const REFRESH_HORIZON_MS = 60 * 60 * 1000;

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
      cdnUrl: schema.media.cdnUrl,
      cdnThumbUrl: schema.media.cdnThumbUrl,
      cdnExpiresAt: schema.media.cdnExpiresAt,
    })
    .from(schema.media)
    .where(and(eq(schema.media.id, id), isNull(schema.media.deletedAt)))
    .limit(1);

  if (!row) return new NextResponse('Not found', { status: 404 });
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

  // Short browser cache; the upstream Discord URL has its own ~24h expiry.
  // Vercel's image optimizer uses minimumCacheTTL (set in next.config) for
  // its own cache layer, which is the one that actually matters for cost.
  return NextResponse.redirect(target, { status: 302, headers: { 'Cache-Control': 'public, max-age=300' } });
}
