'use client';

import type { MediaItem } from '@/lib/types';
import { MediaCard } from './media-card';

export function MediaGrid({
  items,
  selectedId,
  onSelect,
  hrefBase,
}: {
  items: MediaItem[];
  selectedId?: string;
  onSelect?: (item: MediaItem) => void;
  hrefBase?: (item: MediaItem) => string;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((m) => (
        <MediaCard
          key={m.id}
          item={m}
          selected={selectedId === m.id}
          onSelect={onSelect}
          href={onSelect ? undefined : hrefBase ? hrefBase(m) : undefined}
        />
      ))}
    </div>
  );
}

export function MediaGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-surface">
          <div className="aspect-[4/3] skeleton rounded-t-lg" />
          <div className="space-y-2 p-3">
            <div className="skeleton h-4 w-1/3" />
            <div className="skeleton h-3 w-1/2" />
            <div className="skeleton h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
