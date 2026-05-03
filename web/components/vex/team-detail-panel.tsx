'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  ExternalLink,
  Pencil,
  X,
  Activity,
  Image as ImageIcon,
  CheckCircle2,
  Copy,
} from 'lucide-react';
import type { MediaItem, Team } from '@/lib/types';
import { TeamNumber } from './team-number';
import { SourceBadge } from './source-badge';
import { ContentTypeBadge } from './content-type-badge';
import { formatRelativeTime, cn } from '@/lib/utils';

const STORAGE_KEY = 'vex-scout:team-panel-width';
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 360;

export function TeamDetailPanel({
  team,
  media,
  selectedMedia,
  onClose,
}: {
  team: Team;
  media: MediaItem[];
  selectedMedia: MediaItem | null;
  onClose?: () => void;
}) {
  const m = selectedMedia ?? media[0];
  const asideRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (saved && saved >= MIN_WIDTH && saved <= MAX_WIDTH) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWidth(saved);
    }
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const aside = asideRef.current;
      if (!aside) return;
      const right = aside.getBoundingClientRect().right;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, right - e.clientX));
      setWidth(next);
    };
    const onUp = () => {
      setDragging(false);
      try {
        localStorage.setItem(STORAGE_KEY, String(asideRef.current?.getBoundingClientRect().width ?? DEFAULT_WIDTH));
      } catch {}
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  function onHandleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setWidth((w) => Math.min(MAX_WIDTH, w + 16));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setWidth((w) => Math.max(MIN_WIDTH, w - 16));
    }
  }

  const stats = useMemo(() => {
    const lastSeen = media[0] ? formatRelativeTime(media[0].postedAt) : '—';
    const photos = media.filter((x) => x.contentType === 'image').length;
    const total = media.length;
    return { total, photos, lastSeen };
  }, [media]);

  const history = media.slice(0, 3);

  return (
    <aside
      ref={asideRef}
      className="relative hidden w-full shrink-0 border-l border-border bg-background xl:flex xl:flex-col"
      style={{ width: `${width}px` }}
    >
      <button
        type="button"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onMouseDown={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
        onKeyDown={onHandleKey}
        className={cn(
          'group absolute -left-1 top-0 z-20 hidden h-full w-2 cursor-col-resize xl:block',
          'before:absolute before:left-1/2 before:top-0 before:h-full before:w-px before:-translate-x-1/2 before:bg-transparent',
          dragging
            ? 'before:bg-foreground/40'
            : 'hover:before:bg-border-hover focus-visible:before:bg-foreground/40',
        )}
      >
        <span className="sr-only">Drag to resize panel</span>
      </button>
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <TeamNumber number={team.number} size="xl" />
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
            <span>Team Alias</span>
            <span className="text-muted-2">•</span>
            <span>{team.region.split(',')[0]}</span>
            <span className="text-muted-2">•</span>
            <span>VEX VRC</span>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-px border-b border-border bg-border">
        {[
          { label: 'Scoutings', value: stats.total.toString() },
          { label: 'Last Seen', value: stats.lastSeen },
          { label: 'Media', value: stats.photos.toString() },
          { label: 'Confidence', value: '88%' },
        ].map((s) => (
          <div key={s.label} className="bg-background px-3 py-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-2">{s.label}</div>
            <div className="mt-1 truncate font-mono text-sm text-foreground">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Selected media */}
        <div className="px-5 pb-4 pt-5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-muted-2">Selected media</div>
            {m ? (
              <div className="flex items-center gap-1.5">
                <ContentTypeBadge type={m.contentType} />
                <SourceBadge source={m.source} />
                <span className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-surface px-1.5 text-[10px] text-muted">
                  {formatRelativeTime(m.postedAt)}
                </span>
              </div>
            ) : null}
          </div>
          <div className="relative mt-3 aspect-video overflow-hidden rounded-lg border border-border bg-surface">
            {m ? (
              <Image
                src={m.thumbnailUrl}
                alt={m.title ?? 'Selected media'}
                fill
                sizes="360px"
                className="object-cover"
              />
            ) : null}
            <ImageIcon className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-[#2a2a2a]" />
          </div>
        </div>

        {/* Reveal history */}
        <div className="px-5 py-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-muted-2">
              Reveal History <span className="ml-1 font-mono text-foreground">{stats.total}</span>
            </div>
          </div>
          <ol className="relative space-y-3 border-l border-border pl-4">
            {history.map((h, i) => (
              <li key={h.id} className="relative">
                <span
                  className={cn(
                    'absolute -left-[19px] top-1 h-2.5 w-2.5 rounded-full border-2 border-background',
                    i === 0 ? 'bg-foreground' : 'bg-muted-2',
                  )}
                />
                <div className="rounded-md border border-border bg-surface px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <span>{formatRelativeTime(h.postedAt)}</span>
                      <SourceBadge source={h.source} size="sm" />
                    </div>
                    <RevealStatusPill index={i} />
                  </div>
                  <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-muted">
                    <span>{h.seasonId === 'high-stakes' ? '24-25' : '25-26'}</span>
                    <span className="text-muted-2">•</span>
                    <span className="truncate text-foreground">{h.title}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted">
                    <p className="line-clamp-1">{h.description}</p>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <button className="mt-3 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground">
            View all history →
          </button>
        </div>

        {/* Source links */}
        <div className="grid grid-cols-2 gap-4 border-t border-border px-5 py-4">
          <div>
            <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-2">
              Source Links <span className="ml-1 font-mono text-foreground">{Math.min(media.length, 4)}</span>
            </div>
            <ul className="space-y-1.5">
              {media.slice(0, 4).map((s) => (
                <li key={s.id}>
                  <a
                    href={s.originalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground hover:border-border-hover"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <SourceBadge source={s.source} iconOnly size="sm" />
                      <span className="truncate font-mono text-[11px] text-muted">
                        #{s.sourceChannel ?? '—'}
                      </span>
                    </span>
                    <ExternalLink className="h-3 w-3 text-muted-2" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-muted-2">
                Scout Notes <span className="ml-1 font-mono text-foreground">3</span>
              </div>
              <button className="text-muted-2 hover:text-foreground" aria-label="Edit notes">
                <Pencil className="h-3 w-3" />
              </button>
            </div>
            <div className="rounded-md border border-border bg-surface px-2.5 py-2 text-[11px] text-muted">
              <p>Intake mounted higher this year.</p>
              <p>4-bar lift. New claw geometry.</p>
              <p>Likely running 2x Kraken.</p>
              <p>Driver skill: <span className="text-foreground">High</span>.</p>
            </div>
          </div>
        </div>

        {/* Attachments */}
        <div className="border-t border-border px-5 py-4">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-2">
            Attachments <span className="ml-1 font-mono text-foreground">{Math.min(media.length, 17)}</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {media.slice(0, 3).map((a) => (
              <div
                key={a.id}
                className="relative aspect-square overflow-hidden rounded border border-border bg-surface"
              >
                <Image
                  src={a.thumbnailUrl}
                  alt={a.title ?? ''}
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              </div>
            ))}
            {media.length > 3 ? (
              <div className="flex aspect-square items-center justify-center rounded border border-border bg-surface text-xs text-muted">
                +{Math.max(0, media.length - 3)}
                <br />
                more
              </div>
            ) : null}
          </div>
        </div>

        <div className="px-5 pb-6 pt-2 text-[10px] text-muted-2">
          <button className="inline-flex items-center gap-1 hover:text-foreground">
            <Copy className="h-3 w-3" /> Copy team URL
          </button>
        </div>
      </div>
    </aside>
  );
}

function RevealStatusPill({ index }: { index: number }) {
  const map = [
    { label: 'primary', color: '#7dd3fc', bg: 'rgba(125,211,252,0.12)' },
    { label: 'confirmed', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
    { label: 'duplicate', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  ];
  const meta = map[index] ?? map[0];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px]"
      style={{ color: meta.color, backgroundColor: meta.bg }}
    >
      {index === 1 ? <CheckCircle2 className="h-3 w-3" /> : <Activity className="h-3 w-3" />}
      {meta.label}
    </span>
  );
}
