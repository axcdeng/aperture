'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Create an empty album (name + optional date + note), then jump to it so the
// operator can open Import. The album is just an `events` row until photos are
// uploaded.
export function NewAlbumButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/albums/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), date: date || undefined, note: note.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Failed to create album');
      router.push(`/albums/${json.slug}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create album');
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs text-foreground transition-colors hover:border-border-hover"
      >
        <Plus className="h-3.5 w-3.5" /> New album
      </button>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-3 sm:w-80">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">New album</span>
        <button onClick={() => setOpen(false)} className="text-muted-2 hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Album name"
        className="mb-2 h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-border-hover"
      />
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="mb-2 h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-border-hover"
      />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        rows={2}
        className="mb-2 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-border-hover"
      />
      {error ? <div className="mb-2 text-[11px] text-[#ef4444]">{error}</div> : null}
      <button
        onClick={submit}
        disabled={!name.trim() || busy}
        className={cn(
          'inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-foreground text-xs font-medium text-accent-fg transition-opacity hover:opacity-90',
          (!name.trim() || busy) && 'opacity-40',
        )}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        Create album
      </button>
    </div>
  );
}
