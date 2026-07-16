// Resolve photo keys ("<eventId>/<filename>") to MediaItems for the Tags page.
// Tag→photo membership lives in the browser (localStorage), so the client POSTs
// the keys and we hydrate them into real media rows (with R2 URLs + teams).

import { NextRequest, NextResponse } from 'next/server';
import { getMediaByKeys } from '@/lib/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_KEYS = 5000;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const keys = (body as { keys?: unknown })?.keys;
  if (!Array.isArray(keys)) {
    return NextResponse.json({ error: 'Expected { keys: string[] }' }, { status: 400 });
  }
  const clean = keys.filter((k): k is string => typeof k === 'string').slice(0, MAX_KEYS);
  const items = await getMediaByKeys(clean);
  return NextResponse.json({ items });
}
