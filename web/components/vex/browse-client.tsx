'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ContentType, MediaItem, SeasonId, Source, Team } from '@/lib/types';
import { FeedFilters } from './feed-filters';
import { BrowseToolbar, BrowseViewToggle } from './browse-toolbar';
import { MediaCard } from './media-card';
import { TeamDetailPanel } from './team-detail-panel';
import { Lightbox } from './lightbox';
import { EmptyState } from './empty-state';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 12;

export function BrowseClient({
  allItems,
  teams,
}: {
  allItems: MediaItem[];
  teams: Team[];
}) {
  const sp = useSearchParams();
  const filters = useMemo(
    () => ({
      season: ((sp?.get('season') as SeasonId | null) ?? 'all') as SeasonId | 'all',
      sources: ((sp?.get('source')?.split(',').filter(Boolean) ?? []) as Source[]),
      types: ((sp?.get('type')?.split(',').filter(Boolean) ?? []) as ContentType[]),
    }),
    [sp],
  );

  const [selectedId, setSelectedId] = useState<string | null>(allItems[0]?.id ?? null);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [page, setPage] = useState(1);
  const [panelOpen, setPanelOpen] = useState(true);

  const filtered = useMemo(() => {
    return allItems.filter((m) => {
      if (filters.season !== 'all' && m.seasonId !== filters.season) return false;
      if (filters.sources.length && !filters.sources.includes(m.source)) return false;
      if (filters.types.length && !filters.types.includes(m.contentType)) return false;
      return true;
    });
  }, [allItems, filters]);

  const visible = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = visible.length < filtered.length;

  // Infinite scroll
  useEffect(() => {
    if (!hasMore) return;
    const sentinel = document.getElementById('feed-sentinel');
    if (!sentinel) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setPage((p) => p + 1);
      },
      { rootMargin: '300px' },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [hasMore, visible.length]);

  const selectedMedia = filtered.find((m) => m.id === selectedId) ?? filtered[0] ?? null;
  const selectedTeam =
    selectedMedia && selectedMedia.teamNumber
      ? teams.find((t) => t.number === selectedMedia.teamNumber) ?? null
      : null;

  // Build sibling list for lightbox = same team's media
  const lightboxItems = useMemo(() => {
    if (!lightboxId) return [];
    const m = filtered.find((x) => x.id === lightboxId) ?? allItems.find((x) => x.id === lightboxId);
    if (!m || !m.teamNumber) return filtered;
    return allItems.filter((x) => x.teamNumber === m.teamNumber);
  }, [lightboxId, filtered, allItems]);

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] lg:min-h-screen">
      <section className="flex flex-1 flex-col">
        <div className="space-y-4 border-b border-border px-4 py-4 lg:px-6">
          <BrowseToolbar />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FeedFilters />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="text-[10px] uppercase tracking-wider text-muted-2">Results</span>
            <span className="font-mono text-foreground">{filtered.length.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="hidden sm:inline-flex items-center gap-1.5">
              <kbd className="rounded border border-border bg-surface px-1 font-mono text-[10px]">J</kbd>
              <span className="text-muted-2">/</span>
              <kbd className="rounded border border-border bg-surface px-1 font-mono text-[10px]">K</kbd>
              <span>navigate</span>
            </span>
            <span className="hidden sm:inline-flex items-center gap-1.5">
              <kbd className="rounded border border-border bg-surface px-1 font-mono text-[10px]">Enter</kbd>
              <span>open</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-2">Sort</span>
              <span className="font-mono text-foreground">Newest</span>
            </div>
            <BrowseViewToggle view={view} onChange={setView} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          {filtered.length === 0 ? (
            <EmptyState
              title="No media matches these filters."
              description="Try clearing a filter or switching seasons."
            />
          ) : view === 'grid' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((m) => (
                <MediaCard
                  key={m.id}
                  item={m}
                  selected={selectedId === m.id}
                  onSelect={(it) => {
                    if (selectedId === it.id) setLightboxId(it.id);
                    else setSelectedId(it.id);
                  }}
                />
              ))}
              <div
                id="feed-sentinel"
                className="col-span-full rounded-lg border border-dashed border-border bg-surface/40 p-6 text-center text-xs text-muted"
              >
                {hasMore ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading more results…
                  </span>
                ) : (
                  <span>End of feed.</span>
                )}
              </div>
            </div>
          ) : (
            <ListView
              items={visible}
              selectedId={selectedId}
              onSelect={(it) => {
                if (selectedId === it.id) setLightboxId(it.id);
                else setSelectedId(it.id);
              }}
            />
          )}

          <Pagination total={filtered.length} pageSize={PAGE_SIZE} />
        </div>
      </section>

      {selectedTeam && panelOpen ? (
        <TeamDetailPanel
          team={selectedTeam}
          media={allItems
            .filter((m) => m.teamNumber === selectedTeam.number)
            .sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime())}
          selectedMedia={selectedMedia}
          onClose={() => setPanelOpen(false)}
        />
      ) : null}

      {/* Re-open tab when the panel is hidden. Sticky to the right edge. */}
      {selectedTeam && !panelOpen ? (
        <button
          onClick={() => setPanelOpen(true)}
          aria-label="Show team details"
          className={cn(
            'hidden xl:sticky xl:top-0 xl:flex',
            'h-screen w-7 shrink-0 items-center justify-center border-l border-border bg-background text-muted hover:bg-surface hover:text-foreground transition-colors',
          )}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      ) : null}

      <Lightbox
        items={lightboxItems}
        activeId={lightboxId}
        onClose={() => setLightboxId(null)}
        onChange={(id) => setLightboxId(id)}
      />
    </div>
  );
}

function ListView({
  items,
  selectedId,
  onSelect,
}: {
  items: MediaItem[];
  selectedId: string | null;
  onSelect: (m: MediaItem) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted-2">
          <tr className="text-left">
            <th className="px-3 py-2 font-medium">Team</th>
            <th className="px-3 py-2 font-medium">Title</th>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Posted</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr
              key={m.id}
              onClick={() => onSelect(m)}
              className={`cursor-pointer border-t border-border ${
                selectedId === m.id ? 'bg-surface' : 'hover:bg-surface/60'
              }`}
            >
              <td className="px-3 py-2 font-mono text-[#7dd3fc]">{m.teamNumber ?? '—'}</td>
              <td className="px-3 py-2 truncate max-w-xs text-foreground">{m.title}</td>
              <td className="px-3 py-2 text-muted">{m.source}</td>
              <td className="px-3 py-2 text-muted">{m.contentType}</td>
              <td className="px-3 py-2 text-muted-2 text-xs">
                {new Date(m.postedAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pagination({ total, pageSize }: { total: number; pageSize: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const display = [1, 2, 3, 4, '…', pages];
  return (
    <nav className="mt-6 flex items-center justify-between">
      <div className="flex items-center gap-1 text-xs text-muted">
        <PageBtn>«</PageBtn>
        <PageBtn>‹</PageBtn>
        {display.map((p, i) => (
          <PageBtn key={i} active={p === 1}>
            {p}
          </PageBtn>
        ))}
        <PageBtn>›</PageBtn>
        <PageBtn>»</PageBtn>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>Show</span>
        <span className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 font-mono text-foreground">
          {pageSize * 2 + 6}
        </span>
      </div>
    </nav>
  );
}

function PageBtn({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <button
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md px-2 font-mono ${
        active ? 'border border-border-hover bg-surface text-foreground' : 'text-muted hover:bg-surface'
      }`}
    >
      {children}
    </button>
  );
}
