'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import type { MediaItem, SeasonId, Team } from '@/lib/types';
import { TeamNumber } from './team-number';
import { SeasonTabs } from './season-tabs';
import { MediaGrid } from './media-grid';
import { EmptyState } from './empty-state';
import { Lightbox } from './lightbox';
import { StatRow } from './stat-row';
import { formatRelativeTime } from '@/lib/utils';

export function TeamPageClient({
  team,
  media,
  initialMediaId,
}: {
  team: Team;
  media: MediaItem[];
  initialMediaId?: string;
}) {
  const router = useRouter();
  const [season, setSeason] = useState<SeasonId | 'all'>('all');
  const [activeId, setActiveId] = useState<string | null>(initialMediaId ?? null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveId(initialMediaId ?? null);
  }, [initialMediaId]);

  const seasonsPresent = useMemo(() => {
    const set = new Set<SeasonId>();
    media.forEach((m) => set.add(m.seasonId));
    return Array.from(set);
  }, [media]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: media.length };
    media.forEach((m) => {
      c[m.seasonId] = (c[m.seasonId] ?? 0) + 1;
    });
    return c;
  }, [media]);

  const filtered = useMemo(
    () => (season === 'all' ? media : media.filter((m) => m.seasonId === season)),
    [season, media],
  );

  const tabs: (SeasonId | 'all')[] =
    seasonsPresent.length > 1 ? ['all', ...seasonsPresent] : seasonsPresent;

  function open(id: string) {
    setActiveId(id);
    window.history.replaceState({}, '', `/team/${team.number}/media/${id}`);
  }

  function close() {
    setActiveId(null);
    router.replace(`/team/${team.number}`, { scroll: false });
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href="/browse"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground"
      >
        <ChevronLeft className="h-3 w-3" /> Back to feed
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <TeamNumber number={team.number} size="xl" />
          <h1 className="mt-1 text-lg text-foreground">{team.organization}</h1>
          <div className="text-xs text-muted">
            {team.region} · First seen {formatRelativeTime(team.firstSeenAt)}
          </div>
        </div>
        {tabs.length > 0 ? (
          <SeasonTabs seasons={tabs} activeId={season} onChange={setSeason} counts={counts} />
        ) : null}
      </header>

      <div className="mt-6">
        <StatRow
          items={[
            { label: 'Reveals', value: media.length.toString() },
            {
              label: 'Last activity',
              value: media[0] ? formatRelativeTime(media[0].postedAt) : '—',
            },
            { label: 'Sources', value: new Set(media.map((m) => m.source)).size.toString() },
            { label: 'Seasons', value: seasonsPresent.length.toString() },
          ]}
        />
      </div>

      <div className="mt-6">
        {filtered.length === 0 ? (
          <EmptyState
            title="No media for this season."
            description="Check another season tab or browse the full feed."
          />
        ) : (
          <MediaGrid
            items={filtered}
            selectedId={activeId ?? undefined}
            onSelect={(it) => open(it.id)}
          />
        )}
      </div>

      <Lightbox
        items={filtered.length ? filtered : media}
        activeId={activeId}
        onClose={close}
        onChange={(id) => open(id)}
      />
    </div>
  );
}
