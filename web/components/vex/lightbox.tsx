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

// Ask the Alltuu Downloader extension for a photo's full-size original URL.
// Resolves null if the extension isn't installed or the photo isn't in the
// linked alltuu album. The extension may need to harvest the album first
// (~40s the first time), hence the long timeout.
function resolveHqUrl(filename: string, timeoutMs = 140000): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' ||
        document.documentElement.getAttribute('data-aperture-ext') !== '1') {
      resolve(null);
      return;
    }
    const reqId = 'hq' + Date.now() + Math.random().toString(36).slice(2);
    let done = false;
    const finish = (url: string | null) => {
      if (done) return;
      done = true;
      window.removeEventListener('aperture:hq-url', onReply as EventListener);
      resolve(url);
    };
    const onReply = (e: Event) => {
      let d: { reqId?: string; url?: string | null };
      try { d = JSON.parse((e as CustomEvent).detail); } catch { return; }
      if (d.reqId !== reqId) return;
      finish(d.url ?? null);
    };
    window.addEventListener('aperture:hq-url', onReply as EventListener);
    window.dispatchEvent(new CustomEvent('aperture:resolve-hq', { detail: JSON.stringify({ filename, reqId }) }));
    setTimeout(() => finish(null), timeoutMs);
  });
}

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
  const [hq, setHq] = useState(false);
  const [hqUrl, setHqUrl] = useState<string | null>(null);
  const [hqStatus, setHqStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'noext'>('idle');

  // Restore the sticky High-quality preference.
  useEffect(() => {
    setHq(localStorage.getItem('aperture:hq') === '1');
  }, []);
  const toggleHq = (on: boolean) => {
    setHq(on);
    try { localStorage.setItem('aperture:hq', on ? '1' : '0'); } catch {}
  };

  // Resolve the full-size URL when High quality is on for an image. Re-runs per
  // photo; cleared on change so we never show the previous photo's original.
  const activeFilename = item?.originalFilename;
  const isImage = item?.contentType === 'image';
  useEffect(() => {
    setHqUrl(null);
    if (!hq || !isImage || !activeFilename) { setHqStatus('idle'); return; }
    if (document.documentElement.getAttribute('data-aperture-ext') !== '1') { setHqStatus('noext'); return; }
    let cancelled = false;
    setHqStatus('loading');
    resolveHqUrl(activeFilename).then((url) => {
      if (cancelled) return;
      if (url) { setHqUrl(url); setHqStatus('ready'); } else setHqStatus('error');
    });
    return () => { cancelled = true; };
  }, [hq, isImage, activeFilename]);

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
              {hq && hqUrl ? (
                // Full-size original from the linked alltuu album (external host,
                // full resolution) — a plain img, not next/image's optimizer.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={hqUrl}
                  alt={item.title ?? 'Media'}
                  className="absolute inset-0 h-full w-full object-contain"
                />
              ) : (
                <Image
                  src={item.fullUrl}
                  alt={item.title ?? 'Media'}
                  fill
                  sizes="80vw"
                  className="object-contain"
                  priority
                />
              )}
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
        {item.contentType === 'image' ? (
          <div className="mb-3">
            <div className="flex items-center gap-1 rounded-md border border-border p-0.5 text-xs">
              <button
                onClick={() => toggleHq(false)}
                className={cn('flex-1 rounded px-2 py-1 transition-colors', !hq ? 'bg-surface-2 font-medium text-foreground' : 'text-muted-2 hover:text-foreground')}
              >
                Default view
              </button>
              <button
                onClick={() => toggleHq(true)}
                className={cn('flex-1 rounded px-2 py-1 transition-colors', hq ? 'bg-surface-2 font-medium text-foreground' : 'text-muted-2 hover:text-foreground')}
              >
                High quality
              </button>
            </div>
            {hq ? (
              <p className="mt-1.5 text-[11px] text-muted-2">
                {hqStatus === 'loading' ? 'Loading full-size… (first time per album can take ~40s)'
                  : hqStatus === 'ready' ? 'Showing full-size original.'
                  : hqStatus === 'noext' ? 'Install the Alltuu Downloader extension to use this.'
                  : hqStatus === 'error' ? 'No full-size original for this photo.'
                  : ''}
              </p>
            ) : null}
          </div>
        ) : null}
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
