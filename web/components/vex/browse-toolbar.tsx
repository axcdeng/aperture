'use client';

import { History, Bookmark, SlidersHorizontal, Grid2x2, List } from 'lucide-react';
import { SearchBar } from './search-bar';

export function BrowseToolbar() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex-1">
        <SearchBar />
      </div>
      <div className="flex items-center gap-1">
        <ToolbarBtn aria-label="Recent">
          <History className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn aria-label="Saved">
          <Bookmark className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn aria-label="Sort">
          <SlidersHorizontal className="h-4 w-4" />
        </ToolbarBtn>
      </div>
    </div>
  );
}

function ToolbarBtn(props: React.ComponentProps<'button'>) {
  return (
    <button
      {...props}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-muted hover:border-border-hover hover:text-foreground"
    />
  );
}

export function BrowseViewToggle({
  view,
  onChange,
}: {
  view: 'grid' | 'list';
  onChange: (v: 'grid' | 'list') => void;
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-surface p-1">
      <button
        onClick={() => onChange('grid')}
        aria-label="Grid view"
        className={`inline-flex h-7 w-7 items-center justify-center rounded ${
          view === 'grid' ? 'bg-foreground text-accent-fg' : 'text-muted hover:text-foreground'
        }`}
      >
        <Grid2x2 className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => onChange('list')}
        aria-label="List view"
        className={`inline-flex h-7 w-7 items-center justify-center rounded ${
          view === 'list' ? 'bg-foreground text-accent-fg' : 'text-muted hover:text-foreground'
        }`}
      >
        <List className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
