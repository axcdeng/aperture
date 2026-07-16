import { cn } from '@/lib/utils';
import type { Source } from '@/lib/types';
import { MessageCircle, Youtube, Box, Activity, Images } from 'lucide-react';

const META: Record<
  Source,
  { label: string; color: string; bg: string; Icon: typeof MessageCircle }
> = {
  discord: { label: 'Discord', color: '#5865F2', bg: 'rgba(88,101,242,0.12)', Icon: MessageCircle },
  youtube: { label: 'YouTube', color: '#FF0000', bg: 'rgba(255,0,0,0.10)', Icon: Youtube },
  'vex-cad': { label: 'VEX CAD', color: '#00B14F', bg: 'rgba(0,177,79,0.12)', Icon: Box },
  robolytics: { label: 'Robolytics', color: '#A855F7', bg: 'rgba(168,85,247,0.12)', Icon: Activity },
  album: { label: 'Album', color: '#14B8A6', bg: 'rgba(20,184,166,0.12)', Icon: Images },
};

export function SourceBadge({
  source,
  size = 'md',
  className,
  iconOnly = false,
}: {
  source: Source;
  size?: 'sm' | 'md';
  className?: string;
  iconOnly?: boolean;
}) {
  const m = META[source];
  const Icon = m.Icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border font-medium',
        size === 'sm' ? 'h-5 px-1.5 text-[10px]' : 'h-6 px-2 text-xs',
        iconOnly && (size === 'sm' ? 'w-5 px-0 justify-center' : 'w-6 px-0 justify-center'),
        className,
      )}
      style={{
        color: m.color,
        backgroundColor: m.bg,
        borderColor: 'transparent',
      }}
    >
      <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      {!iconOnly && m.label}
    </span>
  );
}
