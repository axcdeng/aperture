import { cn } from '@/lib/utils';

interface Props {
  number: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'default' | 'accent' | 'muted';
  className?: string;
}

const SIZES: Record<NonNullable<Props['size']>, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-lg',
  xl: 'text-2xl',
};

const VARIANTS: Record<NonNullable<Props['variant']>, string> = {
  default: 'text-foreground',
  accent: 'text-[#7dd3fc]',
  muted: 'text-muted',
};

export function TeamNumber({ number, size = 'md', variant = 'accent', className }: Props) {
  return (
    <span
      className={cn(
        'font-mono font-semibold tracking-tight',
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
    >
      {number}
    </span>
  );
}
