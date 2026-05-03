import { Image as ImageIcon, Play, Link as LinkIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ContentType } from '@/lib/types';

export function ContentTypeBadge({
  type,
  className,
}: {
  type: ContentType;
  className?: string;
}) {
  const isImage = type === 'image';
  const isVideo = type === 'video';
  const Icon = isImage ? ImageIcon : isVideo ? Play : LinkIcon;
  const label = isImage ? 'photo' : isVideo ? 'video' : 'yt link';
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[11px] text-muted font-medium',
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
