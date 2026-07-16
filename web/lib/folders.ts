// Browser-local organization for album photos: colored TAGS (cross-folder
// labels) + nested FOLDERS (a tree; photos are members, many-to-many so a
// photo can be aliased into several folders without copying bytes).
//
// Everything lives in localStorage — no server, no login. The whole config
// exports to / imports from a JSON file so a setup can be shared.
//
// A photo is referenced by a stable key: `<eventId>/<originalFilename>`.

export interface Tag {
  id: string;
  name: string;
  color: string; // hex
  global: boolean; // true = appears in every album + sidebar + Tags page
  eventId: string | null; // album a non-global tag belongs to (null when global)
  autoAdd: string[]; // team-number match patterns (e.g. "5503" or "5503A")
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null; // null = top level
  tagId?: string; // set => this folder lives inside a global tag (Tags page only)
}

export interface OrganizeConfig {
  version: 3;
  tags: Tag[];
  folders: Folder[];
  photoTags: Record<string, string[]>; // photoKey -> tagId[]
  folderPhotos: Record<string, string[]>; // folderId -> photoKey[]
}

const STORAGE_KEY = 'aperture:albums:organize';
const LEGACY_KEY = 'aperture:albums:folders'; // v1: flat { folders: [{id,name,photoKeys}] }

// Dark-theme-friendly, visually distinct palette. Cycled when auto-assigning.
export const TAG_PALETTE = [
  '#f59e0b', '#3b82f6', '#10b981', '#a855f7', '#ef4444',
  '#14b8a6', '#ec4899', '#eab308', '#6366f1', '#f97316',
];

export function photoKey(
  eventId: string | undefined,
  originalFilename: string | undefined,
): string {
  return `${eventId ?? '?'}/${originalFilename ?? '?'}`;
}

export function emptyConfig(): OrganizeConfig {
  return { version: 3, tags: [], folders: [], photoTags: {}, folderPhotos: {} };
}

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function nextColor(cfg: OrganizeConfig): string {
  return TAG_PALETTE[cfg.tags.length % TAG_PALETTE.length];
}

// --- load / save / migrate --------------------------------------------------

// Also the v2->v3 migration point: a tag with no `global` field is v2 data, so
// mark it global (its old behavior was "shows in every album") to avoid
// anything disappearing.
function coerce(parsed: unknown): OrganizeConfig | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as { tags?: unknown[]; folders?: unknown[]; photoTags?: unknown; folderPhotos?: unknown };
  if (!Array.isArray(o.tags) || !Array.isArray(o.folders)) return null;
  const tags: Tag[] = o.tags
    .filter((t): t is Record<string, unknown> => !!t && typeof (t as Tag).name === 'string')
    .map((t) => ({
      id: typeof t.id === 'string' ? t.id : makeId('t'),
      name: t.name as string,
      color: typeof t.color === 'string' ? t.color : TAG_PALETTE[0],
      global: typeof t.global === 'boolean' ? t.global : true, // v2 tags -> global
      eventId: typeof t.eventId === 'string' ? t.eventId : null,
      autoAdd: Array.isArray(t.autoAdd) ? (t.autoAdd.filter((x) => typeof x === 'string') as string[]) : [],
    }));
  const folders: Folder[] = o.folders
    .filter((f): f is Record<string, unknown> => !!f && typeof (f as Folder).name === 'string')
    .map((f) => ({
      id: typeof f.id === 'string' ? f.id : makeId('f'),
      name: f.name as string,
      parentId: typeof f.parentId === 'string' ? f.parentId : null,
      ...(typeof f.tagId === 'string' ? { tagId: f.tagId } : {}),
    }));
  return {
    version: 3,
    tags,
    folders,
    photoTags: (o.photoTags && typeof o.photoTags === 'object' ? o.photoTags : {}) as Record<
      string,
      string[]
    >,
    folderPhotos: (o.folderPhotos && typeof o.folderPhotos === 'object'
      ? o.folderPhotos
      : {}) as Record<string, string[]>,
  };
}

