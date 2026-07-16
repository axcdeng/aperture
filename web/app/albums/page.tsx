import Link from 'next/link';
import Image from 'next/image';
import { Images } from 'lucide-react';
import { listAlbums } from '@/lib/data';
import { EmptyState } from '@/components/vex/empty-state';
import { formatDate } from '@/lib/utils';

export const metadata = { title: 'Albums — Aperture' };
export const revalidate = 60;

export default async function AlbumsPage() {
  const albums = await listAlbums();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-xl font-semibold tracking-tight">Albums</h1>
      <p className="mb-6 mt-1 text-xs text-muted">
        Competition photo albums, tagged by team license plate.
      </p>

      {albums.length === 0 ? (
        <EmptyState
          icon={Images}
          title="No albums yet"
          description="Import a competition album locally with `npm run import-album`."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {albums.map((a) => (
            <Link
              key={a.id}
              href={`/albums/${a.slug}`}
              className="group flex flex-col overflow-hidden rounded-lg border border-border bg-surface transition-colors hover:border-border-hover"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-[#0d0d0d]">
                {a.coverUrl ? (
                  <Image
                    src={a.coverUrl}
                    alt={a.name}
                    fill
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-2">
                    <Images className="h-8 w-8" />
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1 p-3">
                <div className="truncate text-sm font-medium text-foreground">{a.name}</div>
                <div className="truncate text-xs text-muted">
                  {[a.date ? formatDate(a.date) : null, a.location].filter(Boolean).join(' · ') ||
                    '—'}
                </div>
                <div className="mt-1 font-mono text-[11px] text-muted-2">
                  {a.photoCount} {a.photoCount === 1 ? 'photo' : 'photos'} · {a.teamCount}{' '}
                  {a.teamCount === 1 ? 'team' : 'teams'}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
