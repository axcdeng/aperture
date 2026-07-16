'use client';

import Link from 'next/link';
import Image from 'next/image';
import { MessageSquare, Paperclip, Play } from 'lucide-react';
import type { MediaItem } from '@/lib/types';
import { cn, formatDuration, formatRelativeTime } from '@/lib/utils';
import { TeamNumber } from './team-number';
import { SourceBadge } from './source-badge';
import { ContentTypeBadge } from './content-type-badge';

export function MediaCard({
  item,
  selected = false,
  href,
  onSelect,
  onOpen,
}: {
  item: MediaItem;
  variant?: 'grid' | 'feed';
  selected?: boolean;
  href?: string;
  onSelect?: (item: MediaItem) => void;
  onOpen?: (item: MediaItem) => void;
}) {
  const card = (
    <div
      className={cn(
        'group flex flex-col rounded-lg border bg-surface transition-colors duration-150',
        selected
          ? 'border-foreground/40 ring-1 ring-foreground/20'
          : 'border-border hover:border-border-hover',
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-t-lg bg-[#0d0d0d]">
        {item.contentType === 'video' ? (
          <video
            src={`${item.fullUrl}#t=0.1`}
            preload="metadata"
            muted
            playsInline
            className="h-full w-full object-cover"
          />
        ) : (
          <Image
            src={item.thumbnailUrl}
            alt={item.teamNumber ? `Team ${item.teamNumber} ${item.contentType}` : 'Untagged media'}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover"
          />
        )}
        {/* Top-left: content type */}
        <div className="absolute left-2 top-2">
          <ContentTypeBadge type={item.contentType} />
        </div>
        {/* Top-right: source icon */}
        <div className="absolute right-2 top-2">
          <SourceBadge source={item.source} iconOnly size="md" />
        </div>
        {/* Bottom-right: duration if video */}
        {item.contentType !== 'image' && item.durationSeconds ? (
          <div className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
            {formatDuration(item.durationSeconds)}
          </div>
        ) : null}
        {item.contentType !== 'image' ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm transition group-hover:bg-black/60">
              <Play className="h-5 w-5 fill-foreground text-foreground" />
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-baseline gap-2">
          {item.teamNumber ? (
            <TeamNumber number={item.teamNumber} size="md" />
          ) : (
            <span className="font-mono text-sm text-muted">Untagged</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          {item.seasonId !== 'unknown' ? (
            <span className="font-mono">{item.seasonId === 'high-stakes' ? '24-25' : '25-26'}</span>
          ) : (
            <span className="font-mono">--</span>
          )}
          <span className="text-muted-2">•</span>
          <span>{formatRelativeTime(item.postedAt)}</span>
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted">
          {item.sourceChannel ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MessageSquare className="h-3 w-3 shrink-0" />
              <span className="truncate">#{item.sourceChannel}</span>
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <Paperclip className="h-3 w-3" />
            {item.attachmentCount ?? 1}
          </span>
        </div>
      </div>
    </div>
  );

  if (onSelect) {
    return (
      <button
        onClick={() => onSelect(item)}
        onDoubleClick={() => onOpen?.(item)}
        className="text-left focus:outline-none"
        aria-label={item.title ?? 'Open media'}
      >
        {card}
      </button>
    );
  }
  if (href) {
    return (
      <Link href={href} className="focus:outline-none" aria-label={item.title ?? 'Open media'}>
        {card}
      </Link>
    );
  }
  return card;
}
