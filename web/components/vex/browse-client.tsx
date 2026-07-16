'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ContentType, MediaItem, SeasonId, Source, Team } from '@/lib/types';
import { FeedFilters } from './feed-filters';
import { BrowseToolbar, BrowseViewToggle } from './browse-toolbar';
import { MediaCard } from './media-card';
import { TeamDetailPanel } from './team-detail-panel';
import { Lightbox } from './lightbox';
import { EmptyState } from './empty-state';
import { ChevronLeft, ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 12;
const RECENT_DAYS = 30;

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
      region: sp?.get('region') ?? 'all',
      media: sp?.get('media') ?? 'all',
      sort: sp?.get('sort') ?? 'newest',
    }),
    [sp],
  );

  const groupedItems = useMemo(() => groupBrowseItems(allItems), [allItems]);
  const teamByNumber = useMemo(() => new Map(teams.map((team) => [team.number, team])), [teams]);
  const regions = useMemo(
    () =>
      Array.from(
        new Set(
          teams
            .map((team) => team.region.trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [teams],
  );

  const [selectedId, setSelectedId] = useState<string | null>(groupedItems[0]?.id ?? null);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [pageState, setPageState] = useState({ key: '', page: 1 });
  const [panelOpen, setPanelOpen] = useState(true);
  const recentCutoff = useMemo(() => {
    const newest = Math.max(0, ...groupedItems.map((item) => new Date(item.postedAt).getTime()));
    return newest - RECENT_DAYS * 24 * 60 * 60 * 1000;
  }, [groupedItems]);
  const filterKey = `${filters.season}|${filters.sources.join(',')}|${filters.types.join(',')}|${filters.region}|${filters.media}|${filters.sort}|${view}`;

  const filtered = useMemo(() => {
    const items = groupedItems.filter((m) => {
      if (filters.season !== 'all' && m.seasonId !== filters.season) return false;
      if (filters.sources.length && !filters.sources.includes(m.source)) return false;
      if (filters.types.length && !filters.types.includes(m.contentType)) return false;
      if (filters.region !== 'all') {
        const teamNumbers = getTeamNumbers(m);
        if (!teamNumbers.some((teamNumber) => teamByNumber.get(teamNumber)?.region === filters.region)) {
          return false;
        }
      }
      if (filters.media === 'recent' && new Date(m.postedAt).getTime() < recentCutoff) return false;
      if (filters.media === 'multi' && (m.attachmentCount ?? 1) < 2) return false;
      return true;
    });
    return items.sort((a, b) => {
      if (filters.sort === 'oldest') {
        return new Date(a.postedAt).getTime() - new Date(b.postedAt).getTime();
      }
      if (filters.sort === 'team') {
        return getTeamLabel(a).localeCompare(getTeamLabel(b), undefined, { numeric: true });
      }
      if (filters.sort === 'attachments') {
        return (b.attachmentCount ?? 1) - (a.attachmentCount ?? 1);
      }
      return new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime();
    });
  }, [groupedItems, filters, teamByNumber, recentCutoff]);

  const page = pageState.key === filterKey ? pageState.page : 1;
  const visible = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = visible.length < filtered.length;
  const effectiveSelectedId =
    selectedId && filtered.some((m) => m.id === selectedId)
      ? selectedId
      : filtered[0]?.id ?? null;

  // Infinite scroll
  useEffect(() => {
    if (!hasMore) return;
    const sentinel = document.getElementById('feed-sentinel');
    if (!sentinel) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setPageState((current) => ({
            key: filterKey,
            page: (current.key === filterKey ? current.page : 1) + 1,
          }));
        }
      },
      { rootMargin: '300px' },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [filterKey, hasMore, visible.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!filtered.length) return;
      const idx = Math.max(0, filtered.findIndex((m) => m.id === effectiveSelectedId));
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = filtered[Math.min(filtered.length - 1, idx + 1)];
        if (next) setSelectedId(next.id);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = filtered[Math.max(0, idx - 1)];
        if (prev) setSelectedId(prev.id);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const current = filtered[idx];
        if (current) setLightboxId(current.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, effectiveSelectedId]);

  const selectedMedia = filtered.find((m) => m.id === effectiveSelectedId) ?? filtered[0] ?? null;
  const selectedTeams = selectedMedia
    ? getTeamNumbers(selectedMedia)
        .map((teamNumber) => teams.find((team) => team.number === teamNumber))
        .filter((team): team is Team => Boolean(team))
    : [];
  const selectedTeam = selectedTeams.length ? combineTeams(selectedTeams) : null;

  // What ←/→ page through inside the lightbox:
  //  - a genuinely multi-attachment post → its own attachments
  //  - anything else → the whole filtered feed, so arrows move post-to-post
  // NOTE: the grouping step puts an `attachments` array on *every* Discord
  // item, single ones included (length 1). So only treat it as a multi-image
  // post when length > 1 — otherwise we'd hand the lightbox a 1-item list and
  // the arrows would go nowhere (the original bug).
  const lightboxItems = useMemo(() => {
    if (!lightboxId) return [];
    const inFeed = filtered.find((x) => x.id === lightboxId);
    if (inFeed) {
      return inFeed.attachments && inFeed.attachments.length > 1
        ? inFeed.attachments
        : filtered;
    }
    const grouped = groupedItems.find((x) => x.id === lightboxId);
    if (grouped?.attachments && grouped.attachments.length > 1) return grouped.attachments;
    return grouped ? [grouped] : [];
  }, [lightboxId, filtered, groupedItems]);

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] lg:min-h-screen">
      <section className="flex flex-1 flex-col">
        <div className="space-y-4 border-b border-border px-4 py-4 lg:px-6">
          <BrowseToolbar />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FeedFilters regions={regions} />
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
            <SortSelect value={filters.sort} />
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
                  selected={effectiveSelectedId === m.id}
                  onSelect={(it) => {
                    setSelectedId(it.id);
                    setPanelOpen(true);
                  }}
                  onOpen={(it) => setLightboxId(it.id)}
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
              selectedId={effectiveSelectedId}
              onSelect={(it) => {
                setSelectedId(it.id);
                setPanelOpen(true);
              }}
              onOpen={(it) => setLightboxId(it.id)}
            />
          )}

          <Pagination total={filtered.length} pageSize={PAGE_SIZE} />
        </div>
      </section>

      {selectedTeam && panelOpen ? (
        <TeamDetailPanel
          team={selectedTeam}
          media={groupedItems
            .filter((m) => {
              const selectedNumbers = selectedTeams.map((team) => team.number);
              return getTeamNumbers(m).some((teamNumber) => selectedNumbers.includes(teamNumber));
            })
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
            'hidden lg:sticky lg:top-0 lg:flex',
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

function groupBrowseItems(items: MediaItem[]): MediaItem[] {
  const grouped = new Map<string, MediaItem[]>();
  const order: string[] = [];

  for (const item of items) {
    const key = browseGroupKey(item);
    if (!grouped.has(key)) {
      grouped.set(key, []);
      order.push(key);
    }
    grouped.get(key)!.push(item);
  }

  return order.map((key) => {
    const group = grouped.get(key)!;
    if (group[0]?.source === 'youtube') return combineYoutubeItems(group);

    const attachments = group.sort((a, b) => a.id.localeCompare(b.id));
    const primary =
      attachments.find((item) => item.contentType === 'image') ??
      attachments[0];
    return {
      ...primary,
      attachmentCount: attachments.length,
      attachments,
    };
  });
}

function browseGroupKey(item: MediaItem): string {
  if (item.source === 'youtube') {
    return `youtube:${normalizeYoutubeUrl(item.originalUrl)}`;
  }
  if (item.source === 'discord' && item.originalUrl) {
    return `${item.teamNumber ?? 'untagged'}:${item.originalUrl}`;
  }
  return item.id;
}

function combineYoutubeItems(items: MediaItem[]): MediaItem {
  const byTeam = new Map<string, MediaItem>();
  for (const item of items) {
    byTeam.set(item.teamNumber ?? 'untagged', item);
  }
  const uniqueItems = Array.from(byTeam.values()).sort((a, b) =>
    getTeamLabel(a).localeCompare(getTeamLabel(b), undefined, { numeric: true }),
  );
  const primary = uniqueItems[0] ?? items[0];
  const teamNumbers = uniqueItems
    .map((item) => item.teamNumber)
    .filter((teamNumber): teamNumber is string => Boolean(teamNumber));
  return {
    ...primary,
    id: primary.id,
    teamNumber: teamNumbers.length ? teamNumbers.join(' & ') : primary.teamNumber,
    teamNumbers,
    attachmentCount: 1,
    attachments: undefined,
  };
}

function normalizeYoutubeUrl(originalUrl: string): string {
  try {
    const url = new URL(originalUrl);
    const host = url.hostname.replace(/^www\./, '');
    const videoId =
      host === 'youtu.be'
        ? url.pathname.split('/').filter(Boolean)[0]
        : url.searchParams.get('v') ?? url.pathname.split('/').filter(Boolean).at(-1);
    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : originalUrl;
  } catch {
    return originalUrl;
  }
}

function getTeamNumbers(item: MediaItem): string[] {
  if (item.teamNumbers?.length) return item.teamNumbers;
  return item.teamNumber ? [item.teamNumber] : [];
}

function getTeamLabel(item: MediaItem): string {
  return getTeamNumbers(item).join(' & ') || item.teamNumber || '';
}

function combineTeams(teams: Team[]): Team {
  const unique = Array.from(new Map(teams.map((team) => [team.number, team])).values());
  if (unique.length === 1) return unique[0];
  const values = (key: 'organization' | 'region' | 'country') =>
    Array.from(new Set(unique.map((team) => team[key]).filter(Boolean)));
  const organizations = values('organization');
  const regions = values('region');
  const countries = values('country');
  return {
    ...unique[0],
    number: unique.map((team) => team.number).join(' & '),
    organization: organizations.length === 1 ? organizations[0] : `${unique.length} detected teams`,
    region: regions.length === 1 ? regions[0] : 'Mixed regions',
    country: countries.length === 1 ? countries[0] : '',
  };
}

function SortSelect({ value }: { value: string }) {
  const router = useRouter();
  const sp = useSearchParams();

  return (
    <label className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-2">Sort</span>
      <select
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(sp.toString());
          if (e.target.value === 'newest') next.delete('sort');
          else next.set('sort', e.target.value);
          router.replace(`?${next.toString()}`, { scroll: false });
        }}
        className="h-8 rounded-md border border-border bg-surface px-2 font-mono text-xs text-foreground outline-none hover:border-border-hover"
      >
        <option value="newest">Newest</option>
        <option value="oldest">Oldest</option>
        <option value="team">Team</option>
        <option value="attachments">Attachments</option>
      </select>
    </label>
  );
}

function ListView({
  items,
  selectedId,
  onSelect,
  onOpen,
}: {
  items: MediaItem[];
  selectedId: string | null;
  onSelect: (m: MediaItem) => void;
  onOpen: (m: MediaItem) => void;
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
            <th className="px-3 py-2 font-medium text-right">Original</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr
              key={m.id}
              onClick={() => onSelect(m)}
              onDoubleClick={() => onOpen(m)}
              tabIndex={0}
              className={`cursor-pointer border-t border-border ${
                selectedId === m.id ? 'bg-surface' : 'hover:bg-surface/60'
              }`}
            >
              <td className="px-3 py-2 font-mono text-[#7dd3fc]">{m.teamNumber ?? '—'}</td>
              <td className="px-3 py-2 truncate max-w-xs text-foreground">{m.title}</td>
              <td className="px-3 py-2 text-muted">{m.source}</td>
              <td className="px-3 py-2 text-muted">
                {m.contentType}
                {(m.attachmentCount ?? 1) > 1 ? (
                  <span className="ml-2 font-mono text-xs text-foreground">
                    x{m.attachmentCount}
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2 text-muted-2 text-xs">
                {new Date(m.postedAt).toLocaleString()}
              </td>
              <td className="px-3 py-2 text-right">
                <a
                  href={m.originalUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-foreground"
                  aria-label="Open original message"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
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
  return (
    <nav className="mt-6 flex items-center justify-between">
      <div className="text-xs text-muted">
        {total === 0 ? 'No pages' : `${pages} page${pages === 1 ? '' : 's'} at ${pageSize} per load`}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>Loaded by scroll</span>
        <span className="inline-flex h-7 items-center rounded-md border border-border bg-surface px-2 font-mono text-foreground">
          {pageSize}
        </span>
      </div>
    </nav>
  );
}
