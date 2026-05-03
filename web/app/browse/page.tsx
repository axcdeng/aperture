import { Suspense } from 'react';
import { SEED_MEDIA, SEED_TEAMS } from '@/lib/seed';
import { BrowseClient } from '@/components/vex/browse-client';
import { MediaGridSkeleton } from '@/components/vex/media-grid';

export const metadata = {
  title: 'Browse — VEX Scout',
};

export default function BrowsePage() {
  const items = SEED_MEDIA.filter((m) => m.teamNumber !== null);
  return (
    <Suspense
      fallback={
        <div className="p-6">
          <MediaGridSkeleton count={6} />
        </div>
      }
    >
      <BrowseClient allItems={items} teams={SEED_TEAMS} />
    </Suspense>
  );
}
