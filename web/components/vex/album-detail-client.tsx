'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ChevronLeft,
  ChevronRight,
  Folder as FolderIcon,
  FolderPlus,
  Sparkles,
  Download,
  Upload,
  Search,
  X,
  Check,
  Images,
  Plus,
  Minus,
  Tag as TagIcon,
  Users,
  ArrowUpRight,
  Globe,
} from 'lucide-react';
import type { AlbumSummary, MediaItem } from '@/lib/types';
import { cn, formatDate } from '@/lib/utils';
import { Lightbox } from './lightbox';
import { EmptyState } from './empty-state';
import { TeamNumber } from './team-number';
import {
  type OrganizeConfig,
  type Tag,
  TAG_PALETTE,
  addToFolder,
  applyAutoAdd,
  autoCreateFoldersFromTags,
  childFolders,
  createFolder,
  createTag,
  deleteFolder,
  deleteTag,
  emptyConfig,
  exportConfig,
  folderPath,
  importConfig,
  loadOrganize,
  moveFolder,
  photoKey,
  removeFromFolder,
  saveOrganize,
  setTagOnPhotos,
  tagsForPhoto,
  updateTag,
  visibleTags,
} from '@/lib/folders';

const DND = 'application/x-aperture-item';
type DragPayload = { kind: 'photos'; keys: string[] } | { kind: 'folder'; id: string };
type TagFormValue = {
  name: string;
  color: string;
  global: boolean;
  autoAdd: string[];
  teams: Set<string>;
};
type PhotoGroup = {
  key: string;
  label: string;
  kind: 'team' | 'tag' | 'plain';
  tag?: Tag;
  photos: MediaItem[];
};

