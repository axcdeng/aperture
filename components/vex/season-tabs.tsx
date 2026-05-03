'use client';

import { cn } from '@/lib/utils';
import { SEASONS } from '@/lib/seasons';
import type { SeasonId } from '@/lib/types';

export function SeasonTabs({
  seasons,
  activeId,
  onChange,
  counts,
}: {
  seasons: (SeasonId | 'all')[];
  activeId: SeasonId | 'all';
  onChange: (id: SeasonId | 'all') => void;
  counts?: Partial<Record<SeasonId | 'all', number>>;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-surface p-1">
      {seasons.map((id) => {
        const label = id === 'all' ? 'All' : SEASONS[id].name;
        const color = id === 'all' ? '#8f8f8f' : SEASONS[id].color;
        const active = activeId === id;
        const count = counts?.[id];
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={cn(
              'inline-flex h-7 items-center gap-2 rounded px-2.5 text-xs transition-colors',
              active
                ? 'bg-foreground text-accent-fg font-medium'
                : 'text-muted hover:text-foreground',
            )}
          >
            {id !== 'all' ? <span className="dot" style={{ backgroundColor: color }} /> : null}
            {label}
            {typeof count === 'number' ? (
              <span className={cn('font-mono text-[10px]', active ? 'text-accent-fg/70' : 'text-muted-2')}>
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
