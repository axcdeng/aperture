import { Suspense } from 'react';
import { BrowseClient } from '@/components/vex/browse-client';
import { MediaGridSkeleton } from '@/components/vex/media-grid';
import { getFeed, listTeams } from '@/lib/data';

export const metadata = {
  title: 'Browse — Aperture',
};

export const revalidate = 60;

export default async function BrowsePage() {
  // Hydrate the client with a generous slice; client-side filtering operates
  // on this set. Teams come along so the right-rail panel has metadata for
  // any card the user selects.
  const [{ items }, teams] = await Promise.all([
    getFeed({ limit: 500 }),
    listTeams(1000),
  ]);

  return (
    <Suspense
      fallback={
        <div className="p-6">
          <MediaGridSkeleton count={6} />
        </div>
      }
    >
      <BrowseClient allItems={items} teams={teams} />
    </Suspense>
  );
}
