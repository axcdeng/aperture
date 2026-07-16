// Receive a batch of browser-encoded photo derivatives for one album and
// persist them: upload the WebP objects to R2, then run the idempotent
// (event, filename) team diff. The browser has already downscaled each image
// to a ~1080px "full" + ~500px "thumb" WebP, so request bodies stay small and
// no 4K bytes ever reach R2.
//
// multipart/form-data fields (index-aligned):
//   full   : File[]  — ~1080px WebP display images (one per photo)
//   thumb  : File[]  — ~500px WebP thumbnails
//   meta   : string  — JSON array [{ filename, width, height, teams[] }]
//
// Idempotent: re-uploading the same filenames diffs against existing rows.
// Tagging is decoupled — teams may be [] here and applied later via /tags.

import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db/client';
import {
  importPhoto,
  normalizeTeamToken,
  resyncTeamCounts,
  slugify,
  emptyStats,
  addStats,
} from '@/lib/album-write';
import { albumFullKey, albumThumbKey, isR2WriteConfigured, objectExists, uploadObject } from '@/lib/r2-write';
import { rateLimit, rateLimitHeaders, clientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FULL_BYTES = 3 * 1024 * 1024; // a 1080px WebP is ~150KB; 3MB is a generous ceiling
const MAX_THUMB_BYTES = 1 * 1024 * 1024;
const MAX_BATCH = 25;

interface Meta {
  filename: string;
  width: number | null;
  height: number | null;
  teams: string[];
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const rl = rateLimit(`photos:${clientIp(req)}`, 200, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429, headers: rateLimitHeaders(rl) });
  }
  if (!isR2WriteConfigured()) {
    return NextResponse.json({ error: 'Image storage is not configured on the server.' }, { status: 503 });
  }

  const { slug } = await params;
  const db = getDb();
  const [event] = await db
    .select({ id: schema.events.id, date: schema.events.date })
    .from(schema.events)
    .where(eq(schema.events.slug, slug))
    .limit(1);
  if (!event) return NextResponse.json({ error: 'Album not found' }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const fulls = form.getAll('full').filter((f): f is File => f instanceof File);
  const thumbs = form.getAll('thumb').filter((f): f is File => f instanceof File);
  let meta: Meta[];
  try {
    meta = JSON.parse(String(form.get('meta') ?? '[]'));
  } catch {
    return NextResponse.json({ error: 'Invalid meta JSON' }, { status: 400 });
  }
  if (!Array.isArray(meta) || meta.length !== fulls.length || thumbs.length !== fulls.length) {
    return NextResponse.json({ error: 'full/thumb/meta count mismatch' }, { status: 400 });
  }
  if (fulls.length === 0) return NextResponse.json({ error: 'No photos in batch' }, { status: 400 });
  if (fulls.length > MAX_BATCH) {
    return NextResponse.json({ error: `Batch too large (max ${MAX_BATCH})` }, { status: 400 });
  }

  const postedAt = event.date ?? new Date();
  let stats = emptyStats();
  const touched = new Set<string>();
  const errors: { filename: string; error: string }[] = [];

  for (let i = 0; i < fulls.length; i++) {
    const m = meta[i];
    const filename = typeof m?.filename === 'string' ? m.filename : '';
    try {
      if (!filename) throw new Error('missing filename');
      const fullBuf = Buffer.from(await fulls[i].arrayBuffer());
      const thumbBuf = Buffer.from(await thumbs[i].arrayBuffer());
      if (fullBuf.length > MAX_FULL_BYTES) throw new Error('full image exceeds size limit');
      if (thumbBuf.length > MAX_THUMB_BYTES) throw new Error('thumb exceeds size limit');

      const hash = createHash('sha256').update(fullBuf).digest('hex').slice(0, 8);
      const stem = filename.replace(/\.[^.]+$/, '');
      const keySlug = `${slugify(stem) || 'photo'}-${hash}`;
      const fullKey = albumFullKey(event.id, keySlug);
      const thumbKey = albumThumbKey(event.id, keySlug);

      if (!(await objectExists(fullKey))) await uploadObject(fullKey, fullBuf, 'image/webp');
      if (!(await objectExists(thumbKey))) await uploadObject(thumbKey, thumbBuf, 'image/webp');

      const teams = Array.isArray(m.teams)
        ? Array.from(new Set(m.teams.map(normalizeTeamToken).filter((t): t is string => !!t)))
        : [];
      const width = Number.isFinite(m.width) ? Number(m.width) : null;
      const height = Number.isFinite(m.height) ? Number(m.height) : null;

      const res = await importPhoto({
        eventId: event.id,
        filename,
        teams,
        r2Key: thumbKey,
        r2FullKey: fullKey,
        width,
        height,
        postedAt,
      });
      stats = addStats(stats, res.stats);
      res.touched.forEach((t) => touched.add(t));
    } catch (e) {
      errors.push({ filename, error: e instanceof Error ? e.message : String(e) });
    }
  }

  try {
    await resyncTeamCounts(touched);
  } catch {
    /* count resync is best-effort */
  }
  revalidatePath('/albums');
  revalidatePath(`/albums/${slug}`);

  return NextResponse.json({ ok: true, stats, errors, received: fulls.length });
}