export function AlbumDetailClient({
  album,
  photos,
}: {
  album: AlbumSummary;
  photos: MediaItem[];
}) {
  const keyOf = (p: MediaItem) => photoKey(p.eventId, p.originalFilename);

  const [cfg, setCfg] = useState<OrganizeConfig>(emptyConfig());
  const [ready, setReady] = useState(false);
  const [folderId, setFolderId] = useState<string | null>(null); // current location; null = All
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeTeam, setActiveTeam] = useState<string | null>(null);
  const [teamsExpanded, setTeamsExpanded] = useState(false);
  const [teamsOverflow, setTeamsOverflow] = useState(false);
  const teamsRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<'default' | 'team' | 'tag'>('default');
  const [cols, setCols] = useState(3); // photos per row in Default view
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set()); // expanded groups in Team/Tag views
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null); // folderId | 'crumb:<id|root>'
  const [newFolder, setNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [tagMenu, setTagMenu] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Seed/load organize state once we know the album's photo→team mapping.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setCfg(loadOrganize());
    try {
      if (localStorage.getItem('aperture:albums:teamsExpanded') === '1') setTeamsExpanded(true);
      const v = localStorage.getItem('aperture:albums:view');
      if (v === 'team' || v === 'tag' || v === 'default') setView(v);
      const c = parseInt(localStorage.getItem('aperture:albums:cols') ?? '', 10);
      if (c >= 2 && c <= 8) setCols(c);
    } catch {
      /* ignore */
    }
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  function changeView(v: 'default' | 'team' | 'tag') {
    setView(v);
    setOpenGroups(new Set());
    try {
      localStorage.setItem('aperture:albums:view', v);
    } catch {
      /* ignore */
    }
  }

  function changeCols(delta: number) {
    setCols((c) => {
      const next = Math.min(8, Math.max(2, c + delta));
      try {
        localStorage.setItem('aperture:albums:cols', String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function toggleTeams() {
    setTeamsExpanded((v) => {
      const next = !v;
      try {
        localStorage.setItem('aperture:albums:teamsExpanded', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Teams are derived from the manifest — a separate, read-only facet.
  const allTeams = useMemo(() => {
    const s = new Set<string>();
    photos.forEach((p) => (p.teamNumbers ?? []).forEach((t) => s.add(t)));
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [photos]);

  // Detect whether the team chips exceed ~2 rows, so we know to show the
  // Show-all / Hide controls. scrollHeight is the full content height in either
  // state, so this holds whether currently expanded or collapsed.
  useEffect(() => {
    const el = teamsRef.current;
    if (el) setTeamsOverflow(el.scrollHeight > 66);
  }, [allTeams, ready]);

  // team -> photo keys, for the tag menu's "add teams' photos" option.
  const teamToKeys = useMemo(() => {
    const m = new Map<string, string[]>();
    photos.forEach((p) => {
      const k = photoKey(p.eventId, p.originalFilename);
      (p.teamNumbers ?? []).forEach((t) => {
        const arr = m.get(t);
        if (arr) arr.push(k);
        else m.set(t, [k]);
      });
    });
    return m;
  }, [photos]);

  const seedPhotos = useMemo(
    () => photos.map((p) => ({ key: photoKey(p.eventId, p.originalFilename), teams: p.teamNumbers ?? [] })),
    [photos],
  );

  // How many of THIS album's photos carry each tag (global tags may have many
  // more across other albums, but the chip count should reflect what's here).
  const albumTagCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of photos)
      for (const id of cfg.photoTags[photoKey(p.eventId, p.originalFilename)] ?? [])
        m[id] = (m[id] ?? 0) + 1;
    return m;
  }, [photos, cfg.photoTags]);

  const shownTags = useMemo(() => visibleTags(cfg, album.id), [cfg, album.id]);

  function commit(next: OrganizeConfig) {
    setCfg(next);
    saveOrganize(next);
  }

  // Apply auto-add tags (global or this-album) to matching photos on load and
  // whenever tags change. applyAutoAdd returns the same ref when nothing
  // changes, so this settles after one pass (no loop).
  useEffect(() => {
    if (!ready) return;
    const next = applyAutoAdd(cfg, album.id, seedPhotos);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (next !== cfg) commit(next);
  }, [ready, cfg, seedPhotos, album.id]);

  // Create or update a tag from the menu: name, color, global flag, auto-add
  // patterns, then bulk-apply it to every photo of each selected team.
  function submitTag(mode: 'create' | 'edit', id: string | null, v: TagFormValue) {
    const n = v.name.trim();
    if (!n) return;
    let next = cfg;
    let tagId = id;
    if (mode === 'create') {
      const res = createTag(next, n, {
        color: v.color,
        eventId: album.id,
        global: v.global,
        autoAdd: v.autoAdd,
      });
      next = res.config;
      tagId = res.id;
    } else if (id) {
      next = updateTag(next, id, {
        name: n,
        color: v.color,
        global: v.global,
        autoAdd: v.autoAdd,
      });
    }
    if (tagId) {
      for (const team of v.teams) {
        next = setTagOnPhotos(next, tagId, teamToKeys.get(team) ?? [], true);
      }
      // Auto-add patterns may match photos in THIS album immediately.
      next = applyAutoAdd(next, album.id, seedPhotos);
    }
    commit(next);
    setTagMenu(null);
  }

  function removeTag(id: string) {
    commit(deleteTag(cfg, id));
    if (activeTag === id) setActiveTag(null);
    setTagMenu(null);
  }
  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice((c) => (c === msg ? null : c)), 2400);
  }

  const byKey = useMemo(() => new Map(photos.map((p) => [keyOf(p), p])), [photos]);
  const subfolders = useMemo(() => childFolders(cfg, folderId), [cfg, folderId]);
  const crumbs = useMemo(() => folderPath(cfg, folderId), [cfg, folderId]);

  // Photos shown in the current location, after tag + search filters.
  const visiblePhotos = useMemo(() => {
    const q = query.trim().toLowerCase();
    let keys: string[];
    if (folderId === null) keys = photos.map(keyOf);
    else keys = cfg.folderPhotos[folderId] ?? [];
    let list = keys.map((k) => byKey.get(k)).filter(Boolean) as MediaItem[];
    if (activeTeam) list = list.filter((p) => (p.teamNumbers ?? []).includes(activeTeam));
    if (activeTag) list = list.filter((p) => (cfg.photoTags[keyOf(p)] ?? []).includes(activeTag));
    if (q)
      list = list.filter(
        (p) =>
          (p.originalFilename ?? '').toLowerCase().includes(q) ||
          (p.teamNumbers ?? []).some((t) => t.toLowerCase().includes(q)) ||
          tagsForPhoto(cfg, keyOf(p)).some((t) => t.name.toLowerCase().includes(q)),
      );
    return list;
  }, [cfg, folderId, query, activeTag, activeTeam, photos, byKey]);

  // Base set for the grouped (By Team / By Tag) views: search + facet filters,
  // but NOT folder scope (grouping replaces folders).
  const groupBase = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = photos;
    if (activeTeam) list = list.filter((p) => (p.teamNumbers ?? []).includes(activeTeam));
    if (activeTag) list = list.filter((p) => (cfg.photoTags[keyOf(p)] ?? []).includes(activeTag));
    if (q)
      list = list.filter(
        (p) =>
          (p.originalFilename ?? '').toLowerCase().includes(q) ||
          (p.teamNumbers ?? []).some((t) => t.toLowerCase().includes(q)) ||
          tagsForPhoto(cfg, keyOf(p)).some((t) => t.name.toLowerCase().includes(q)),
      );
    return list;
  }, [photos, activeTeam, activeTag, query, cfg]);

  const groups = useMemo<PhotoGroup[]>(() => {
    if (view === 'team') {
      const by = new Map<string, MediaItem[]>();
      for (const p of groupBase)
        for (const t of p.teamNumbers ?? []) {
          const a = by.get(t);
          if (a) a.push(p);
          else by.set(t, [p]);
        }
      const res: PhotoGroup[] = allTeams
        .filter((t) => by.has(t))
        .map((t) => ({ key: t, label: t, kind: 'team', photos: by.get(t)! }));
      const none = groupBase.filter((p) => !(p.teamNumbers ?? []).length);
      if (none.length) res.push({ key: '__none', label: 'No team', kind: 'plain', photos: none });
      return res;
    }
    if (view === 'tag') {
      const by = new Map<string, MediaItem[]>();
      for (const p of groupBase)
        for (const id of cfg.photoTags[keyOf(p)] ?? []) {
          const a = by.get(id);
          if (a) a.push(p);
          else by.set(id, [p]);
        }
      const res: PhotoGroup[] = cfg.tags
        .filter((t) => by.has(t.id))
        .map((t) => ({ key: t.id, label: t.name, kind: 'tag', tag: t, photos: by.get(t.id)! }));
      const none = groupBase.filter((p) => !(cfg.photoTags[keyOf(p)] ?? []).length);
      if (none.length) res.push({ key: '__none', label: 'Untagged', kind: 'plain', photos: none });
      return res;
    }
    return [];
  }, [view, groupBase, allTeams, cfg]);

  const selKeys = Array.from(selected);

  const [lightboxItems, setLightboxItems] = useState<MediaItem[]>([]);
  function openLightbox(items: MediaItem[], id: string) {
    setLightboxItems(items);
    setActiveId(id);
  }

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  // ---- drag & drop -------------------------------------------------------
  function startPhotoDrag(e: React.DragEvent, key: string) {
    const keys = selected.has(key) ? selKeys : [key];
    e.dataTransfer.setData(DND, JSON.stringify({ kind: 'photos', keys } satisfies DragPayload));
    e.dataTransfer.effectAllowed = 'move';
  }
  function startFolderDrag(e: React.DragEvent, id: string) {
    e.dataTransfer.setData(DND, JSON.stringify({ kind: 'folder', id } satisfies DragPayload));
    e.dataTransfer.effectAllowed = 'move';
  }
  function readDrag(e: React.DragEvent): DragPayload | null {
    try {
      return JSON.parse(e.dataTransfer.getData(DND));
    } catch {
      return null;
    }
  }
  function dropOnFolder(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    setDragOver(null);
    const p = readDrag(e);
    if (!p) return;
    if (p.kind === 'photos') {
      commit(addToFolder(cfg, targetId, p.keys));
      flash(`Added ${p.keys.length} to folder`);
      setSelected(new Set());
    } else if (p.kind === 'folder' && p.id !== targetId) {
      commit(moveFolder(cfg, p.id, targetId));
    }
  }
  function dropOnCrumb(e: React.DragEvent, targetId: string | null) {
    e.preventDefault();
    setDragOver(null);
    const p = readDrag(e);
    if (!p) return;
    if (p.kind === 'folder') {
      commit(moveFolder(cfg, p.id, targetId));
    } else if (p.kind === 'photos') {
      if (targetId === null && folderId) {
        commit(removeFromFolder(cfg, folderId, p.keys)); // move out to album level
        flash(`Removed ${p.keys.length} from folder`);
      } else if (targetId) {
        commit(addToFolder(cfg, targetId, p.keys));
      }
      setSelected(new Set());
    }
  }

  if (!ready) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href="/albums"
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Albums
      </Link>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{album.name}</h1>
          <p className="mt-1 text-xs text-muted">
            {[album.date ? formatDate(album.date) : null, album.location]
              .filter(Boolean)
              .join(' · ') || '—'}
          </p>
          {album.note ? <p className="mt-1 text-xs text-muted-2">{album.note}</p> : null}
        </div>
        <div className="flex items-center gap-3">
          <div className="font-mono text-[11px] text-muted-2">
            {album.photoCount} photos · {album.teamCount} teams
          </div>
          <Link
            href={`/albums/${album.slug}/import`}
            target="_blank"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs text-foreground transition-colors hover:border-border-hover"
          >
            <Upload className="h-3.5 w-3.5" /> Import
          </Link>
        </div>
      </div>

      {/* ---- Teams (data-derived, read-only) ---- */}
      {allTeams.length > 0 ? (
        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-2">
              <Users className="h-3 w-3" /> Teams
            </div>
            {teamsOverflow && teamsExpanded ? (
              <button
                onClick={toggleTeams}
                className="text-[10px] uppercase tracking-wider text-muted-2 hover:text-foreground"
              >
                Hide
              </button>
            ) : null}
          </div>
          <div
            ref={teamsRef}
            className={cn(
              'flex flex-wrap items-center gap-1.5',
              !teamsExpanded && 'max-h-16 overflow-hidden',
            )}
          >
            <button
              onClick={() => setActiveTeam(null)}
              className={cn(
                'inline-flex h-7 items-center rounded-md border px-2.5 text-xs transition-colors',
                activeTeam === null
                  ? 'border-foreground/40 bg-surface text-foreground'
                  : 'border-border text-muted hover:text-foreground',
              )}
            >
              All
            </button>
            {allTeams.map((team) => (
              <span
                key={team}
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-md border pl-2.5 pr-1.5 transition-colors',
                  activeTeam === team ? 'border-foreground/40 bg-surface' : 'border-border',
                )}
              >
                <button onClick={() => setActiveTeam((c) => (c === team ? null : team))} aria-pressed={activeTeam === team}>
                  <TeamNumber number={team} size="sm" />
                </button>
                <Link
                  href={`/team/${team}`}
                  aria-label={`Open team ${team} page`}
                  className="text-muted-2 hover:text-foreground"
                >
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </span>
            ))}
          </div>
          {teamsOverflow && !teamsExpanded ? (
            <button
              onClick={toggleTeams}
              className="mt-1.5 text-xs text-muted transition-colors hover:text-foreground"
            >
              Show all teams…
            </button>
          ) : null}
        </div>
      ) : null}

      {/* ---- Tags (user-created) ---- */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-2">
          <TagIcon className="h-3 w-3" /> Tags
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setActiveTag(null)}
            className={cn(
              'inline-flex h-7 items-center rounded-md border px-2.5 text-xs transition-colors',
              activeTag === null
                ? 'border-foreground/40 bg-surface text-foreground'
                : 'border-border text-muted hover:text-foreground',
            )}
          >
            All
          </button>
          {shownTags.map((t) => (
            <span key={t.id} className="relative">
              <TagPill
                tag={t}
                count={albumTagCounts[t.id] ?? 0}
                active={activeTag === t.id}
                onFilter={() => setActiveTag((cur) => (cur === t.id ? null : t.id))}
                onEdit={() => setTagMenu({ mode: 'edit', id: t.id })}
              />
              {tagMenu?.mode === 'edit' && tagMenu.id === t.id ? (
                <TagMenu
                  mode="edit"
                  tag={t}
                  allTeams={allTeams}
                  teamToKeys={teamToKeys}
                  onClose={() => setTagMenu(null)}
                  onSubmit={(v) => submitTag('edit', t.id, v)}
                  onDelete={() => removeTag(t.id)}
                />
              ) : null}
            </span>
          ))}
          <span className="relative">
            <button
              onClick={() => setTagMenu(tagMenu?.mode === 'create' ? null : { mode: 'create' })}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-border px-2 text-xs text-muted-2 hover:text-foreground"
            >
              <Plus className="h-3 w-3" /> Tag
            </button>
            {tagMenu?.mode === 'create' ? (
              <TagMenu
                mode="create"
                allTeams={allTeams}
                teamToKeys={teamToKeys}
                onClose={() => setTagMenu(null)}
                onSubmit={(v) => submitTag('create', null, v)}
              />
            ) : null}
          </span>
        </div>
      </div>

      {/* ---- Search ---- */}
      <div className="mb-3 flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-2.5 focus-within:border-border-hover">
        <Search className="h-4 w-4 shrink-0 text-muted-2" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by filename or tag…"
          className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-2"
          aria-label="Filter album"
        />
        {query ? (
          <button onClick={() => setQuery('')} aria-label="Clear" className="text-muted-2 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* ---- View switcher ---- */}
      <div className="mb-3 inline-flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5 text-xs">
        {(['default', 'team', 'tag'] as const).map((v) => (
          <button
            key={v}
            onClick={() => changeView(v)}
            className={cn(
              'rounded px-2.5 py-1 transition-colors',
              view === v ? 'bg-foreground font-medium text-accent-fg' : 'text-muted hover:text-foreground',
            )}
          >
            {v === 'default' ? 'Default' : v === 'team' ? 'By Team' : 'By Tag'}
          </button>
        ))}
      </div>

      {view === 'default' ? (
        <>
      {/* ---- Breadcrumb + toolbar ---- */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs">
          <Crumb
            label="All"
            active={folderId === null}
            over={dragOver === 'crumb:root'}
            onClick={() => setFolderId(null)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver('crumb:root');
            }}
            onDragLeave={() => setDragOver((c) => (c === 'crumb:root' ? null : c))}
            onDrop={(e) => dropOnCrumb(e, null)}
          />
          {crumbs.map((f) => (
            <span key={f.id} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-muted-2" />
              <Crumb
                label={f.name}
                active={folderId === f.id}
                over={dragOver === `crumb:${f.id}`}
                onClick={() => setFolderId(f.id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(`crumb:${f.id}`);
                }}
                onDragLeave={() => setDragOver((c) => (c === `crumb:${f.id}` ? null : c))}
                onDrop={(e) => dropOnCrumb(e, f.id)}
              />
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {newFolder ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                commit(createFolder(cfg, newFolderName, folderId));
                setNewFolderName('');
                setNewFolder(false);
              }}
              className="flex items-center gap-1"
            >
              <input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onBlur={() => !newFolderName.trim() && setNewFolder(false)}
                placeholder="Folder name"
                className="h-7 w-36 rounded-md border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-border-hover"
              />
              <ToolbarButton icon={Check} label="Create" type="submit" />
            </form>
          ) : (
            <ToolbarButton icon={FolderPlus} label="New folder" onClick={() => setNewFolder(true)} />
          )}
          <ToolbarButton
            icon={Sparkles}
            label="Auto-create from tags"
            onClick={() => {
              commit(autoCreateFoldersFromTags(cfg));
              flash('Created folders from tags');
            }}
          />
          <ToolbarButton icon={Download} label="Export" onClick={() => doExport(cfg)} />
          <ToolbarButton icon={Upload} label="Import" onClick={() => fileInput.current?.click()} />
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              const replace = window.confirm(
                'Replace your organization with the imported set?\n\nOK = replace · Cancel = merge.',
              );
              const next = importConfig(cfg, await f.text(), replace ? 'replace' : 'merge');
              if (!next) return flash('Not a valid export file.');
              commit(next);
              flash(replace ? 'Replaced' : 'Merged');
            }}
          />
          {notice ? <span className="text-xs text-muted">{notice}</span> : null}
        </div>
      </div>

      {/* ---- Selection bar ---- */}
      {selKeys.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs">
          <span className="font-mono text-foreground">{selKeys.length} selected</span>
          {cfg.tags.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-2">Tag:</span>
              {cfg.tags.map((t) => {
                const allHave = selKeys.every((k) => (cfg.photoTags[k] ?? []).includes(t.id));
                return (
                  <button
                    key={t.id}
                    onClick={() => commit(setTagOnPhotos(cfg, t.id, selKeys, !allHave))}
                    className={cn(
                      'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 transition-colors',
                      allHave ? 'border-transparent text-background' : 'border-border text-foreground hover:bg-surface',
                    )}
                    style={allHave ? { backgroundColor: t.color } : undefined}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                    {t.name}
                  </button>
                );
              })}
            </span>
          ) : null}
          {subfolders.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-2">Add to:</span>
              {subfolders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    commit(addToFolder(cfg, f.id, selKeys));
                    flash(`Added ${selKeys.length} to ${f.name}`);
                  }}
                  className="rounded border border-border px-1.5 py-0.5 text-foreground hover:bg-surface"
                >
                  {f.name}
                </button>
              ))}
            </span>
          ) : null}
          {folderId ? (
            <button
              onClick={() => {
                commit(removeFromFolder(cfg, folderId, selKeys));
                setSelected(new Set());
              }}
              className="text-muted hover:text-foreground"
            >
              Remove from folder
            </button>
          ) : null}
          <button onClick={() => setSelected(new Set())} className="ml-auto text-muted-2 hover:text-foreground">
            Clear
          </button>
        </div>
      ) : null}

      {/* ---- Folders section ---- */}
      {subfolders.length > 0 ? (
        <>
          <SectionLabel>Folders</SectionLabel>
          <div className="mb-1 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {subfolders.map((f) => (
              <FolderCard
                key={f.id}
                name={f.name}
                count={(cfg.folderPhotos[f.id] ?? []).length}
                subCount={childFolders(cfg, f.id).length}
                over={dragOver === f.id}
                onOpen={() => setFolderId(f.id)}
                onDelete={() => commit(deleteFolder(cfg, f.id))}
                onDragStart={(e) => startFolderDrag(e, f.id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(f.id);
                }}
                onDragLeave={() => setDragOver((c) => (c === f.id ? null : c))}
                onDrop={(e) => dropOnFolder(e, f.id)}
              />
            ))}
          </div>
          <div className="my-4 border-t border-border" />
        </>
      ) : null}

      {/* ---- Photos section ---- */}
      <div className="mb-2 flex items-center justify-between">
        <SectionLabel>{folderId === null ? 'Photos' : 'In this folder'}</SectionLabel>
        <div className="flex items-center gap-0.5 text-muted-2">
          <button
            onClick={() => changeCols(-1)}
            disabled={cols <= 2}
            aria-label="Fewer per row (larger)"
            className="rounded p-1 hover:text-foreground disabled:opacity-30"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => changeCols(1)}
            disabled={cols >= 8}
            aria-label="More per row (smaller)"
            className="rounded p-1 hover:text-foreground disabled:opacity-30"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {visiblePhotos.length === 0 ? (
        <EmptyState
          icon={Images}
          title="No photos"
          description={
            query || activeTag
              ? 'No photos match the current filter.'
              : folderId
                ? 'Drag photos onto this folder, or use the selection bar to add them.'
                : 'This album has no photos yet.'
          }
        />
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {visiblePhotos.map((p) => (
            <PhotoCard
              key={p.id}
              photo={p}
              teamNumbers={p.teamNumbers ?? []}
              tags={tagsForPhoto(cfg, keyOf(p))}
              selected={selected.has(keyOf(p))}
              onToggleSelect={() => toggleSelect(keyOf(p))}
              onOpen={() => openLightbox(visiblePhotos, p.id)}
              onDragStart={(e) => startPhotoDrag(e, keyOf(p))}
            />
          ))}
        </div>
      )}
        </>
      ) : (
        <GroupedView
          groups={groups}
          openGroups={openGroups}
          onToggleGroup={toggleGroup}
          onOpenPhoto={openLightbox}
        />
      )}

      <Lightbox
        items={lightboxItems}
        activeId={activeId}
        onClose={() => setActiveId(null)}
        onChange={(id) => setActiveId(id)}
      />
    </div>
  );
}

