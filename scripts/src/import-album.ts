// Local album importer: ingest a folder of competition photos into the
// `events` + `media` tables and mirror two WebP derivatives (a ~1080px display
// image + a ~480px thumb) to Cloudflare R2.
//
// Unlike the Discord scraper, album photos come from a local directory the
// operator points us at. Team tagging is manual: an optional `tags.txt` maps
// each filename to the team(s) shown in the photo (a photo can reveal several
// teams → one media row per team, sharing a multi_team_group_id, exactly like
// a Discord multi-team reveal).
//
// Idempotent by design: re-running the same import (same event slug + files)
// diffs the desired team set against existing rows per (event, filename) and
// only inserts/resurrects/updates/soft-deletes as needed. R2 keys carry a
// content hash, so unchanged bytes skip re-upload (HeadObject probe).
//
// Usage:
//   npm run import-album -- --event "China Regional 2025" --dir ./album \
//     [--date 2025-03-15] [--location "Shenzhen"] [--tags ./tags.txt] [--dry-run]
//
// Reads DATABASE_URL + R2_* from scripts/.env (via ./lib/db → dotenv).

import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { db, schema, pool } from './lib/db';
import { seasonForDate } from './lib/seasons';
import { startSyncLog } from './lib/sync-log';
import {
  albumFullKey,
  albumThumbKey,
  objectExists,
  uploadObject,
} from './lib/r2';

// Derivative sizes. Full = display image; thumb = grid preview. Mirrors the
// r2-mirror job's sharp pipeline (rotate → inside-fit resize → webp).
const MAX_FULL = 1080;
const MAX_THUMB = 480;
const Q_FULL = 80;
const Q_THUMB = 75;
const CONCURRENCY = 4;

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

// --------------------------------------------------------------------------
// tiny flag parser — avoids pulling in a dependency for a handful of flags.
// Supports `--name value`, `--name=value`, and bare boolean `--name`.
// --------------------------------------------------------------------------
function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const body = tok.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      out[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[body] = next;
      i++;
    } else {
      out[body] = true;
    }
  }
  return out;
}

// slugify / sanitize: lowercase, non-alphanumeric → '-', collapse and trim
// dashes. Used both for the event slug and per-file key stems.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

// A tag token is a VEX team number. Accept a 1–5 digit number with an OPTIONAL
// trailing letter (`12345` or `1234A`) — tags may reference bare-number org
// teams, unlike the stricter self-posted extractor. Reject all-zero numerics.
function normalizeTeamToken(raw: string): string | null {
  const tok = raw.trim().toUpperCase();
  if (!/^\d{1,5}[A-Z]?$/.test(tok)) return null;
  const numeric = tok.match(/^\d+/)?.[0] ?? '';
  if (numeric === '' || /^0+$/.test(numeric)) return null;
  return tok;
}

// Parse tags.txt into Map<lowercasedFilename, teams[]>. One line per file:
//   IMG_001.jpg: 1234A, 5678B
// Blank lines and `#` comments are ignored. A present-but-empty right side
// ("IMG_002.jpg:") means "explicitly untagged" → empty array.
function parseTags(content: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon < 0) {
      console.warn(`[import] tags: skipping line without ':' → ${line.slice(0, 80)}`);
      continue;
    }
    const filename = line.slice(0, colon).trim();
    if (!filename) continue;
    const rhs = line.slice(colon + 1);
    const teams: string[] = [];
    for (const part of rhs.split(/[,\s]+/)) {
      if (!part) continue;
      const t = normalizeTeamToken(part);
      if (t && !teams.includes(t)) teams.push(t);
    }
    map.set(filename.toLowerCase(), teams);
  }
  return map;
}

// Parse the JSON manifest produced by the `tagging-album-photos` skill:
//   { "event": "...", "photos": { "IMG_001.jpg": ["1234A","5678B"], "IMG_2.jpg": [] } }
// A bare { file: [teams] } map is also accepted. Team tokens are normalized the
// same way as tags.txt so both sources behave identically.
function parseTagsJson(content: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let obj: unknown;
  try {
    obj = JSON.parse(content);
  } catch (e) {
    throw new Error(`tags.json is not valid JSON: ${(e as Error).message}`);
  }
  const photos =
    obj && typeof obj === 'object' && 'photos' in (obj as Record<string, unknown>)
      ? (obj as Record<string, unknown>).photos
      : obj;
  if (!photos || typeof photos !== 'object') return map;
  for (const [file, teamsRaw] of Object.entries(photos as Record<string, unknown>)) {
    const teams: string[] = [];
    if (Array.isArray(teamsRaw)) {
      for (const t of teamsRaw) {
        const n = normalizeTeamToken(String(t));
        if (n && !teams.includes(n)) teams.push(n);
      }
    }
    map.set(file.toLowerCase(), teams);
  }
  return map;
}

