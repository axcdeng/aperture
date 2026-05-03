'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, History, Sliders, Bookmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SearchSuggestion } from '@/lib/types';
import { TeamNumber } from './team-number';

const RECENT_KEY = 'vex-scout:recent-searches';

function loadRecent(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveRecent(q: string) {
  if (typeof window === 'undefined') return;
  const cur = loadRecent().filter((x) => x.toLowerCase() !== q.toLowerCase());
  cur.unshift(q);
  localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, 5)));
}

export function SearchBar({
  variant = 'default',
  placeholder = 'Jump to team, match, or keyword…',
  showShortcut = true,
}: {
  variant?: 'default' | 'large';
  placeholder?: string;
  showShortcut?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchSuggestion[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecents(loadRecent());
  }, []);

  // Global '/' shortcut to focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (e.key === '/' && !isTyping) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Click-outside
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Debounced search
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.results ?? []);
        }
      } finally {
        setLoading(false);
      }
    }, 100);
    return () => clearTimeout(id);
  }, [q]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function go(num: string, label?: string) {
    saveRecent(label ?? num);
    setOpen(false);
    setQ('');
    router.push(`/team/${num}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const sel = results[highlight];
      if (sel) {
        go(sel.team.number);
      } else if (q.trim()) {
        saveRecent(q);
        setOpen(false);
        router.push(`/search?q=${encodeURIComponent(q)}`);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={wrapRef} className="relative w-full">
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border border-border bg-surface transition-colors',
          'focus-within:border-border-hover',
          variant === 'large' ? 'h-12 px-3' : 'h-9 px-2.5',
        )}
      >
        <Search className="h-4 w-4 text-muted-2 shrink-0" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={cn(
            'flex-1 bg-transparent font-sans text-foreground placeholder:text-muted-2 outline-none',
            variant === 'large' ? 'text-base' : 'text-sm',
          )}
          aria-label="Search teams"
        />
        {showShortcut ? (
          <kbd className="hidden sm:inline-flex h-5 items-center rounded border border-border bg-surface-2 px-1.5 font-mono text-[10px] text-muted">
            ⌘K
          </kbd>
        ) : null}
      </div>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-md border border-border bg-surface-2 shadow-2xl">
          {loading ? (
            <div className="p-3 text-xs text-muted">Searching…</div>
          ) : q.trim() ? (
            results.length === 0 ? (
              <div className="p-3 text-xs text-muted">
                No teams matching <span className="font-mono text-foreground">{q}</span>
              </div>
            ) : (
              <ul role="listbox" className="max-h-80 overflow-y-auto py-1">
                {results.map((r, i) => (
                  <li key={r.team.number}>
                    <button
                      onClick={() => go(r.team.number)}
                      onMouseEnter={() => setHighlight(i)}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 px-3 py-2 text-left',
                        i === highlight ? 'bg-surface' : 'hover:bg-surface',
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <TeamNumber number={r.team.number} size="md" />
                        <div className="min-w-0">
                          <div className="truncate text-sm text-foreground">
                            {r.team.organization}
                          </div>
                          <div className="truncate text-xs text-muted">{r.team.region}</div>
                        </div>
                      </div>
                      <span className="font-mono text-xs text-muted-2">{r.contentCount}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : recents.length > 0 ? (
            <div className="py-1">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-2">
                Recent
              </div>
              <ul>
                {recents.map((r) => (
                  <li key={r}>
                    <button
                      onClick={() => {
                        setQ(r);
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-foreground hover:bg-surface"
                    >
                      <History className="h-3.5 w-3.5 text-muted-2" />
                      <span className="font-mono">{r}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="px-3 py-3 text-xs text-muted">
              Type to search teams. Press{' '}
              <kbd className="rounded border border-border bg-surface px-1 font-mono">/</kbd> to focus.
            </div>
          )}
          <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-muted-2">
            <span className="inline-flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <Sliders className="h-3 w-3" /> filter
              </span>
              <span className="inline-flex items-center gap-1">
                <Bookmark className="h-3 w-3" /> save
              </span>
            </span>
            <span>↵ open · ↑↓ navigate · esc close</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
