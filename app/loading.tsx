import { MediaGridSkeleton } from '@/components/vex/media-grid';

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-6 space-y-2">
        <div className="skeleton h-8 w-40" />
        <div className="skeleton h-3 w-64" />
      </div>
      <MediaGridSkeleton count={6} />
    </div>
  );
}
