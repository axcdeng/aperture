import { NextResponse } from 'next/server';
import { searchTeams } from '@/lib/data';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? '';
  const results = await searchTeams(q, 8);
  return NextResponse.json({ results });
}
