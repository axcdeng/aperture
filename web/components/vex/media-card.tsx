'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Image as ImageIcon, MessageSquare, Paperclip, Play } from 'lucide-react';
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
}: {
  item: MediaItem;
  variant?: 'grid' | 'feed';
  selected?: boolean;
  href?: string;
  onSelect?: (item: MediaItem) => void;
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
        <Image
          src={item.thumbnailUrl}
          alt={item.title ?? 'Media thumbnail'}
          fill
          sizes="(max-width: 768px) 100vw, 33vw"
          className="object-cover"
        />
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
        {item.contentType === 'image' ? (
          <ImageIcon className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-[#2a2a2a]" />
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
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {(item.id.charCodeAt(item.id.length - 1) % 5) + 1}
          </span>
          <span className="inline-flex items-center gap-1">
            <Paperclip className="h-3 w-3" />
            {(item.id.charCodeAt(item.id.length - 1) % 3) + 1}
          </span>
        </div>
      </div>
    </div>
  );

  if (onSelect) {
    return (
      <button
        onClick={() => onSelect(item)}
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
