import { TeamNumber } from '@/components/vex/team-number';
import { SourceBadge } from '@/components/vex/source-badge';
import { SeasonBadge } from '@/components/vex/season-badge';
import { ContentTypeBadge } from '@/components/vex/content-type-badge';
import { TeamCard } from '@/components/vex/team-card';
import { MediaCard } from '@/components/vex/media-card';
import { EmptyState } from '@/components/vex/empty-state';
import { StatRow } from '@/components/vex/stat-row';
import { SearchBar } from '@/components/vex/search-bar';
import { SEED_MEDIA, SEED_TEAMS } from '@/lib/seed';
import { Inbox, Wifi } from 'lucide-react';

export const metadata = { title: 'Styleguide — VEX Scout' };

export default function StyleguidePage() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-12 px-4 py-10 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">VEX Scout · Styleguide</h1>
        <p className="mt-1 text-sm text-muted">Living visual reference for every component.</p>
      </header>

      <Section title="Color tokens">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['background', '#000'],
            ['surface', '#0a0a0a'],
            ['surface-2', '#111'],
            ['border', '#1f1f1f'],
            ['border-hover', '#2e2e2e'],
            ['foreground', '#ededed'],
            ['muted', '#8f8f8f'],
            ['muted-2', '#5f5f5f'],
          ].map(([name, hex]) => (
            <div key={name} className="rounded-md border border-border bg-surface p-2 text-xs">
              <div
                className="mb-2 h-12 rounded border border-border"
                style={{ backgroundColor: `var(--${name})` }}
              />
              <div className="font-mono text-foreground">{name}</div>
              <div className="font-mono text-muted-2">{hex}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <div className="space-y-2">
          <div className="text-3xl font-semibold tracking-tight">Geist Sans · 30px</div>
          <div className="text-base">Body text · Geist Sans · 16px</div>
          <div className="font-mono text-base">1234A · Geist Mono · 16px</div>
          <div className="text-xs text-muted">Muted xs · 12px</div>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <button className="inline-flex h-9 items-center rounded-md bg-foreground px-3 text-sm font-medium text-accent-fg hover:opacity-90">
            Primary
          </button>
          <button className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 text-sm hover:border-border-hover">
            Secondary
          </button>
          <button className="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted hover:bg-surface hover:text-foreground">
            Ghost
          </button>
          <button className="inline-flex h-9 items-center rounded-md border border-[#3a1a1a] bg-[#1a0a0a] px-3 text-sm text-[#f87171] hover:border-[#5a2a2a]">
            Destructive
          </button>
        </div>
      </Section>

      <Section title="Inputs / Search">
        <SearchBar />
      </Section>

      <Section title="TeamNumber">
        <div className="flex flex-wrap items-baseline gap-4">
          <TeamNumber number="1234A" size="sm" />
          <TeamNumber number="1234A" size="md" />
          <TeamNumber number="1234A" size="lg" />
          <TeamNumber number="1234A" size="xl" />
          <TeamNumber number="99X" size="lg" variant="default" />
          <TeamNumber number="BCUZ" size="lg" variant="muted" />
        </div>
      </Section>

      <Section title="Source / Season / ContentType badges">
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge source="discord" />
          <SourceBadge source="youtube" />
          <SourceBadge source="vex-cad" />
          <SourceBadge source="robolytics" />
          <SourceBadge source="discord" iconOnly />
          <SourceBadge source="youtube" iconOnly />
          <SeasonBadge seasonId="push-back" />
          <SeasonBadge seasonId="high-stakes" />
          <SeasonBadge seasonId="unknown" />
          <ContentTypeBadge type="image" />
          <ContentTypeBadge type="video" />
          <ContentTypeBadge type="youtube" />
        </div>
      </Section>

      <Section title="StatRow">
        <StatRow
          items={[
            { label: 'Teams', value: '5,248' },
            { label: 'Reveals', value: '142' },
            { label: 'Last sync', value: '4m ago' },
            { label: 'Confidence', value: '88%' },
          ]}
        />
      </Section>

      <Section title="TeamCard">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SEED_TEAMS.slice(0, 4).map((t, i) => (
            <TeamCard key={t.number} team={t} contentCount={(i + 1) * 3} />
          ))}
        </div>
      </Section>

      <Section title="MediaCard">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SEED_MEDIA.slice(0, 3).map((m) => (
            <MediaCard
              key={m.id}
              item={m}
              href={m.teamNumber ? `/team/${m.teamNumber}` : `/untagged`}
            />
          ))}
        </div>
      </Section>

      <Section title="EmptyState">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EmptyState title="No reveals yet" description="Nothing for this team in this season." />
          <EmptyState
            icon={Wifi}
            title="Couldn't reach the API"
            description="Falling back to cached data."
          />
        </div>
      </Section>

      <Section title="Skeleton">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface">
              <div className="aspect-[4/3] skeleton rounded-t-lg" />
              <div className="space-y-2 p-3">
                <div className="skeleton h-4 w-1/3" />
                <div className="skeleton h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between border-b border-border pb-1">
        <h2 className="text-xs uppercase tracking-wider text-muted-2">{title}</h2>
        <Inbox className="h-3 w-3 text-muted-2" />
      </div>
      <div>{children}</div>
    </section>
  );
}
