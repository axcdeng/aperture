'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, X } from 'lucide-react';
import type { ContentType, SeasonId, Source } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useState, useRef, useEffect } from 'react';

const SEASON_OPTIONS: { id: SeasonId | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'push-back', label: '25-26' },
  { id: 'high-stakes', label: '24-25' },
];

const SOURCE_OPTIONS: { id: Source; label: string }[] = [
  { id: 'discord', label: 'Discord' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'vex-cad', label: 'VEX CAD' },
  { id: 'robolytics', label: 'Robolytics' },
];

const CONTENT_OPTIONS: { id: ContentType; label: string }[] = [
  { id: 'image', label: 'Photos' },
  { id: 'video', label: 'Videos' },
  { id: 'youtube', label: 'YouTube links' },
];

function FilterPill({
  label,
  value,
  onClear,
  children,
}: {
  label: string;
  value: string;
  onClear?: () => void;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-md border bg-surface px-3 text-xs hover:border-border-hover transition-colors',
          open ? 'border-border-hover' : 'border-border',
        )}
      >
        <span className="text-[10px] uppercase tracking-wider text-muted-2">{label}</span>
        <span className="font-mono text-foreground">{value}</span>
        {onClear ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className="text-muted-2 hover:text-foreground"
            aria-label={`Clear ${label}`}
          >
            <X className="h-3 w-3" />
          </span>
        ) : (
          <ChevronDown className="h-3 w-3 text-muted-2" />
        )}
      </button>
      {open && children ? (
        <div className="absolute left-0 top-full z-30 mt-1.5 min-w-44 overflow-hidden rounded-md border border-border bg-surface-2 shadow-2xl">
          <div className="py-1" onClick={() => setOpen(false)}>
            {children}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs hover:bg-surface',
        active ? 'text-foreground' : 'text-muted',
      )}
    >
      {children}
      {active ? <span className="dot" style={{ backgroundColor: '#ededed' }} /> : null}
    </button>
  );
}

export function FeedFilters({ regions }: { regions: string[] }) {
  const router = useRouter();
  const sp = useSearchParams();

  const seasonId = (sp.get('season') as SeasonId | null) ?? 'all';
  const sources = (sp.get('source') ?? '').split(',').filter(Boolean) as Source[];
  const types = (sp.get('type') ?? '').split(',').filter(Boolean) as ContentType[];
  const media = sp.get('media') ?? 'all';
  const region = sp.get('region') ?? 'all';

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(sp.toString());
    if (!value) next.delete(key);
    else next.set(key, value);
    router.replace(`?${next.toString()}`, { scroll: false });
  }

  const seasonLabel =
    seasonId === 'all' ? 'All' : seasonId === 'push-back' ? '25-26' : '24-25';
  const sourceLabel = sources.length === 0 ? 'All' : sources.length === 1 ? sources[0] : `${sources.length} selected`;
  const typeLabel = types.length === 0 ? 'All' : types.length === 1 ? types[0] : `${types.length}`;
  const regionLabel = region === 'all' ? 'All' : region;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterPill label="Season" value={seasonLabel}>
        {SEASON_OPTIONS.map((o) => (
          <MenuItem
            key={o.id}
            active={seasonId === o.id}
            onClick={() => setParam('season', o.id === 'all' ? null : o.id)}
          >
            {o.label}
          </MenuItem>
        ))}
      </FilterPill>
      <FilterPill
        label="Region"
        value={regionLabel}
        onClear={region !== 'all' ? () => setParam('region', null) : undefined}
      >
        <MenuItem active={region === 'all'} onClick={() => setParam('region', null)}>
          All
        </MenuItem>
        {regions.map((r) => (
          <MenuItem key={r} active={region === r} onClick={() => setParam('region', r)}>
            {r}
          </MenuItem>
        ))}
      </FilterPill>
      <FilterPill
        label="Source"
        value={sourceLabel}
        onClear={sources.length ? () => setParam('source', null) : undefined}
      >
        {SOURCE_OPTIONS.map((o) => (
          <MenuItem
            key={o.id}
            active={sources.includes(o.id)}
            onClick={() => {
              const next = sources.includes(o.id)
                ? sources.filter((s) => s !== o.id)
                : [...sources, o.id];
              setParam('source', next.length ? next.join(',') : null);
            }}
          >
            {o.label}
          </MenuItem>
        ))}
      </FilterPill>
      <FilterPill
        label="Type"
        value={typeLabel}
        onClear={types.length ? () => setParam('type', null) : undefined}
      >
        {CONTENT_OPTIONS.map((o) => (
          <MenuItem
            key={o.id}
            active={types.includes(o.id)}
            onClick={() => {
              const next = types.includes(o.id)
                ? types.filter((s) => s !== o.id)
                : [...types, o.id];
              setParam('type', next.length ? next.join(',') : null);
            }}
          >
            {o.label}
          </MenuItem>
        ))}
      </FilterPill>
      <FilterPill label="Media" value={media === 'all' ? 'All' : media}>
        <MenuItem active={media === 'all'} onClick={() => setParam('media', null)}>
          All
        </MenuItem>
        <MenuItem active={media === 'recent'} onClick={() => setParam('media', 'recent')}>
          Last 30d
        </MenuItem>
        <MenuItem active={media === 'multi'} onClick={() => setParam('media', 'multi')}>
          Multi-attachment
        </MenuItem>
      </FilterPill>
    </div>
  );
}
