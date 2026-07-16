'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ImageUp, FileJson, Loader2, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { encodeImage, isSupportedImage } from '@/lib/image-encode';

// Upload a batch this many photos at a time. Each ~1080px WebP is ~150KB, so a
// batch of 8 stays well under the serverless request-body ceiling.
const BATCH_SIZE = 8;

interface TagsManifest {
  event?: string;
  photos: Record<string, string[]>;
}

type Phase = 'idle' | 'working' | 'done' | 'error';

interface RunStats {
  inserted: number;
  resurrected: number;
  updated: number;
  softDeleted: number;
  skipped: number;
}
const ZERO: RunStats = { inserted: 0, resurrected: 0, updated: 0, softDeleted: 0, skipped: 0 };

export function AlbumImportClient({ slug, name }: { slug: string; name: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [manifest, setManifest] = useState<TagsManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' });
  const [result, setResult] = useState<{ stats: RunStats; errors: string[] } | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const photoInput = useRef<HTMLInputElement>(null);
  const tagsInput = useRef<HTMLInputElement>(null);
  const [dragPhotos, setDragPhotos] = useState(false);
  const [dragTags, setDragTags] = useState(false);

  const busy = phase === 'working';

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const arr = Array.from(incoming).filter(isSupportedImage);
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name));
      const merged = [...prev];
      for (const f of arr) if (!seen.has(f.name)) merged.push(f);
      return merged;
    });
  }, []);

  const loadManifest = useCallback(async (file: File) => {
    setManifestError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const photos = (parsed as { photos?: unknown })?.photos;
      if (!photos || typeof photos !== 'object' || Array.isArray(photos)) {
        throw new Error('Expected a { "photos": { "IMG_1.jpg": ["1234A"] } } shape.');
      }
      setManifest(parsed as TagsManifest);
    } catch (e) {
      setManifest(null);
      setManifestError(e instanceof Error ? e.message : 'Could not read tags.json');
    }
  }, []);

  const manifestStats = useMemo(() => {
    if (!manifest) return null;
    const keys = Object.keys(manifest.photos);
    const tagged = keys.filter((k) => (manifest.photos[k] ?? []).length > 0).length;
    return { entries: keys.length, tagged };
  }, [manifest]);

  // Case-insensitive filename → teams lookup for tagging on upload.
  const teamsFor = useCallback(
    (filename: string): string[] => {
      if (!manifest) return [];
      const direct = manifest.photos[filename];
      if (direct) return direct;
      const lower = filename.toLowerCase();
      for (const [k, v] of Object.entries(manifest.photos)) if (k.toLowerCase() === lower) return v;
      return [];
    },
    [manifest],
  );

  async function run() {
    if (busy) return;
    setPhase('working');
    setFatal(null);
    setResult(null);
    const agg: RunStats = { ...ZERO };
    const errors: string[] = [];

    try {
      // ---- Phase 1: encode + upload photos in batches --------------------
      if (files.length > 0) {
        setProgress({ done: 0, total: files.length, label: 'Encoding & uploading photos' });
        for (let start = 0; start < files.length; start += BATCH_SIZE) {
          const batch = files.slice(start, start + BATCH_SIZE);
          const fd = new FormData();
          const meta: { filename: string; width: number; height: number; teams: string[] }[] = [];
          for (const file of batch) {
            try {
              const enc = await encodeImage(file);
              fd.append('full', enc.full, `${file.name}.full.webp`);
              fd.append('thumb', enc.thumb, `${file.name}.thumb.webp`);
              meta.push({ filename: file.name, width: enc.width, height: enc.height, teams: teamsFor(file.name) });
            } catch (e) {
              errors.push(`${file.name}: encode failed (${e instanceof Error ? e.message : 'error'})`);
            }
          }
          if (meta.length > 0) {
            fd.append('meta', JSON.stringify(meta));
            const res = await fetch(`/api/albums/${slug}/photos`, { method: 'POST', body: fd });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
              errors.push(`Upload batch failed: ${json.error ?? res.statusText}`);
            } else {
              mergeStats(agg, json.stats);
              for (const e of json.errors ?? []) errors.push(`${e.filename}: ${e.error}`);
            }
          }
          setProgress({ done: Math.min(start + batch.length, files.length), total: files.length, label: 'Encoding & uploading photos' });
        }
      }

      // ---- Phase 2: apply the full tags manifest -------------------------
      // Covers photos uploaded here AND any already in the album from an
      // earlier/other upload. Idempotent, so double-tagging is harmless.
      if (manifest && Object.keys(manifest.photos).length > 0) {
        setProgress((p) => ({ ...p, label: 'Applying tags' }));
        const res = await fetch(`/api/albums/${slug}/tags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photos: manifest.photos }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) errors.push(`Tagging failed: ${json.error ?? res.statusText}`);
        else mergeStats(agg, json.stats);
      }

      setResult({ stats: agg, errors });
      setPhase('done');
    } catch (e) {
      setFatal(e instanceof Error ? e.message : 'Import failed');
      setPhase('error');
    }
  }

  const canRun = !busy && (files.length > 0 || (manifest && Object.keys(manifest.photos).length > 0));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href={`/albums/${slug}`}
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> {name}
      </Link>

      <h1 className="text-xl font-semibold tracking-tight">Import photos &amp; tags</h1>
      <p className="mb-6 mt-1 text-xs text-muted">
        Photos are resized to WebP in your browser before upload — the original 4K files never leave
        your device. Tagging works independently: you can upload photos now and tags later, or a
        tags.json that references photos someone else already uploaded.
      </p>

      {/* Dropzone: photos */}
      <Dropzone
        active={dragPhotos}
        onDrag={setDragPhotos}
        onDrop={(dt) => addFiles(dt.files)}
        onClick={() => photoInput.current?.click()}
        disabled={busy}
        icon={<ImageUp className="h-6 w-6" />}
        title="Upload every picture here — do not separate by folder. Drop all here."
        subtitle="Click to choose, or drop 300+ JPG/PNG photos at once."
        badge={files.length > 0 ? `${files.length} photo${files.length === 1 ? '' : 's'} ready` : null}
      />
      <input
        ref={photoInput}
        type="file"
        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
        multiple
        hidden
        onChange={(e) => e.target.files && addFiles(e.target.files)}
      />
      {files.length > 0 && !busy ? (
        <div className="mb-4 mt-1 flex items-center justify-between text-[11px] text-muted-2">
          <span className="truncate">
            {files.slice(0, 3).map((f) => f.name).join(', ')}
            {files.length > 3 ? ` +${files.length - 3} more` : ''}
          </span>
          <button onClick={() => setFiles([])} className="inline-flex items-center gap-1 hover:text-foreground">
            <X className="h-3 w-3" /> Clear
          </button>
        </div>
      ) : null}

      {/* Dropzone: tags.json (separate box) */}
      <div className="mt-4">
        <Dropzone
          active={dragTags}
          onDrag={setDragTags}
          onDrop={(dt) => dt.files[0] && loadManifest(dt.files[0])}
          onClick={() => tagsInput.current?.click()}
          disabled={busy}
          icon={<FileJson className="h-6 w-6" />}
          title="Upload tags.json here"
          subtitle="The manifest mapping each filename to its team number(s)."
          badge={manifestStats ? `${manifestStats.entries} entries · ${manifestStats.tagged} tagged` : null}
        />
      </div>
      <input
        ref={tagsInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => e.target.files?.[0] && loadManifest(e.target.files[0])}
      />
      {manifestError ? (
        <div className="mb-2 mt-1 flex items-center gap-1.5 text-[11px] text-[#ef4444]">
          <AlertTriangle className="h-3 w-3" /> {manifestError}
        </div>
      ) : null}

      {/* Action */}
      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={run}
          disabled={!canRun}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? 'Importing…' : 'Start import'}
        </button>
        {busy ? (
          <span className="text-xs text-muted">
            {progress.label}
            {progress.total > 0 ? ` · ${progress.done}/${progress.total}` : ''}
          </span>
        ) : null}
      </div>

      {busy && progress.total > 0 ? (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface">
          <div
            className="h-full bg-foreground transition-all"
            style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
          />
        </div>
      ) : null}

      {/* Result */}
      {fatal ? (
        <div className="mt-5 flex items-start gap-2 rounded-md border border-[#ef4444]/40 bg-[#ef4444]/10 p-3 text-xs text-[#ef4444]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {fatal}
        </div>
      ) : null}

      {result ? (
        <div className="mt-5 rounded-md border border-border bg-surface p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
            <CheckCircle2 className="h-4 w-4 text-[#10b981]" /> Import complete
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[11px] text-muted sm:grid-cols-3">
            <Stat label="added" value={result.stats.inserted} />
            <Stat label="updated" value={result.stats.updated} />
            <Stat label="restored" value={result.stats.resurrected} />
            <Stat label="removed" value={result.stats.softDeleted} />
            <Stat label="skipped" value={result.stats.skipped} />
          </div>
          {result.errors.length > 0 ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] text-[#f59e0b]">
                {result.errors.length} warning{result.errors.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto font-mono text-[10px] text-muted-2">
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <Link
            href={`/albums/${slug}`}
            className="mt-3 inline-flex items-center gap-1 text-xs text-foreground hover:opacity-80"
          >
            View album →
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-2">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function Dropzone({
  active,
  onDrag,
  onDrop,
  onClick,
  disabled,
  icon,
  title,
  subtitle,
  badge,
}: {
  active: boolean;
  onDrag: (v: boolean) => void;
  onDrop: (dt: DataTransfer) => void;
  onClick: () => void;
  disabled: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badge: string | null;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) onDrag(true);
      }}
      onDragLeave={() => onDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        onDrag(false);
        if (!disabled) onDrop(e.dataTransfer);
      }}
      className={cn(
        'flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors',
        active ? 'border-foreground/60 bg-surface' : 'border-border hover:border-border-hover',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span className="text-muted">{icon}</span>
      <span className="text-sm font-medium text-foreground">{title}</span>
      <span className="text-[11px] text-muted-2">{subtitle}</span>
      {badge ? (
        <span className="mt-1 rounded-full border border-border bg-background px-2.5 py-0.5 font-mono text-[10px] text-foreground">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function mergeStats(agg: RunStats, s: Partial<RunStats> | undefined) {
  if (!s) return;
  agg.inserted += s.inserted ?? 0;
  agg.resurrected += s.resurrected ?? 0;
  agg.updated += s.updated ?? 0;
  agg.softDeleted += s.softDeleted ?? 0;
  agg.skipped += s.skipped ?? 0;
}