// v1 stored flat folders. Re-purpose them as TAGS (that was the old top-row
// chip UI), carrying their membership into photoTags.
function migrateV1(raw: string): OrganizeConfig | null {
  try {
    const v1 = JSON.parse(raw) as { folders?: { id?: string; name?: string; photoKeys?: string[] }[] };
    if (!v1 || !Array.isArray(v1.folders)) return null;
    const cfg = emptyConfig();
    for (const f of v1.folders) {
      if (!f || typeof f.name !== 'string') continue;
      const tag: Tag = {
        id: makeId('t'),
        name: f.name,
        color: nextColor(cfg),
        global: true,
        eventId: null,
        autoAdd: [],
      };
      cfg.tags.push(tag);
      for (const key of f.photoKeys ?? []) {
        (cfg.photoTags[key] ??= []).push(tag.id);
      }
    }
    return cfg;
  } catch {
    return null;
  }
}

// Tags are user-created and start empty. Teams are a SEPARATE, data-derived
// facet (from the photo manifest) — never auto-created as tags. A user can
// choose to make a tag named after a team, but that's a manual action.
export function loadOrganize(): OrganizeConfig {
  if (typeof window === 'undefined') return emptyConfig();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = coerce(JSON.parse(raw));
      if (parsed) return parsed;
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = migrateV1(legacy);
      if (migrated) return migrated;
    }
  } catch {
    /* fall through */
  }
  return emptyConfig();
}

export const ORGANIZE_CHANGED_EVENT = 'aperture:organize-changed';

export function saveOrganize(cfg: OrganizeConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    // Let other components in this tab (e.g. the sidebar Tags section) refresh.
    window.dispatchEvent(new CustomEvent(ORGANIZE_CHANGED_EVENT));
  } catch {
    /* quota / serialization — non-fatal */
  }
}

// --- tag ops (pure) ---------------------------------------------------------

export interface TagInput {
  color?: string;
  eventId?: string | null;
  global?: boolean;
  autoAdd?: string[];
}

export function createTag(
  cfg: OrganizeConfig,
  name: string,
  opts: TagInput = {},
): { config: OrganizeConfig; id: string | null } {
  const n = name.trim();
  if (!n) return { config: cfg, id: null };
  const id = makeId('t');
  const global = opts.global ?? false;
  const tag: Tag = {
    id,
    name: n,
    color: opts.color ?? nextColor(cfg),
    global,
    eventId: global ? null : opts.eventId ?? null,
    autoAdd: opts.autoAdd ?? [],
  };
  return { config: { ...cfg, tags: [...cfg.tags, tag] }, id };
}

export function updateTag(
  cfg: OrganizeConfig,
  id: string,
  patch: { name?: string; color?: string; global?: boolean; autoAdd?: string[] },
): OrganizeConfig {
  return {
    ...cfg,
    tags: cfg.tags.map((t) => {
      if (t.id !== id) return t;
      const global = patch.global ?? t.global;
      return {
        ...t,
        name: patch.name?.trim() || t.name,
        color: patch.color ?? t.color,
        global,
        eventId: global ? null : t.eventId,
        autoAdd: patch.autoAdd ?? t.autoAdd,
      };
    }),
  };
}

// Tags visible while viewing album `eventId`: global tags plus tags scoped to
// this album.
export function visibleTags(cfg: OrganizeConfig, eventId: string): Tag[] {
  return cfg.tags.filter((t) => t.global || t.eventId === eventId);
}

export function globalTags(cfg: OrganizeConfig): Tag[] {
  return cfg.tags.filter((t) => t.global);
}

// A bare number ("5503") matches that number plus an optional single letter
// ("5503", "5503A"…"5503Z") but not "55035A". A pattern with a letter ("5503A")
// matches exactly.
export function autoAddMatches(team: string, pattern: string): boolean {
  const p = pattern.trim().toUpperCase();
  const t = team.trim().toUpperCase();
  if (!p) return false;
  if (/^\d+$/.test(p)) return new RegExp(`^${p}[A-Z]?$`).test(t);
  return t === p;
}

// Apply every auto-add tag (that's visible in this album) to the album's
// photos whose team matches. Returns the SAME config when nothing changed, so
// callers can skip a needless save/re-render.
export function applyAutoAdd(
  cfg: OrganizeConfig,
  eventId: string,
  photos: { key: string; teams: string[] }[],
): OrganizeConfig {
  const photoTags = { ...cfg.photoTags };
  let changed = false;
  for (const tag of cfg.tags) {
    if (!tag.autoAdd.length || !(tag.global || tag.eventId === eventId)) continue;
    for (const p of photos) {
      if (!p.teams.some((team) => tag.autoAdd.some((pat) => autoAddMatches(team, pat)))) continue;
      const cur = photoTags[p.key];
      if (cur?.includes(tag.id)) continue;
      photoTags[p.key] = [...(cur ?? []), tag.id];
      changed = true;
    }
  }
  return changed ? { ...cfg, photoTags } : cfg;
}

