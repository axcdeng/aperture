// Public, unauthenticated, rate-limited: report which photos in an album are
// already present (and their teams), so a tagging agent resuming a multi-day
// event can skip images someone else already sorted. Filenames only — no image
// bytes — so the response is tiny even for thousands of photos.
//
//   GET /api/public/albums/<slug>/sorted
//   -> { event, count, taggedCount, photos: { "IMG_0142.jpg": ["5588B"], "IMG_0143.jpg": [] } }
//
// A filename appearing here means its bytes are already in R2. `[]` = uploaded
// but untagged (or explicitly no-robot). Skip any filename already listed.

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db/client';
import { rateLimit, rateLimitHeaders, clientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const rl = rateLimit(`pub-sorted:${clientIp(req)}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  const { slug } = await params;
  const db = getDb();
  const [event] = await db
    .select({ id: schema.events.id, name: schema.events.name })
    .from(schema.events)
    .where(eq(schema.events.slug, slug))
    .limit(1);
  if (!event) return NextResponse.json({ error: 'Album not found' }, { status: 404 });

  const rows = await db
    .select({ filename: schema.media.originalFilename, team: schema.media.teamNumber })
    .from(schema.media)
    .where(
      and(
        eq(schema.media.eventId, event.id),
        isNull(schema.media.deletedAt),
        isNotNull(schema.media.originalFilename),
      ),
    );

  const photos: Record<string, string[]> = {};
  for (const r of rows) {
    const f = r.filename as string;
    if (!photos[f]) photos[f] = [];
    if (r.team && !photos[f].includes(r.team)) photos[f].push(r.team);
  }
  for (const f of Object.keys(photos)) {
    photos[f].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  const taggedCount = Object.values(photos).filter((t) => t.length > 0).length;

  return NextResponse.json(
    { event: event.name, slug, count: Object.keys(photos).length, taggedCount, photos },
    { headers: rateLimitHeaders(rl) },
  );
}
