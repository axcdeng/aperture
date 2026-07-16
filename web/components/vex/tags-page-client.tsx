'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Tag as TagIcon, Images, FolderPlus, X, Folder as FolderIcon, Plus, Check } from 'lucide-react';
import type { MediaItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { TeamNumber } from './team-number';
import { Lightbox } from './lightbox';
import { EmptyState } from './empty-state';
import {
  type OrganizeConfig,
  ORGANIZE_CHANGED_EVENT,
  TAG_PALETTE,
  addToFolder,
  childFolders,
  createFolder,
  createTag,
  deleteFolder,
  emptyConfig,
  globalTags,
  loadOrganize,
  photoKey,
  removeFromFolder,
  saveOrganize,
} from '@/lib/folders';

const DND = 'application/x-aperture-tagphoto';

export function TagsPageClient() {
  const [cfg, setCfg] = useState<OrganizeConfig>(emptyConfig());
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<Record<string, MediaItem>>({});
  const [loadingItems, setLoadingItems] = useState(false);
  const [activeFolder, setActiveFolder] = useState<Record<string, string | null>>({});
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<{ items: MediaItem[]; id: string } | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [newFolderFor, setNewFolderFor] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingTag, setCreatingTag] = useState(false);

  // Load the local store + refresh when it changes (e.g. edits from an album).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const load = () => setCfg(loadOrganize());
    load();
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    window.addEventListener(ORGANIZE_CHANGED_EVENT, load);
    window.addEventListener('storage', load);
    return () => {
      window.removeEventListener(ORGANIZE_CHANGED_EVENT, load);
      window.removeEventListener('storage', load);
    };
  }, []);

  // A `#tag-<id>` hash focuses a single tag (its photos + folders only).
  // Track it live so the sidebar links switch the view without a reload.
  const [focusTagId, setFocusTagId] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const m = /^#tag-(.+)$/.exec(window.location.hash);
      setFocusTagId(m ? m[1] : null);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const allGlobalTags = useMemo(() => globalTags(cfg), [cfg]);
  const focusTag = useMemo(
    () => (focusTagId ? allGlobalTags.find((t) => t.id === focusTagId) ?? null : null),
    [allGlobalTags, focusTagId],
  );
  // When a valid tag is focused, render just that one; otherwise render all.
  const gtags = useMemo(
    () => (focusTag ? [focusTag] : allGlobalTags),
    [focusTag, allGlobalTags],
  );

  const keysByTag = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const t of gtags) m[t.id] = [];
    for (const [key, ids] of Object.entries(cfg.photoTags))
      for (const id of ids) if (m[id]) m[id].push(key);
    return m;
  }, [gtags, cfg.photoTags]);

  const allKeys = useMemo(
    () => Array.from(new Set(Object.values(keysByTag).flat())),
    [keysByTag],
  );

  // Resolve photo keys (cross-album) to real media rows via the API.
  useEffect(() => {
    if (allKeys.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems({});
      return;
    }
    let cancelled = false;
    setLoadingItems(true);
    fetch('/api/media-by-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: allKeys }),
    })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: MediaItem[] }) => {
        if (cancelled) return;
        const map: Record<string, MediaItem> = {};
        for (const it of d.items) map[photoKey(it.eventId, it.originalFilename)] = it;
        setItems(map);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadingItems(false));
    return () => {
      cancelled = true;
    };
  }, [allKeys]);

  function commit(next: OrganizeConfig) {
    setCfg(next);
    saveOrganize(next);
  }
  const photosFor = (keys: string[]) =>
    keys.map((k) => items[k]).filter((x): x is MediaItem => Boolean(x));
  const keyOf = (p: MediaItem) => photoKey(p.eventId, p.originalFilename);

  if (!ready) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-5 flex items-center gap-2">
        <TagIcon className="h-4 w-4 text-muted" />
        {focusTag ? (
          <>
            <button
              onClick={() => {
                window.history.pushState(null, '', window.location.pathname);
                setFocusTagId(null);
              }}
              className="text-xl font-semibold tracking-tight text-muted transition-colors hover:text-foreground"
            >
              Tags
            </button>
            <span className="text-muted-2">/</span>
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: focusTag.color }} />
            <h1 className="text-xl font-semibold tracking-tight" style={{ color: focusTag.color }}>
              {focusTag.name}
            </h1>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold tracking-tight">Tags</h1>
            <span className="font-mono text-[11px] text-muted-2">{gtags.length}</span>
            <button
              onClick={() => setCreatingTag((v) => !v)}
              className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs text-muted transition-colors hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" /> New tag
            </button>
          </>
        )}
      </div>

      {creatingTag && !focusTag ? (
        <CreateTagForm
          onCancel={() => setCreatingTag(false)}
          onCreate={(name, color) => {
            const { config } = createTag(cfg, name, { color, global: true });
            commit(config);
            setCreatingTag(false);
          }}
        />
      ) : null}

      {gtags.length === 0 ? (
        <EmptyState
          icon={TagIcon}
          title="No global tags yet"
          description="Create one with New tag above, or mark a tag as Global in any album — it'll show up here."
        />
      ) : (
        <div className="space-y-8">
          {gtags.map((tag) => {
            const folders = childFolders(cfg, null, tag.id);
            const folderId = activeFolder[tag.id] ?? null;
            const tagKeys = keysByTag[tag.id] ?? [];
            const shownKeys = folderId ? cfg.folderPhotos[folderId] ?? [] : tagKeys;
            const photos = photosFor(shownKeys);
            return (
              <section key={tag.id} id={`tag-${tag.id}`}>
                {/* Tag header */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }} />
                    <h2 className="text-base font-semibold" style={{ color: tag.color }}>
                      {tag.name}
                    </h2>
                    <span className="font-mono text-[11px] text-muted-2">{tagKeys.length}</span>
                  </div>
                  {newFolderFor === tag.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        commit(createFolder(cfg, newFolderName, null, tag.id));
                        setNewFolderName('');
                        setNewFolderFor(null);
                      }}
                      className="flex items-center gap-1"
                    >
                      <input
                        autoFocus
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onBlur={() => !newFolderName.trim() && setNewFolderFor(null)}
                        placeholder="Folder name"
                        className="h-7 w-36 rounded-md border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-border-hover"
                      />
                    </form>
                  ) : (
                    <button
                      onClick={() => setNewFolderFor(tag.id)}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs text-muted hover:text-foreground"
                    >
                      <FolderPlus className="h-3.5 w-3.5" /> New folder
                    </button>
                  )}
                </div>

                {/* Folders (drag photos onto them) */}
                {folders.length > 0 ? (
                  <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    <FolderChip
                      label="All"
                      active={folderId === null}
                      onClick={() => setActiveFolder((m) => ({ ...m, [tag.id]: null }))}
                    />
                    {folders.map((f) => (
                      <FolderChip
                        key={f.id}
                        label={f.name}
                        count={(cfg.folderPhotos[f.id] ?? []).length}
                        active={folderId === f.id}
                        over={dragOverFolder === f.id}
                        onClick={() =>
                          setActiveFolder((m) => ({ ...m, [tag.id]: folderId === f.id ? null : f.id }))
                        }
                        onDelete={() => {
                          commit(deleteFolder(cfg, f.id));
                          if (folderId === f.id) setActiveFolder((m) => ({ ...m, [tag.id]: null }));
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOverFolder(f.id);
                        }}
                        onDragLeave={() => setDragOverFolder((c) => (c === f.id ? null : c))}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOverFolder(null);
                          const key = e.dataTransfer.getData(DND);
                          if (key) commit(addToFolder(cfg, f.id, [key]));
                        }}
                      />
                    ))}
                  </div>
                ) : null}

                {/* Photos: grouped by team (Finder-style) at the tag root; a
                    flat grid when a folder is selected. */}
                {loadingItems && photos.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted">Loading photos…</div>
                ) : photos.length === 0 ? (
                  <EmptyState
                    icon={Images}
                    title="No photos"
                    description={folderId ? 'Drag photos onto this folder to add them.' : 'No photos carry this tag yet.'}
                  />
                ) : folderId ? (
                  <FolderGrid
                    photos={photos}
                    onOpen={(p) => setLightbox({ items: photos, id: p.id })}
                    onRemove={(p) => commit(removeFromFolder(cfg, folderId, [keyOf(p)]))}
                    dndType={DND}
                    keyOf={keyOf}
                  />
                ) : (
                  <TeamGroups
                    photos={photos}
                    openGroups={openGroups}
                    tagKey={tag.id}
                    onToggleGroup={(gk) =>
                      setOpenGroups((prev) => {
                        const n = new Set(prev);
                        if (n.has(gk)) n.delete(gk);
                        else n.add(gk);
                        return n;
                      })
                    }
                    onOpen={(items2, id) => setLightbox({ items: items2, id })}
                    dndType={DND}
                    keyOf={keyOf}
                  />
                )}
              </section>
            );
          })}
        </div>
      )}

      <Lightbox
        items={lightbox?.items ?? []}
        activeId={lightbox?.id ?? null}
        onClose={() => setLightbox(null)}
        onChange={(id) => setLightbox((lb) => (lb ? { ...lb, id } : lb))}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function TeamGroups({
  photos,
  openGroups,
  tagKey,
  onToggleGroup,
  onOpen,
  dndType,
  keyOf,
}: {
  photos: MediaItem[];
  openGroups: Set<string>;
  tagKey: string;
  onToggleGroup: (groupKey: string) => void;
  onOpen: (items: MediaItem[], id: string) => void;
  dndType: string;
  keyOf: (p: MediaItem) => string;
}) {
  const groups = useMemo(() => {
    const by = new Map<string, MediaItem[]>();
    const order: string[] = [];
    for (const p of photos)
      for (const t of p.teamNumbers ?? []) {
        if (!by.has(t)) {
          by.set(t, []);
          order.push(t);
        }
        by.get(t)!.push(p);
      }
    order.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const res = order.map((t) => ({ key: t, label: t, photos: by.get(t)! }));
    const none = photos.filter((p) => !(p.teamNumbers ?? []).length);
    if (none.length) res.push({ key: '__none', label: 'No team', photos: none });
    return res;
  }, [photos]);

  return (
    <div className="space-y-5">
      {groups.map((g) => {
        const gk = `${tagKey}:${g.key}`;
        const expanded = openGroups.has(gk);
        return (
          <div key={g.key}>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {g.key === '__none' ? (
                  <span className="text-sm font-medium text-muted">No team</span>
                ) : (
                  <TeamNumber number={g.label} size="md" />
                )}
                <span className="font-mono text-[10px] text-muted-2">{g.photos.length}</span>
              </div>
              <button
                onClick={() => onToggleGroup(gk)}
                className="text-xs text-muted transition-colors hover:text-foreground"
              >
                {expanded ? 'Show less' : `Show all (${g.photos.length})`}
              </button>
            </div>
            {expanded ? (
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}
              >
                {g.photos.map((p) => (
                  <Thumb key={p.id} photo={p} onOpen={() => onOpen(g.photos, p.id)} dndType={dndType} keyOf={keyOf} />
                ))}
              </div>
            ) : (
              <div className="flex gap-3 overflow-hidden">
                {g.photos.map((p) => (
                  <div key={p.id} className="w-40 shrink-0">
                    <Thumb photo={p} onOpen={() => onOpen(g.photos, p.id)} dndType={dndType} keyOf={keyOf} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FolderGrid({
  photos,
  onOpen,
  onRemove,
  dndType,
  keyOf,
}: {
  photos: MediaItem[];
  onOpen: (p: MediaItem) => void;
  onRemove: (p: MediaItem) => void;
  dndType: string;
  keyOf: (p: MediaItem) => string;
}) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
      {photos.map((p) => (
        <Thumb key={p.id} photo={p} onOpen={() => onOpen(p)} onRemove={() => onRemove(p)} dndType={dndType} keyOf={keyOf} />
      ))}
    </div>
  );
}

function Thumb({
  photo,
  onOpen,
  onRemove,
  dndType,
  keyOf,
}: {
  photo: MediaItem;
  onOpen: () => void;
  onRemove?: () => void;
  dndType: string;
  keyOf: (p: MediaItem) => string;
}) {
  return (
    <div
      className="group relative"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(dndType, keyOf(photo));
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <button onClick={onOpen} className="block w-full text-left">
        <div className="relative aspect-[4/3] overflow-hidden rounded-md border border-border bg-[#0d0d0d] transition-colors group-hover:border-border-hover">
          {photo.thumbnailUrl ? (
            <Image
              src={photo.thumbnailUrl}
              alt={photo.originalFilename ?? 'photo'}
              fill
              sizes="160px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-2">
              <Images className="h-5 w-5" />
            </div>
          )}
        </div>
        {photo.originalFilename ? (
          <div className="mt-1 truncate font-mono text-[10px] text-muted-2" title={photo.originalFilename}>
            {photo.originalFilename}
          </div>
        ) : null}
      </button>
      {onRemove ? (
        <button
          onClick={onRemove}
          aria-label="Remove from folder"
          className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded border border-white/40 bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

function CreateTagForm({
  onCreate,
  onCancel,
}: {
  onCreate: (name: string, color: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(TAG_PALETTE[0]);
  const submit = () => {
    if (name.trim()) onCreate(name, color);
  };
  return (
    <div className="mb-6 rounded-lg border border-border bg-surface p-3">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="Tag name"
        className="mb-3 h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-border-hover"
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {TAG_PALETTE.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            aria-label={`Color ${c}`}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full ring-1 ring-black/30 transition-transform hover:scale-110',
              color === c && 'ring-2 ring-foreground',
            )}
            style={{ backgroundColor: c }}
          >
            {color === c ? <Check className="h-3.5 w-3.5 text-white" /> : null}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={!name.trim()}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Create tag
        </button>
        <button
          onClick={onCancel}
          className="inline-flex h-7 items-center rounded-md border border-border px-3 text-xs text-muted transition-colors hover:text-foreground"
        >
          Cancel
        </button>
        <span className="ml-auto text-[10px] text-muted-2">Tags here are global — shown in every album + sidebar.</span>
      </div>
    </div>
  );
}

function FolderChip({
  label,
  count,
  active,
  over,
  onClick,
  onDelete,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  label: string;
  count?: number;
  active: boolean;
  over?: boolean;
  onClick: () => void;
  onDelete?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  return (
    <span
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors',
        over
          ? 'border-foreground/50 ring-2 ring-foreground/40'
          : active
            ? 'border-foreground/40 bg-surface text-foreground'
            : 'border-border text-muted hover:text-foreground',
      )}
    >
      <button onClick={onClick} className="inline-flex items-center gap-1.5">
        {onDelete ? <FolderIcon className="h-3 w-3" /> : null}
        {label}
        {typeof count === 'number' ? (
          <span className="font-mono text-[10px] text-muted-2">{count}</span>
        ) : null}
      </button>
      {onDelete ? (
        <button onClick={onDelete} aria-label={`Delete folder ${label}`} className="text-muted-2 hover:text-foreground">
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}
