import { searchTeams } from '@/lib/data';
import { TeamCard } from '@/components/vex/team-card';
import { SearchBar } from '@/components/vex/search-bar';
import { EmptyState } from '@/components/vex/empty-state';
import { Search as SearchIcon } from 'lucide-react';

export const metadata = { title: 'Search — VEX Scout' };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;
  const results = q ? await searchTeams(q, 50) : [];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="mb-6 text-xl font-semibold tracking-tight">Search teams</h1>
      <SearchBar />

      {q ? (
        <div className="mt-6">
          <div className="mb-3 text-xs text-muted">
            <span className="font-mono text-foreground">{results.length}</span> result
            {results.length === 1 ? '' : 's'} for{' '}
            <span className="font-mono text-foreground">{q}</span>
          </div>
          {results.length === 0 ? (
            <EmptyState
              icon={SearchIcon}
              title="No teams matched."
              description={`Nothing for "${q}". Try a different team number or organization.`}
            />
          ) : (
            <div className="space-y-2">
              {results.map((r) => (
                <TeamCard key={r.team.number} team={r.team} contentCount={r.contentCount} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6 text-xs text-muted">Type a team number, org, or region to search.</div>
      )}
    </div>
  );
}
