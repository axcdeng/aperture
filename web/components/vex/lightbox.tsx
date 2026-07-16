'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Maximize,
  X,
} from 'lucide-react';
import type { MediaItem } from '@/lib/types';
import { cn, formatDate, formatRelativeTime } from '@/lib/utils';
import { TeamNumber } from './team-number';
import { SourceBadge } from './source-badge';
import { SeasonBadge } from './season-badge';
import { ContentTypeBadge } from './content-type-badge';

export function Lightbox({
  items,
  activeId,
  onClose,
  onChange,
}: {
  items: MediaItem[];
  activeId: string | null;
  onClose: () => void;
  onChange: (id: string) => void;
}) {
  const idx = activeId ? items.findIndex((m) => m.id === activeId) : -1;
  const item = idx >= 0 ? items[idx] : null;
  const [zoom, setZoom] = useState(false);

  const next = useCallback(() => {
    if (idx < 0) return;
    const n = items[(idx + 1) % items.length];
    if (n) onChange(n.id);
  }, [idx, items, onChange]);

  const prev = useCallback(() => {
    if (idx < 0) return;
    const p = items[(idx - 1 + items.length) % items.length];
    if (p) onChange(p.id);
  }, [idx, items, onChange]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setZoom(false);
  }, [activeId]);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === 'l') next();
      else if (e.key === 'ArrowLeft' || e.key === 'h') prev();
      else if (e.key === 'j') next();
      else if (e.key === 'k') prev();
      else if (e.key === 'f' && item.contentType === 'video') {
        const v = document.getElementById('lightbox-video') as HTMLVideoElement | null;
        v?.requestFullscreen?.();
      }
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [item, next, prev, onClose]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/95 backdrop-blur-sm transition-opacity duration-200 sm:flex-row"
      role="dialog"
      aria-modal="true"
    >
      {/* Close */}
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface/80 text-foreground hover:bg-surface-2"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Prev / Next */}
      <button
        onClick={prev}
        aria-label="Previous"
        className="absolute left-3 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md border border-border bg-surface/80 text-foreground hover:bg-surface-2 sm:inline-flex"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        onClick={next}
        aria-label="Next"
        className="absolute right-16 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md border border-border bg-surface/80 text-foreground hover:bg-surface-2 sm:inline-flex"
      >
        <ChevronRight className="h-5 w-5" />
      </button>

      {/* Media area */}
      <div className="flex flex-1 items-center justify-center overflow-auto p-4 sm:p-10">
        <div
          className={cn(
            'relative flex max-h-[80vh] w-full max-w-[90vw] items-center justify-center transition-transform duration-200',
            zoom ? 'cursor-zoom-out scale-[2]' : 'cursor-zoom-in',
          )}
          onClick={() => item.contentType === 'image' && setZoom((z) => !z)}
        >
          {item.contentType === 'image' ? (
            <div className="relative h-[80vh] w-full">
              <Image
                src={item.fullUrl}
                alt={item.title ?? 'Media'}
                fill
                sizes="80vw"
                className="object-contain"
                priority
              />
            </div>
          ) : item.contentType === 'video' ? (
            <video
              id="lightbox-video"
              src={item.fullUrl}
              controls
              autoPlay
              className="max-h-[80vh] w-full"
              poster={item.thumbnailUrl}
            />
          ) : (
            <div className="aspect-video w-full max-w-5xl">
              <iframe
                src={item.fullUrl}
                title={item.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="h-full w-full rounded-md border border-border"
              />
            </div>
          )}
        </div>
      </div>

      {/* Side panel */}
      <aside className="w-full shrink-0 overflow-y-auto border-t border-border bg-surface px-4 py-4 sm:w-96 sm:border-l sm:border-t-0 sm:px-5 sm:py-6">
        <div className="flex items-center gap-2 mb-3">
          {item.teamNumber ? (
            <TeamNumber number={item.teamNumber} size="lg" />
          ) : (
            <span className="font-mono text-lg text-muted">Untagged</span>
          )}
          <SeasonBadge seasonId={item.seasonId} />
        </div>
        <h2 className="text-sm text-foreground">{item.title}</h2>
        {item.description ? (
          <p className="mt-2 text-xs text-muted">{item.description}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <SourceBadge source={item.source} />
          <ContentTypeBadge type={item.contentType} />
          {item.sourceChannel ? (
            <span className="inline-flex h-6 items-center rounded-md border border-border bg-surface-2 px-2 font-mono text-[10px] text-muted">
              #{item.sourceChannel}
            </span>
          ) : null}
        </div>

        <dl className="mt-5 space-y-2 text-xs">
          <Row label="Posted" value={`${formatDate(item.postedAt)} (${formatRelativeTime(item.postedAt)})`} />
          {item.authorDisplayName ? <Row label="Author" value={item.authorDisplayName} mono /> : null}
          {item.durationSeconds ? <Row label="Length" value={`${item.durationSeconds}s`} mono /> : null}
        </dl>

        <div className="mt-5 flex flex-wrap gap-2">
          {item.originalUrl ? (
            <a
              href={item.originalUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-surface-2 px-3 text-xs hover:border-border-hover"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open original
            </a>
          ) : null}
          {item.contentType === 'video' ? (
            <button
              onClick={() => {
                const v = document.getElementById('lightbox-video') as HTMLVideoElement | null;
                v?.requestFullscreen?.();
              }}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-surface-2 px-3 text-xs hover:border-border-hover"
            >
              <Maximize className="h-3.5 w-3.5" />
              Fullscreen
            </button>
          ) : null}
        </div>

        <div className="mt-6 border-t border-border pt-4 text-[10px] text-muted-2">
          ←/→ navigate · esc close{item.contentType === 'video' ? ' · f fullscreen' : ''}
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-2">{label}</dt>
      <dd className={cn('truncate text-foreground', mono && 'font-mono text-xs')}>{value}</dd>
    </div>
  );
}
