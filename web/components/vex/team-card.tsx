import Link from 'next/link';
import type { Team } from '@/lib/types';
import { TeamNumber } from './team-number';
import { Layers } from 'lucide-react';

export function TeamCard({ team, contentCount }: { team: Team; contentCount: number }) {
  return (
    <Link
      href={`/team/${team.number}`}
      className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-border-hover hover:bg-surface-2"
    >
      <div className="flex items-center gap-4 min-w-0">
        <TeamNumber number={team.number} size="lg" />
        <div className="min-w-0">
          <div className="truncate text-sm text-foreground">{team.organization}</div>
          <div className="truncate text-xs text-muted">{team.region}</div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted shrink-0 ml-3">
        <Layers className="h-3.5 w-3.5" />
        <span className="font-mono">{contentCount}</span>
      </div>
    </Link>
  );
}
