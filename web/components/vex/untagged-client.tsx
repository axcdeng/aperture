'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Tag, X } from 'lucide-react';
import type { MediaItem } from '@/lib/types';
import { SourceBadge } from './source-badge';
import { ContentTypeBadge } from './content-type-badge';
import { formatRelativeTime } from '@/lib/utils';
import { EmptyState } from './empty-state';
import { Lightbox } from './lightbox';

export function UntaggedClient({ items }: { items: MediaItem[] }) {
  const [openAssign, setOpenAssign] = useState<string | null>(null);
  const [team, setTeam] = useState('');
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  if (items.length === 0) {
    return <EmptyState title="Inbox zero" description="No untagged media right now." />;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((m) => (
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
                    console.log('TODO: assign', m.id, team);
                    setOpenAssign(null);
                    setTeam('');
                  }}
                  className="flex flex-1 items-center gap-1"
                >
                  <input
                    autoFocus
                    value={team}
                    onChange={(e) => setTeam(e.target.value.toUpperCase())}
                    placeholder="1234A"
                    className="h-8 flex-1 rounded-md border border-border bg-surface-2 px-2 font-mono text-xs text-foreground placeholder:text-muted-2 outline-none focus:border-border-hover"
                  />
                  <button
                    type="submit"
                    className="inline-flex h-8 items-center rounded-md bg-foreground px-2.5 text-xs font-medium text-accent-fg hover:opacity-90"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenAssign(null)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-2"
                    aria-label="Cancel"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </form>
              ) : (
                <>
                  <button
                    onClick={() => setOpenAssign(m.id)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 text-xs hover:border-border-hover"
                  >
                    <Tag className="h-3 w-3" />
                    Assign to team…
                  </button>
                  <button
                    onClick={() => console.log('TODO: dismiss', m.id)}
                    className="inline-flex h-8 items-center rounded-md px-2.5 text-xs text-muted hover:bg-surface-2"
                  >
                    Not a reveal
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ))}

      <Lightbox
        items={items}
        activeId={lightboxId}
        onClose={() => setLightboxId(null)}
        onChange={(id) => setLightboxId(id)}
      />
    </div>
  );
}
