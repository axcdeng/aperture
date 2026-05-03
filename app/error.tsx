'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="font-mono text-xs text-[#f87171]">runtime error</div>
      <h1 className="text-xl font-semibold">Something broke</h1>
      <p className="text-sm text-muted">{error.message}</p>
      <button
        onClick={reset}
        className="mt-2 inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 text-sm hover:border-border-hover"
      >
        Try again
      </button>
    </div>
  );
}
