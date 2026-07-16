// Public, unauthenticated, rate-limited: list albums so a tagging agent can
// discover which event it's working on. Returns names only (no image bytes),
// so the payload stays tiny regardless of album size.
//
//   GET /api/public/albums  ->  { albums: [{ slug, name, date, photoCount, taggedCount }] }

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db/client';
import { rateLimit, rateLimitHeaders, clientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const rl = rateLimit(`pub-albums:${clientIp(req)}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  const db = getDb();
  const events = await db
    .select({ id: schema.events.id, name: schema.events.name, slug: schema.events.slug, date: schema.events.date })
    .from(schema.events)
    .orderBy(sql`${schema.events.date} desc nulls last`, sql`${schema.events.createdAt} desc`);

  const albums = [];
  for (const e of events) {
    const [agg] = await db
      .select({
        photoCount: sql<number>`count(distinct ${schema.media.originalFilename})`,
        taggedCount: sql<number>`count(distinct ${schema.media.originalFilename}) filter (where ${schema.media.teamNumber} is not null)`,
      })
      .from(schema.media)
      .where(and(eq(schema.media.eventId, e.id), isNull(schema.media.deletedAt)));
    albums.push({
      slug: e.slug,
      name: e.name,
      date: e.date?.toISOString().slice(0, 10) ?? null,
      photoCount: Number(agg?.photoCount ?? 0),
      taggedCount: Number(agg?.taggedCount ?? 0),
    });
  }

  return NextResponse.json({ albums }, { headers: rateLimitHeaders(rl) });
}
