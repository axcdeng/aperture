import { AlertTriangle } from 'lucide-react';
import { getUntaggedMedia } from '@/lib/data';
import { UntaggedClient } from '@/components/vex/untagged-client';

export const metadata = { title: 'Untagged — VEX Scout' };
export const revalidate = 60;

export default async function UntaggedPage() {
  const items = await getUntaggedMedia();
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-5 flex items-center gap-2 rounded-md border border-[#3b2a0a] bg-[#1a1305] px-3 py-2 text-xs text-[#f59e0b]">
        <AlertTriangle className="h-3.5 w-3.5" />
        Admin only — gate this route with a Discord ID check when auth is added.
      </div>
      <h1 className="text-xl font-semibold tracking-tight">Untagged media</h1>
      <p className="mb-6 mt-1 text-xs text-muted">
        Media collected without an obvious team number. Assign or dismiss to clear the queue.
      </p>
      <UntaggedClient items={items} />
    </div>
  );
}