// EXIF-oriented display dimensions of the full derivative, computed from
// metadata so we don't have to re-encode when the R2 object already exists.
async function fullDims(input: Buffer): Promise<{ width: number | null; height: number | null }> {
  const meta = await sharp(input).metadata();
  let w = meta.width ?? null;
  let h = meta.height ?? null;
  // Orientations 5–8 rotate 90°, swapping the stored width/height for display.
  if (meta.orientation && meta.orientation >= 5 && w && h) [w, h] = [h, w];
  if (w && h) {
    const scale = Math.min(1, MAX_FULL / Math.max(w, h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  return { width: w, height: h };
}

// Team upsert copied from lib/scrape-channel.ts — insert the team row FIRST so
// the media foreign key never references a nonexistent team_number. The count
// bump here is approximate; teams.media_count is recomputed exactly post-run.
async function touchTeam(teamNumber: string, postedAt: string): Promise<void> {
  const postedDate = new Date(postedAt);
  await db
    .insert(schema.teams)
    .values({ teamNumber, firstSeenAt: postedDate, lastSeenAt: postedDate, mediaCount: 1 })
    .onConflictDoUpdate({
      target: schema.teams.teamNumber,
      set: {
        lastSeenAt: sql`greatest(${schema.teams.lastSeenAt}, ${postedDate})`,
        mediaCount: sql`${schema.teams.mediaCount} + 1`,
      },
    });
}

// Simple bounded worker pool: run `worker` over `items`, at most `limit` in
// flight. Each worker is responsible for its own try/catch.
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

interface Stats {
  inserted: number;
  resurrected: number;
  updated: number;
  softDeleted: number;
  errors: number;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args['dry-run'] === true;
  const eventName = typeof args.event === 'string' ? args.event : '';
  const dir = typeof args.dir === 'string' ? args.dir : '';
  const dateArg = typeof args.date === 'string' ? args.date : undefined;
  const location = typeof args.location === 'string' ? args.location : null;
  const tagsArg = typeof args.tags === 'string' ? args.tags : undefined;
  const sourceUrl = typeof args['source-url'] === 'string' ? args['source-url'] : null;

  if (!eventName || !dir) {
    console.error(
      'Usage: npm run import-album -- --event "Name" --dir ./album [--date YYYY-MM-DD] [--location "..."] [--tags ./tags.txt] [--source-url URL] [--dry-run]',
    );
    await pool.end().catch(() => {});
    process.exit(2);
  }

  // Fail fast on missing R2 config (same guard as r2-mirror.ts). Skipped in
  // dry-run since we never touch R2 there.
  if (!dryRun) {
    const missing = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].filter(
      (name) => !process.env[name],
    );
    if (missing.length > 0) {
      console.error(`[import] missing required env: ${missing.join(', ')}`);
      await pool.end().catch(() => {});
      process.exit(2);
    }
  }

  // HEIC decoding needs a libvips built with libheif; warn (don't abort) if
  // this sharp can't read it — those files will error individually below.
  if (!sharp.format.heif?.input?.buffer) {
    console.warn(
      '[import] WARNING: this sharp build cannot decode HEIC/HEIF input; .heic/.heif files will fail to import.',
    );
  }

  const eventDate = dateArg ? new Date(dateArg) : null;
  if (eventDate && isNaN(eventDate.getTime())) {
    console.error(`[import] invalid --date: ${dateArg}`);
    await pool.end().catch(() => {});
    process.exit(2);
  }
  const slug = slugify(eventName);

  // ---- resolve the event id --------------------------------------------
  let eventId: string;
  let coverFilename: string | null = null;
  if (dryRun) {
    eventId = 'DRYRUN';
    console.log(`[import] (dry-run) event "${eventName}" slug=${slug}${sourceUrl ? ` source=${sourceUrl}` : ''}`);
  } else {
    // Preserve an existing source_url on re-import unless a new one is passed —
    // so re-running without --source-url never blanks it.
    const eventUpdate: Partial<typeof schema.events.$inferInsert> = {
      name: eventName,
      date: eventDate,
      location,
    };
    if (sourceUrl) eventUpdate.sourceUrl = sourceUrl;
    await db
      .insert(schema.events)
      .values({ id: nanoid(12), name: eventName, slug, date: eventDate, location, sourceUrl })
      .onConflictDoUpdate({
        target: schema.events.slug,
        set: eventUpdate,
      });
    const [row] = await db
      .select({ id: schema.events.id, cover: schema.events.coverOriginalFilename })
      .from(schema.events)
      .where(eq(schema.events.slug, slug))
      .limit(1);
    if (!row) {
      console.error('[import] failed to resolve event row after upsert');
      await pool.end().catch(() => {});
      process.exit(1);
    }
    eventId = row.id;
    coverFilename = row.cover ?? null;
    console.log(`[import] event id=${eventId} slug=${slug}`);
  }

  // ---- enumerate image files (non-recursive) ---------------------------
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort();
  const diskSet = new Set(files.map((f) => f.toLowerCase()));

  if (files.length === 0) {
    console.warn(`[import] no image files found in ${dir}`);
  }

  // ---- load tags -------------------------------------------------------
  // Prefer the JSON manifest from the tagging-album-photos skill. When --dir
  // points at `<Event>/[Raw]`, the manifest is its sibling `<Event>/Sorted/
  // tags.json`. tags.txt (legacy plain-text) is still accepted as a fallback.
  let tagMap = new Map<string, string[]>();
  const tagCandidates = tagsArg
    ? [tagsArg]
    : [
        path.join(dir, 'tags.json'),
        path.join(dir, '..', 'Sorted', 'tags.json'),
        path.join(dir, 'tags.txt'),
      ];
  const tagsPath = tagCandidates.find((p) => existsSync(p));
  if (tagsPath) {
    const content = await readFile(tagsPath, 'utf8');
    tagMap = tagsPath.toLowerCase().endsWith('.json')
      ? parseTagsJson(content)
      : parseTags(content);
    console.log(`[import] loaded ${tagMap.size} tag entr${tagMap.size === 1 ? 'y' : 'ies'} from ${tagsPath}`);
    // Warn about tag entries whose file isn't present on disk.
    for (const key of tagMap.keys()) {
      if (!diskSet.has(key)) console.warn(`[import] tags: no file on disk for "${key}"`);
    }
  }

  // First tagged (non-empty team list) photo, for the event cover default.
  const firstTagged = files.find((f) => (tagMap.get(f.toLowerCase()) ?? []).length > 0) ?? null;

  const stats: Stats = { inserted: 0, resurrected: 0, updated: 0, softDeleted: 0, errors: 0 };
  const touchedTeams = new Set<string>();

  const log = await startSyncLog('album_import', `event=${slug} dir=${dir}${dryRun ? ' dry-run' : ''}`);

  await runPool(files, CONCURRENCY, async (filename) => {
    try {
      const fullPath = path.join(dir, filename);
      const bytes = await readFile(fullPath);
      const shortHash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
      const stem = path.basename(filename, path.extname(filename));
      const keySlug = `${slugify(stem)}-${shortHash}`;
      const fullKey = albumFullKey(eventId, keySlug);
      const thumbKey = albumThumbKey(eventId, keySlug);

      // Desired teams for this file. Absent from map → untagged ([]).
      const desiredTeams = tagMap.get(filename.toLowerCase()) ?? [];
      const realTeams = desiredTeams.slice(); // all entries are non-null team strings
      // desired list used for the diff: [null] represents the untagged row.
      const desired: (string | null)[] = realTeams.length ? realTeams : [null];
      const groupId = realTeams.length > 1 ? nanoid(12) : null;

      // postedAt: event date if provided, else the file's mtime. (No EXIF
      // capture-time parsing — that would need an extra dependency; mtime is a
      // good-enough fallback and the event date is usually supplied anyway.)
      let postedAt: Date;
      if (eventDate) {
        postedAt = eventDate;
      } else {
        const st = await stat(fullPath);
        postedAt = st.mtime;
      }
      const seasonId = seasonForDate(postedAt.toISOString());

      if (dryRun) {
        console.log(
          `[import] (dry-run) ${filename} teams=[${realTeams.join(', ')}] → would insert ${desired.length} row(s)`,
        );
        for (const t of realTeams) touchedTeams.add(t);
        stats.inserted += desired.length;
        return;
      }

      // ---- encode + upload derivatives (skip if key already exists) ----
      let width: number | null = null;
      let height: number | null = null;

      if (!(await objectExists(fullKey))) {
        const { data, info } = await sharp(bytes)
          .rotate() // honor EXIF orientation before stripping metadata
          .resize({ width: MAX_FULL, height: MAX_FULL, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: Q_FULL })
          .toBuffer({ resolveWithObject: true });
        await uploadObject(fullKey, data, 'image/webp');
        width = info.width;
        height = info.height;
      }
      if (!(await objectExists(thumbKey))) {
        const thumb = await sharp(bytes)
          .rotate()
          .resize({ width: MAX_THUMB, height: MAX_THUMB, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: Q_THUMB })
          .toBuffer();
        await uploadObject(thumbKey, thumb, 'image/webp');
      }
      // If we skipped the full re-encode, derive display dims from metadata.
      if (width === null || height === null) {
        const dims = await fullDims(bytes);
        width = dims.width;
        height = dims.height;
      }

      // Upsert team rows FIRST so media FKs are always valid.
      for (const t of realTeams) {
        await touchTeam(t, postedAt.toISOString());
        touchedTeams.add(t);
      }

      // ---- idempotent tag diff for (eventId, filename) -----------------
      const existing = await db
        .select({
          id: schema.media.id,
          teamNumber: schema.media.teamNumber,
          deletedAt: schema.media.deletedAt,
        })
        .from(schema.media)
        .where(and(eq(schema.media.eventId, eventId), eq(schema.media.originalFilename, filename)));

      const matchedIds = new Set<string>();
      const findRow = (team: string | null) =>
        existing.find((r) => (team === null ? r.teamNumber === null : r.teamNumber === team));

      for (const team of desired) {
        const row = findRow(team);
        if (row) {
          matchedIds.add(row.id);
          // Resurrect a soft-deleted row or refresh a live one — same field
          // set either way (idempotent). deletedAt=null covers the resurrect.
          await db
            .update(schema.media)
            .set({
              deletedAt: null,
              r2Key: thumbKey,
              r2FullKey: fullKey,
              width,
              height,
              seasonId,
              postedAt,
              multiTeamGroupId: groupId,
            })
            .where(eq(schema.media.id, row.id));
          if (row.deletedAt) stats.resurrected++;
          else stats.updated++;
        } else {
          await db.insert(schema.media).values({
            id: nanoid(16),
            eventId,
            teamNumber: team,
            seasonId,
            source: 'album',
            sourceChannel: null,
            contentType: 'image',
            postedAt,
            originalFilename: filename,
            r2Key: thumbKey,
            r2FullKey: fullKey,
            width,
            height,
            multiTeamGroupId: groupId,
            deletedAt: null,
          });
          stats.inserted++;
        }
      }

      // Soft-delete any live existing row whose team is no longer desired.
      for (const row of existing) {
        if (matchedIds.has(row.id) || row.deletedAt) continue;
        await db.update(schema.media).set({ deletedAt: new Date() }).where(eq(schema.media.id, row.id));
        stats.softDeleted++;
        if (row.teamNumber) touchedTeams.add(row.teamNumber);
      }
    } catch (e) {
      stats.errors++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[import] error ${filename}: ${msg}`);
    }
  });

  // ---- post-run: recompute teams.media_count for touched teams ---------
  // (mirrors retag.ts — count live media rows per team.)
  if (!dryRun) {
    for (const team of touchedTeams) {
      await db
        .update(schema.teams)
        .set({
          mediaCount: sql`(select count(*) from ${schema.media} where ${schema.media.teamNumber} = ${team} and ${schema.media.deletedAt} is null)`,
        })
        .where(eq(schema.teams.teamNumber, team));
    }

    // Set the event cover to the first tagged photo if not already chosen.
    if (!coverFilename && firstTagged) {
      await db
        .update(schema.events)
        .set({ coverOriginalFilename: firstTagged })
        .where(eq(schema.events.id, eventId));
      console.log(`[import] set event cover → ${firstTagged}`);
    }
  } else if (!coverFilename && firstTagged) {
    console.log(`[import] (dry-run) would set event cover → ${firstTagged}`);
  }

  const notes =
    `event=${slug} files=${files.length} inserted=${stats.inserted} resurrected=${stats.resurrected} ` +
    `updated=${stats.updated} softDeleted=${stats.softDeleted} errors=${stats.errors} teams=${touchedTeams.size}${dryRun ? ' (dry-run)' : ''}`;
  await log.finish({ itemsAdded: stats.inserted, errors: stats.errors, notes: notes.slice(0, 1000) });

  console.log(`[import] DONE ${notes}`);
  await pool.end();
  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[import] fatal:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
