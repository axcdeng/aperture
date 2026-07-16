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
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null; // null = top level
}

export interface OrganizeConfig {
  version: 2;
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
  return { version: 2, tags: [], folders: [], photoTags: {}, folderPhotos: {} };
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

function coerce(parsed: unknown): OrganizeConfig | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Partial<OrganizeConfig>;
  if (!Array.isArray(o.tags) || !Array.isArray(o.folders)) return null;
  return {
    version: 2,
    tags: o.tags.filter((t) => t && typeof t.name === 'string') as Tag[],
    folders: o.folders.filter((f) => f && typeof f.name === 'string') as Folder[],
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
      const tag: Tag = { id: makeId('t'), name: f.name, color: nextColor(cfg) };
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

export function saveOrganize(cfg: OrganizeConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* quota / serialization — non-fatal */
  }
}

// --- tag ops (pure) ---------------------------------------------------------

export function createTag(cfg: OrganizeConfig, name: string, color?: string): OrganizeConfig {
  const n = name.trim();
  if (!n || cfg.tags.some((t) => t.name.toLowerCase() === n.toLowerCase())) return cfg;
  return {
    ...cfg,
    tags: [...cfg.tags, { id: makeId('t'), name: n, color: color ?? nextColor(cfg) }],
  };
}

export function renameTag(cfg: OrganizeConfig, id: string, name: string): OrganizeConfig {
  const n = name.trim();
  if (!n) return cfg;
  return { ...cfg, tags: cfg.tags.map((t) => (t.id === id ? { ...t, name: n } : t)) };
}

export function recolorTag(cfg: OrganizeConfig, id: string, color: string): OrganizeConfig {
  return { ...cfg, tags: cfg.tags.map((t) => (t.id === id ? { ...t, color } : t)) };
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
): OrganizeConfig {
  const n = name.trim();
  if (!n) return cfg;
  return { ...cfg, folders: [...cfg.folders, { id: makeId('f'), name: n, parentId }] };
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

export function childFolders(cfg: OrganizeConfig, parentId: string | null): Folder[] {
  return cfg.folders
    .filter((f) => f.parentId === parentId)
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
    let folder = next.folders.find((f) => f.parentId === null && f.name === tag.name);
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
