import Link from 'next/link';
import { ArrowRight, Sparkles, Activity, Database } from 'lucide-react';
import { SearchBar } from '@/components/vex/search-bar';
import { MediaCard } from '@/components/vex/media-card';
import { TeamCard } from '@/components/vex/team-card';
import { StatRow } from '@/components/vex/stat-row';
import { getMostActiveTeams, getRecentMedia, getStats } from '@/lib/data';
import { formatRelativeTime } from '@/lib/utils';

export const revalidate = 60;

export default async function HomePage() {
  const [recent, active, stats] = await Promise.all([
    getRecentMedia(6),
    getMostActiveTeams('push-back', 6),
    getStats(),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <section className="flex flex-col items-center gap-6 py-10 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
          <Sparkles className="h-3 w-3" />
          Push Back · 25-26 season
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
          Every reveal. Every team. <br className="hidden sm:block" />
          <span className="text-muted">One scout-ready feed.</span>
        </h1>
        <p className="max-w-xl text-sm text-muted">
          Search any VEX team and see every reveal video, robot photo, and CAD render they&apos;ve
          posted — Discord, YouTube, and beyond.
        </p>
        <div className="w-full max-w-2xl">
          <SearchBar variant="large" />
        </div>
        <div className="flex items-center gap-4 text-xs text-muted">
          <Link href="/browse" className="inline-flex items-center gap-1 hover:text-foreground">
            Browse feed <ArrowRight className="h-3 w-3" />
          </Link>
          <span className="text-muted-2">·</span>
          <Link href="/styleguide" className="hover:text-foreground">
            Styleguide
          </Link>
        </div>
      </section>

      <StatRow
        items={[
          { label: 'Teams', value: stats.totalTeams.toString() },
          { label: 'Reveals', value: stats.totalMedia.toString() },
          { label: 'Last Sync', value: formatRelativeTime(stats.lastSyncAt) },
          { label: 'Confidence', value: '88%' },
        ]}
      />

      <section className="mt-10 space-y-4">
        <div className="flex items-end justify-between">
          <h2 className="text-base font-medium text-foreground inline-flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted" />
            Latest reveals
          </h2>
          <Link href="/browse" className="text-xs text-muted hover:text-foreground">
            View all →
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {recent.map((m) => (
            <MediaCard
              key={m.id}
              item={m}
              href={m.teamNumber ? `/team/${m.teamNumber}/media/${m.id}` : `/untagged`}
            />
          ))}
        </div>
      </section>

      <section className="mt-10 space-y-4">
        <div className="flex items-end justify-between">
          <h2 className="text-base font-medium text-foreground inline-flex items-center gap-2">
            <Database className="h-4 w-4 text-muted" />
            Most active this season
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {active.map(({ team, count }) => (
            <TeamCard key={team.number} team={team} contentCount={count} />
          ))}
        </div>
      </section>

      <footer className="mt-14 border-t border-border pt-6 text-xs text-muted">
        {stats.totalTeams} teams · {stats.totalMedia} reveals · Last sync{' '}
        {formatRelativeTime(stats.lastSyncAt)}
      </footer>
    </div>
  );
}