// --------------------------------------------------------------------------

function doExport(cfg: OrganizeConfig) {
  const blob = new Blob([exportConfig(cfg)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'aperture-albums.json';
  a.click();
  URL.revokeObjectURL(url);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-2">{children}</div>
  );
}

function TagPill({
  tag,
  count,
  active,
  onFilter,
  onEdit,
}: {
  tag: Tag;
  count: number;
  active: boolean;
  onFilter: () => void;
  onEdit: () => void;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md border px-1.5 text-xs transition-colors',
        active ? 'border-foreground/40 bg-surface text-foreground' : 'border-border text-muted',
      )}
    >
      <button
        onClick={onEdit}
        aria-label={`Edit ${tag.name}`}
        className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-black/30 transition-transform hover:scale-110"
        style={{ backgroundColor: tag.color }}
      />
      <button onClick={onFilter} className="inline-flex items-center gap-1 hover:text-foreground">
        {tag.global ? <Globe className="h-2.5 w-2.5 text-muted-2" aria-label="Global tag" /> : null}
        {tag.name}
        <span className="ml-0.5 font-mono text-[10px] text-muted-2">{count}</span>
      </button>
    </span>
  );
}

// Create/edit popover: name, color, Global toggle, auto-add patterns, and an
// "add teams' photos" dropdown of every team in the album.
function TagMenu({
  mode,
  tag,
  allTeams,
  teamToKeys,
  onSubmit,
  onDelete,
  onClose,
}: {
  mode: 'create' | 'edit';
  tag?: Tag;
  allTeams: string[];
  teamToKeys: Map<string, string[]>;
  onSubmit: (v: TagFormValue) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(tag?.name ?? '');
  const [color, setColor] = useState(tag?.color ?? TAG_PALETTE[0]);
  const [global, setGlobal] = useState(tag?.global ?? false);
  const [autoAdd, setAutoAdd] = useState<string[]>(tag?.autoAdd ?? []);
  const [autoInput, setAutoInput] = useState('');
  const [teams, setTeams] = useState<Set<string>>(new Set());
  const [teamsOpen, setTeamsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  function toggleTeam(t: string) {
    setTeams((prev) => {
      const n = new Set(prev);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  }

  function commitAutoInput() {
    const tok = autoInput.trim().toUpperCase();
    if (/^\d{1,6}[A-Z]?$/.test(tok) && !autoAdd.includes(tok)) setAutoAdd((a) => [...a, tok]);
    setAutoInput('');
  }

  function submit() {
    onSubmit({ name, color, global, autoAdd, teams });
  }

  return (
    <div
      ref={ref}
      className="absolute left-0 top-8 z-30 w-64 rounded-md border border-border bg-surface-2 p-3 shadow-2xl"
    >
      <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-2">Name</label>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="Tag name"
        className="mb-3 h-8 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground outline-none focus:border-border-hover"
      />

      <button
        onClick={() => setGlobal((g) => !g)}
        className="mb-3 flex w-full items-center gap-2 whitespace-nowrap text-xs text-foreground"
      >
        <span
          className={cn(
            'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border',
            global ? 'border-foreground bg-foreground text-accent-fg' : 'border-border',
          )}
        >
          {global ? <Check className="h-3 w-3" /> : null}
        </span>
        <Globe className="h-3 w-3 shrink-0 text-muted-2" />
        <span>Global (show everywhere)</span>
      </button>

      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-2">
        Auto-add teams / numbers
      </div>
      <div className="mb-1 flex flex-wrap gap-1">
        {autoAdd.map((p) => (
          <span
            key={p}
            className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-foreground"
          >
            {p}
            <button
              onClick={() => setAutoAdd((a) => a.filter((x) => x !== p))}
              aria-label={`Remove ${p}`}
              className="text-muted-2 hover:text-foreground"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
      </div>
      <input
        value={autoInput}
        onChange={(e) => setAutoInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commitAutoInput();
          }
        }}
        onBlur={commitAutoInput}
        placeholder="e.g. 5503 or 5503A, then Enter"
        className="mb-3 h-8 w-full rounded-md border border-border bg-surface px-2 font-mono text-xs text-foreground outline-none focus:border-border-hover"
      />

      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-2">Color</div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {TAG_PALETTE.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            aria-label={`Color ${c}`}
            className={cn(
              'h-5 w-5 rounded-full ring-1 ring-black/30',
              c === color && 'ring-2 ring-offset-1 ring-offset-surface-2 ring-foreground',
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      {allTeams.length > 0 ? (
        <>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-2">
            Add teams&apos; photos
          </div>
          <button
            onClick={() => setTeamsOpen((o) => !o)}
            className="mb-2 flex h-8 w-full items-center justify-between rounded-md border border-border bg-surface px-2 text-xs text-foreground hover:border-border-hover"
          >
            <span className={teams.size ? 'text-foreground' : 'text-muted-2'}>
              {teams.size ? `${teams.size} team${teams.size > 1 ? 's' : ''} selected` : 'Select teams'}
            </span>
            <ChevronRight className={cn('h-3 w-3 transition-transform', teamsOpen && 'rotate-90')} />
          </button>
          {teamsOpen ? (
            <div className="mb-2 max-h-40 overflow-y-auto rounded-md border border-border">
              {allTeams.map((t) => {
                const on = teams.has(t);
                return (
                  <button
                    key={t}
                    onClick={() => toggleTeam(t)}
                    className={cn(
                      'flex w-full items-center justify-between px-2 py-1 text-xs hover:bg-surface',
                      on ? 'text-foreground' : 'text-muted',
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={cn(
                          'inline-flex h-3.5 w-3.5 items-center justify-center rounded border',
                          on ? 'border-foreground bg-foreground text-accent-fg' : 'border-border',
                        )}
                      >
                        {on ? <Check className="h-2.5 w-2.5" /> : null}
                      </span>
                      <span className="font-mono">{t}</span>
                    </span>
                    <span className="font-mono text-[10px] text-muted-2">
                      {teamToKeys.get(t)?.length ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </>
      ) : null}

      <div className="mt-1 flex items-center justify-between">
        {mode === 'edit' && onDelete ? (
          <button onClick={onDelete} className="text-xs text-[#ef4444] hover:opacity-80">
            Delete
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="text-xs text-muted hover:text-foreground">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="inline-flex h-7 items-center rounded-md bg-foreground px-2.5 text-xs font-medium text-accent-fg disabled:opacity-40"
          >
            {mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Crumb({
  label,
  active,
  over,
  onClick,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  label: string;
  active: boolean;
  over: boolean;
  onClick: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'rounded px-1.5 py-0.5 transition-colors',
        over && 'bg-foreground/15 ring-1 ring-foreground/40',
        active ? 'text-foreground' : 'text-muted hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function FolderCard({
  name,
  count,
  subCount,
  over,
  onOpen,
  onDelete,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  name: string;
  count: number;
  subCount: number;
  over: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onOpen}
      title={name}
      className={cn(
        'group flex h-10 cursor-pointer items-center gap-2 rounded-md border bg-surface px-2.5 transition-all',
        over ? 'border-foreground/50 ring-2 ring-foreground/40' : 'border-border hover:border-border-hover',
      )}
    >
      <FolderIcon className="h-4 w-4 shrink-0 text-muted-2 transition-colors group-hover:text-muted" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{name}</span>
      <span className="shrink-0 font-mono text-[10px] text-muted-2">
        {count}
        {subCount ? `·${subCount}f` : ''}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={`Delete folder ${name}`}
        className="shrink-0 rounded p-0.5 text-muted-2 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// Finder-style grouped view (By Team / By Tag): each group is a header with a
// "Show all (N)" toggle and a single clipped row of thumbnails that expands to
// a full wrapping grid.
function GroupedView({
  groups,
  openGroups,
  onToggleGroup,
  onOpenPhoto,
}: {
  groups: PhotoGroup[];
  openGroups: Set<string>;
  onToggleGroup: (key: string) => void;
  onOpenPhoto: (items: MediaItem[], id: string) => void;
}) {
  if (groups.length === 0) {
    return (
      <EmptyState icon={Images} title="Nothing to show" description="No photos match the current filter." />
    );
  }
  return (
    <div className="space-y-6">
      {groups.map((g) => {
        const expanded = openGroups.has(g.key);
        return (
          <div key={g.key}>
            <div className="mb-2 flex items-center justify-between border-b border-border pb-1.5">
              <div className="flex items-center gap-2">
                {g.kind === 'team' ? (
                  <TeamNumber number={g.label} size="md" />
                ) : g.kind === 'tag' && g.tag ? (
                  <span
                    className="inline-flex items-center gap-1.5 text-sm font-medium"
                    style={{ color: g.tag.color }}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: g.tag.color }} />
                    {g.tag.name}
                  </span>
                ) : (
                  <span className="text-sm font-medium text-muted">{g.label}</span>
                )}
                <span className="font-mono text-[10px] text-muted-2">{g.photos.length}</span>
              </div>
              <button
                onClick={() => onToggleGroup(g.key)}
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
                  <RowThumb key={p.id} photo={p} onOpen={() => onOpenPhoto(g.photos, p.id)} />
                ))}
              </div>
            ) : (
              <div className="flex gap-3 overflow-hidden">
                {g.photos.map((p) => (
                  <div key={p.id} className="w-40 shrink-0">
                    <RowThumb photo={p} onOpen={() => onOpenPhoto(g.photos, p.id)} />
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

function RowThumb({ photo, onOpen }: { photo: MediaItem; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="group block w-full text-left">
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
  );
}

function PhotoCard({
  photo,
  teamNumbers,
  tags,
  selected,
  onToggleSelect,
  onOpen,
  onDragStart,
}: {
  photo: MediaItem;
  teamNumbers: string[];
  tags: Tag[];
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={cn(
        'group flex flex-col overflow-hidden rounded-lg border bg-surface transition-colors',
        selected ? 'border-foreground/40 ring-1 ring-foreground/20' : 'border-border hover:border-border-hover',
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[#0d0d0d]">
        <button onClick={onOpen} className="block h-full w-full" aria-label={`Open ${photo.originalFilename ?? 'photo'}`}>
          {photo.thumbnailUrl ? (
            <Image
              src={photo.thumbnailUrl}
              alt={
                teamNumbers.length
                  ? `Teams ${teamNumbers.join(', ')}`
                  : tags.length
                    ? tags.map((t) => t.name).join(', ')
                    : 'Photo with no robot'
              }
              fill
              sizes="(max-width: 768px) 100vw, 33vw"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-2">
              <Images className="h-6 w-6" />
            </div>
          )}
        </button>
        <button
          onClick={onToggleSelect}
          aria-label={selected ? 'Deselect' : 'Select'}
          aria-pressed={selected}
          className={cn(
            'absolute left-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded border transition',
            selected
              ? 'border-foreground bg-foreground text-accent-fg'
              : 'border-white/40 bg-black/40 text-transparent opacity-0 group-hover:opacity-100',
          )}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {teamNumbers.length ? (
            teamNumbers.map((t) => (
              <Link key={t} href={`/team/${t}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                <TeamNumber number={t} size="sm" />
              </Link>
            ))
          ) : (
            <span className="font-mono text-xs text-muted">No robot</span>
          )}
          {tags.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
              style={{ backgroundColor: `${t.color}22`, color: t.color }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.color }} />
              {t.name}
            </span>
          ))}
        </div>
        {photo.originalFilename ? (
          <span
            className="shrink-0 truncate font-mono text-[11px] text-muted-2"
            title={photo.originalFilename}
          >
            {photo.originalFilename}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  type = 'button',
}: {
  icon: typeof FolderPlus;
  label: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs text-muted transition-colors hover:text-foreground"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
