// Apply a tags.json manifest to an album, independent of photo uploads.
//
// Tagging keys purely on filename, so this works whether the photos were just
// uploaded, uploaded earlier, or uploaded by someone else — and it's safe for a
// manifest that repeats already-tagged photos (idempotent) or that lists only
// new ones. Entries whose photo isn't in the album yet are reported as skipped
// (we can't tag bytes that were never uploaded).
//
// Body JSON (the manifest the tagging skill produces):
//   { event?: string, photos: { "IMG_0142.jpg": ["5588B","7700H"], ... } }

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db/client';
import { applyTags, addStats, emptyStats, normalizeTeamToken, resyncTeamCounts } from '@/lib/album-write';
import { rateLimit, rateLimitHeaders, clientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ENTRIES = 10_000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const rl = rateLimit(`tags:${clientIp(req)}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  const { slug } = await params;
  const db = getDb();
  const [event] = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(eq(schema.events.slug, slug))
    .limit(1);
  if (!event) return NextResponse.json({ error: 'Album not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const photos = (body as { photos?: unknown })?.photos;
  if (!photos || typeof photos !== 'object' || Array.isArray(photos)) {
    return NextResponse.json({ error: 'Expected { photos: { filename: string[] } }' }, { status: 400 });
  }
  const entries = Object.entries(photos as Record<string, unknown>).slice(0, MAX_ENTRIES);

  let stats = emptyStats();
  const touched = new Set<string>();
  for (const [filename, raw] of entries) {
    const teams = Array.isArray(raw)
      ? Array.from(new Set(raw.map(normalizeTeamToken).filter((t): t is string => !!t)))
      : [];
    try {
      const res = await applyTags({ eventId: event.id, filename, teams });
      stats = addStats(stats, res.stats);
      res.touched.forEach((t) => touched.add(t));
    } catch {
      /* per-file failure — continue with the rest */
    }
  }

  try {
    await resyncTeamCounts(touched);
  } catch {
    /* best-effort */
  }
  revalidatePath('/albums');
  revalidatePath(`/albums/${slug}`);

  return NextResponse.json({ ok: true, stats, entries: entries.length });
}
