'use client';

import { Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

// A small "Download ▾" control for a group of photos (a team, tag, folder, or
// the current selection). It doesn't download directly — it hands the photo
// list to the Alltuu Downloader browser extension, which resolves the URLs and
// saves each group into its own ~/Downloads/<album>_<label>/ folder:
//   - Full-size originals: 4000px from the linked alltuu album (via the
//     extension's harvested index)
//   - Display (1080px): the R2 images this site already serves
// Without the extension there's nothing to receive the request, so we show a
// hint instead.

type Item = { originalFilename?: string; fullUrl?: string };

function dispatch(tier: 'full' | 'site', label: string, items: Item[]) {
  const payload = {
    tier,
    label,
    items: items
      .filter((i) => i.originalFilename)
      .map((i) => ({ filename: i.originalFilename, imgUrl: i.fullUrl })),
  };
  window.dispatchEvent(
    new CustomEvent('aperture:bulk-download', { detail: JSON.stringify(payload) }),
  );
}

export function BulkDownload({ items, label }: { items: Item[]; label: string }) {
  const [open, setOpen] = useState(false);
  const [hasExt, setHasExt] = useState(true);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    setHasExt(document.documentElement.getAttribute('data-aperture-ext') === '1');
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const n = items.filter((i) => i.originalFilename).length;
  if (!n) return null;

  const pick = (tier: 'full' | 'site') => (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    dispatch(tier, label, items);
  };

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title={`Download these ${n} photos`}
        className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-foreground hover:bg-surface"
      >
        <Download className="h-3.5 w-3.5" />
        {n}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-40 mt-1 w-48 overflow-hidden rounded-md border border-border bg-surface-2 py-1 text-xs shadow-lg">
          {hasExt ? (
            <>
              <button type="button" onClick={pick('full')} className="block w-full px-3 py-1.5 text-left hover:bg-surface">
                Full-size originals
              </button>
              <button type="button" onClick={pick('site')} className="block w-full px-3 py-1.5 text-left hover:bg-surface">
                Display (1080px)
              </button>
            </>
          ) : (
            <div className="px-3 py-1.5 text-muted-2">
              Install the Alltuu Downloader extension to bulk-download.
            </div>
          )}
        </div>
      ) : null}
    </span>
  );
}