export function deleteTag(cfg: OrganizeConfig, id: string): OrganizeConfig {
  const photoTags: Record<string, string[]> = {};
  for (const [k, ids] of Object.entries(cfg.photoTags)) {
    const kept = ids.filter((t) => t !== id);
    if (kept.length) photoTags[k] = kept;
  }
  return { ...cfg, tags: cfg.tags.filter((t) => t.id !== id), photoTags };
}

// Add or remove one tag across a set of photos.
export function setTagOnPhotos(
  cfg: OrganizeConfig,
  tagId: string,
  keys: string[],
  on: boolean,
): OrganizeConfig {
  const photoTags = { ...cfg.photoTags };
  for (const key of keys) {
    const cur = new Set(photoTags[key] ?? []);
    if (on) cur.add(tagId);
    else cur.delete(tagId);
    if (cur.size) photoTags[key] = Array.from(cur);
    else delete photoTags[key];
  }
  return { ...cfg, photoTags };
}

export function tagsForPhoto(cfg: OrganizeConfig, key: string): Tag[] {
  const ids = new Set(cfg.photoTags[key] ?? []);
  return cfg.tags.filter((t) => ids.has(t.id));
}

export function photoCountForTag(cfg: OrganizeConfig, tagId: string): number {
  let n = 0;
  for (const ids of Object.values(cfg.photoTags)) if (ids.includes(tagId)) n++;
  return n;
}

// --- folder ops (pure) ------------------------------------------------------

export function createFolder(
  cfg: OrganizeConfig,
  name: string,
  parentId: string | null,
  tagId?: string,
): OrganizeConfig {
  const n = name.trim();
  if (!n) return cfg;
  return {
    ...cfg,
    folders: [...cfg.folders, { id: makeId('f'), name: n, parentId, ...(tagId ? { tagId } : {}) }],
  };
}

export function renameFolder(cfg: OrganizeConfig, id: string, name: string): OrganizeConfig {
  const n = name.trim();
  if (!n) return cfg;
  return { ...cfg, folders: cfg.folders.map((f) => (f.id === id ? { ...f, name: n } : f)) };
}

// Delete a folder: reparent its children to its parent, drop its membership.
export function deleteFolder(cfg: OrganizeConfig, id: string): OrganizeConfig {
  const target = cfg.folders.find((f) => f.id === id);
  if (!target) return cfg;
  const folderPhotos = { ...cfg.folderPhotos };
  delete folderPhotos[id];
  return {
    ...cfg,
    folders: cfg.folders
      .filter((f) => f.id !== id)
      .map((f) => (f.parentId === id ? { ...f, parentId: target.parentId } : f)),
    folderPhotos,
  };
}

function isDescendant(cfg: OrganizeConfig, folderId: string, maybeAncestor: string): boolean {
  let cur = cfg.folders.find((f) => f.id === folderId)?.parentId ?? null;
  while (cur) {
    if (cur === maybeAncestor) return true;
    cur = cfg.folders.find((f) => f.id === cur)?.parentId ?? null;
  }
  return false;
}

export function moveFolder(
  cfg: OrganizeConfig,
  id: string,
  newParentId: string | null,
): OrganizeConfig {
  if (id === newParentId) return cfg;
  // Prevent cycles: can't move a folder into itself or a descendant.
  if (newParentId && (newParentId === id || isDescendant(cfg, newParentId, id))) return cfg;
  return { ...cfg, folders: cfg.folders.map((f) => (f.id === id ? { ...f, parentId: newParentId } : f)) };
}

export function addToFolder(cfg: OrganizeConfig, folderId: string, keys: string[]): OrganizeConfig {
  const cur = new Set(cfg.folderPhotos[folderId] ?? []);
  keys.forEach((k) => cur.add(k));
  return { ...cfg, folderPhotos: { ...cfg.folderPhotos, [folderId]: Array.from(cur) } };
}

export function removeFromFolder(
  cfg: OrganizeConfig,
  folderId: string,
  keys: string[],
): OrganizeConfig {
  const drop = new Set(keys);
  const kept = (cfg.folderPhotos[folderId] ?? []).filter((k) => !drop.has(k));
  const folderPhotos = { ...cfg.folderPhotos };
  if (kept.length) folderPhotos[folderId] = kept;
  else delete folderPhotos[folderId];
  return { ...cfg, folderPhotos };
}

