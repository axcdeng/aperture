import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="font-mono text-5xl tracking-tight text-muted-2">404</div>
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-sm text-muted">
        We couldn&apos;t find that team or page. Try searching for a team number.
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex h-9 items-center rounded-md bg-foreground px-3 text-sm font-medium text-accent-fg hover:opacity-90"
      >
        Back to search
      </Link>
    </div>
  );
}
