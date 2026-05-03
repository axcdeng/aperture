import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface/50 px-6 py-16 text-center',
        className,
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface">
        <Icon className="h-4 w-4 text-muted" />
      </div>
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {description ? <div className="text-xs text-muted">{description}</div> : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