// Children under `parentId` within a scope: tagId=null => album folders (no
// tagId); tagId=<id> => folders belonging to that global tag (Tags page).
export function childFolders(
  cfg: OrganizeConfig,
  parentId: string | null,
  tagId: string | null = null,
): Folder[] {
  return cfg.folders
    .filter((f) => f.parentId === parentId && (f.tagId ?? null) === tagId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function folderPath(cfg: OrganizeConfig, id: string | null): Folder[] {
  const path: Folder[] = [];
  let cur = id;
  while (cur) {
    const f = cfg.folders.find((x) => x.id === cur);
    if (!f) break;
    path.unshift(f);
    cur = f.parentId;
  }
  return path;
}

// One folder per tag (by tag name), containing every photo that carries the
// tag. Photos are added by reference (alias) — a multi-tag photo lands in each
// folder. Re-running merges into same-named folders, so it's idempotent.
export function autoCreateFoldersFromTags(cfg: OrganizeConfig): OrganizeConfig {
  let next = cfg;
  const tagById = new Map(cfg.tags.map((t) => [t.id, t]));
  const keysByTag = new Map<string, string[]>();
  for (const [key, ids] of Object.entries(cfg.photoTags)) {
    for (const id of ids) {
      if (!tagById.has(id)) continue;
      (keysByTag.get(id) ?? keysByTag.set(id, []).get(id)!).push(key);
    }
  }
  for (const tag of cfg.tags) {
    const keys = keysByTag.get(tag.id);
    if (!keys?.length) continue;
    let folder = next.folders.find((f) => f.parentId === null && !f.tagId && f.name === tag.name);
    if (!folder) {
      next = createFolder(next, tag.name, null);
      folder = next.folders[next.folders.length - 1];
    }
    next = addToFolder(next, folder.id, keys);
  }
  return next;
}

// --- export / import --------------------------------------------------------

export function exportConfig(cfg: OrganizeConfig): string {
  return JSON.stringify(cfg, null, 2);
}

export function importConfig(
  cfg: OrganizeConfig,
  raw: string,
  mode: 'merge' | 'replace',
): OrganizeConfig | null {
  let incoming: OrganizeConfig | null;
  try {
    incoming = coerce(JSON.parse(raw)) ?? migrateV1(raw);
  } catch {
    return null;
  }
  if (!incoming) return null;
  if (mode === 'replace') return incoming;
  // Merge: union tags by name, folders by (name, depth) is fuzzy — keep it
  // simple and append incoming folders with fresh ids, union memberships.
  let next: OrganizeConfig = { ...cfg, photoTags: { ...cfg.photoTags }, folderPhotos: { ...cfg.folderPhotos } };
  const tagIdMap = new Map<string, string>();
  for (const t of incoming.tags) {
    const existing = next.tags.find((x) => x.name.toLowerCase() === t.name.toLowerCase());
    if (existing) tagIdMap.set(t.id, existing.id);
    else {
      const id = makeId('t');
      tagIdMap.set(t.id, id);
      next = { ...next, tags: [...next.tags, { ...t, id }] };
    }
  }
  for (const [key, ids] of Object.entries(incoming.photoTags)) {
    const mapped = ids.map((i) => tagIdMap.get(i) ?? i);
    next.photoTags[key] = Array.from(new Set([...(next.photoTags[key] ?? []), ...mapped]));
  }
  const folderIdMap = new Map<string, string>();
  for (const f of incoming.folders) {
    const id = makeId('f');
    folderIdMap.set(f.id, id);
    next = { ...next, folders: [...next.folders, { ...f, id, parentId: null }] };
  }
  // fix parent links within the imported set
  next = {
    ...next,
    folders: next.folders.map((f) => {
      const orig = incoming!.folders.find((o) => folderIdMap.get(o.id) === f.id);
      if (orig?.parentId && folderIdMap.has(orig.parentId)) {
        return { ...f, parentId: folderIdMap.get(orig.parentId)! };
      }
      return f;
    }),
  };
  for (const [fid, keys] of Object.entries(incoming.folderPhotos)) {
    const mapped = folderIdMap.get(fid);
    if (!mapped) continue;
    next.folderPhotos[mapped] = Array.from(new Set([...(next.folderPhotos[mapped] ?? []), ...keys]));
  }
  return next;
}
