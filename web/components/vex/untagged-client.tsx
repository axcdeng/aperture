'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { Tag, X, Loader2 } from 'lucide-react';
import type { MediaItem } from '@/lib/types';
import { SourceBadge } from './source-badge';
import { ContentTypeBadge } from './content-type-badge';
import { formatRelativeTime } from '@/lib/utils';
import { EmptyState } from './empty-state';
import { Lightbox } from './lightbox';
import { assignMediaAction, dismissMediaAction } from '@/app/untagged/actions';

export function UntaggedClient({ items }: { items: MediaItem[] }) {
  const [openAssign, setOpenAssign] = useState<string | null>(null);
  const [team, setTeam] = useState('');
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  // Ids cleared this session. Once the server revalidates they also drop from
  // `items`; filtering an already-gone id is harmless, so this stays correct.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const visible = items.filter((m) => !removed.has(m.id));

  function clear(id: string) {
    setRemoved((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function runAssign(id: string) {
    const teamNumber = team.trim();
    if (!teamNumber) return;
    setError(null);
    setPendingId(id);
    startTransition(async () => {
      const res = await assignMediaAction(id, teamNumber);
      setPendingId(null);
      if (res.ok) {
        setOpenAssign(null);
        setTeam('');
        clear(id);
      } else {
        setError(res.error);
      }
    });
  }

  function runDismiss(id: string) {
    setError(null);
    setPendingId(id);
    startTransition(async () => {
      const res = await dismissMediaAction(id);
      setPendingId(null);
      if (res.ok) clear(id);
      else setError(res.error);
    });
  }

  if (visible.length === 0) {
    return <EmptyState title="Inbox zero" description="No untagged media right now." />;
  }

  return (
    <>
      {error ? (
        <div className="mb-4 rounded-md border border-[#4c1d1d] bg-[#1f0d0d] px-3 py-2 text-xs text-[#f87171]">
          {error}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((m) => {
          const busy = pendingId === m.id;
          return (
            <div
              key={m.id}
              className="overflow-hidden rounded-lg border border-border bg-surface"
            >
              <button
                onClick={() => setLightboxId(m.id)}
                className="relative block aspect-[4/3] w-full overflow-hidden"
              >
                <Image src={m.thumbnailUrl} alt="" fill sizes="33vw" className="object-cover" />
              </button>
              <div className="space-y-2 p-3">
                <div className="flex items-center gap-1.5">
                  <ContentTypeBadge type={m.contentType} />
                  <SourceBadge source={m.source} size="sm" />
                  <span className="ml-auto text-xs text-muted">{formatRelativeTime(m.postedAt)}</span>
                </div>
                <p className="line-clamp-2 text-xs text-muted">{m.title}</p>
                <div className="flex items-center gap-2 pt-1">
                  {openAssign === m.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        runAssign(m.id);
                      }}
                      className="flex flex-1 items-center gap-1"
                    >
                      <input
                        autoFocus
                        value={team}
                        onChange={(e) => setTeam(e.target.value.toUpperCase())}
                        placeholder="1234A"
                        disabled={busy}
                        className="h-8 flex-1 rounded-md border border-border bg-surface-2 px-2 font-mono text-xs text-foreground placeholder:text-muted-2 outline-none focus:border-border-hover disabled:opacity-50"
                      />
                      <button
                        type="submit"
                        disabled={busy || !team.trim()}
                        className="inline-flex h-8 items-center gap-1 rounded-md bg-foreground px-2.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenAssign(null);
                          setTeam('');
                        }}
                        disabled={busy}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 disabled:opacity-50"
                        aria-label="Cancel"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        onClick={() => setOpenAssign(m.id)}
                        disabled={busy}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 text-xs hover:border-border-hover disabled:opacity-50"
                      >
                        <Tag className="h-3 w-3" />
                        Assign to team…
                      </button>
                      <button
                        onClick={() => runDismiss(m.id)}
                        disabled={busy}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted hover:bg-surface-2 disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        Not a reveal
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <Lightbox
          items={visible}
          activeId={lightboxId}
          onClose={() => setLightboxId(null)}
          onChange={(id) => setLightboxId(id)}
        />
      </div>
    </>
  );
}
