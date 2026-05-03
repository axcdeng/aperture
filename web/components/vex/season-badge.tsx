import { cn } from '@/lib/utils';
import type { SeasonId } from '@/lib/types';
import { SEASONS } from '@/lib/seasons';

export function SeasonBadge({
  seasonId,
  size = 'md',
  className,
}: {
  seasonId: SeasonId;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const s = SEASONS[seasonId];
  const compact = seasonId === 'high-stakes' ? '24-25' : seasonId === 'push-back' ? '25-26' : '?';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-border bg-surface font-mono',
        size === 'sm' ? 'h-5 px-1.5 text-[10px]' : 'h-6 px-2 text-xs',
        'text-muted',
        className,
      )}
      title={s.name}
    >
      <span className="dot" style={{ backgroundColor: s.color }} />
      {compact}
    </span>
  );
}
