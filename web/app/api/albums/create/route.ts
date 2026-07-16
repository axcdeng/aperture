// Create an empty album (event). Public + rate-limited: this is how anyone
// starts a new competition album before uploading photos to it. Body JSON:
//   { name: string, date?: "YYYY-MM-DD" | ISO, location?: string, note?: string }

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { resolveOrCreateEvent } from '@/lib/album-write';
import { rateLimit, rateLimitHeaders, clientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const rl = rateLimit(`create:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const b = body as { name?: unknown; date?: unknown; location?: unknown; note?: unknown };
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  if (name.length > 120) return NextResponse.json({ error: 'Name too long' }, { status: 400 });

  let date: Date | null = null;
  if (typeof b.date === 'string' && b.date.trim()) {
    const d = new Date(b.date);
    if (isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    date = d;
  }
  const location =
    typeof b.location === 'string' && b.location.trim() ? b.location.trim().slice(0, 200) : null;
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 500) : null;

  try {
    const { slug } = await resolveOrCreateEvent({ name, date, location, note });
    revalidatePath('/albums');
    revalidatePath(`/albums/${slug}`);
    return NextResponse.json({ ok: true, slug });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to create album';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
