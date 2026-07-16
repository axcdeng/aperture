// Server-side album write logic shared by the import API routes.
//
// This mirrors the idempotent diff in scripts/src/import-album.ts, but runs
// inside Next route handlers against the web app's own drizzle client. Team
// membership for a photo is keyed on (event_id, original_filename): a photo
// showing N teams becomes N media rows sharing a multi_team_group_id; an
// untagged photo is one row with team_number = NULL.
//
// Two entry points share one core diff:
//   • importPhoto  — the browser uploaded fresh WebP derivatives (R2 keys are
//     supplied as the row template).
//   • applyTags    — a tags.json entry for a photo whose bytes already live in
//     R2 (uploaded earlier, possibly by someone else). The template is cloned
//     from an existing sibling row; if none exists we can't create rows, so the
//     entry is skipped. This is what lets tags work independently of uploads.

import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from './db/client';
import { seasonForDate } from './seasons';

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

// Accept a 1–5 digit team number with an optional trailing letter (matches the
// local importer). Reject all-zero numerics. Returns the uppercased token or
// null if malformed.
export function normalizeTeamToken(raw: string): string | null {
  const tok = String(raw).trim().toUpperCase();
  if (!/^\d{1,5}[A-Z]?$/.test(tok)) return null;
  const numeric = tok.match(/^\d+/)?.[0] ?? '';
  if (numeric === '' || /^0+$/.test(numeric)) return null;
  return tok;
}

export interface DiffStats {
  inserted: number;
  resurrected: number;
  updated: number;
  softDeleted: number;
  skipped: number;
}

export function emptyStats(): DiffStats {
  return { inserted: 0, resurrected: 0, updated: 0, softDeleted: 0, skipped: 0 };
}

export function addStats(a: DiffStats, b: DiffStats): DiffStats {
  return {
    inserted: a.inserted + b.inserted,
    resurrected: a.resurrected + b.resurrected,
    updated: a.updated + b.updated,
    softDeleted: a.softDeleted + b.softDeleted,
    skipped: a.skipped + b.skipped,
  };
}

type Db = ReturnType<typeof getDb>;

// Row template shared by every team row for one photo.
interface Template {
  r2Key: string; // ~500px thumb
  r2FullKey: string; // ~1080px display
  width: number | null;
  height: number | null;
  seasonId: string;
  postedAt: Date;
}

// Upsert a team row FIRST so media FKs never dangle (count is approximate;
// recomputed exactly by the periodic retag job / other importers).
async function touchTeam(db: Db, teamNumber: string, postedAt: Date): Promise<void> {
  await db
    .insert(schema.teams)
    .values({ teamNumber, firstSeenAt: postedAt, lastSeenAt: postedAt, mediaCount: 1 })
    .onConflictDoUpdate({
      target: schema.teams.teamNumber,
      set: {
        lastSeenAt: sql`greatest(${schema.teams.lastSeenAt}, ${postedAt})`,
        mediaCount: sql`${schema.teams.mediaCount} + 1`,
      },
    });
}

// Core idempotent diff for one (event, filename), scoped to this album only —
// an identical filename in another event is a different photo and is never
// touched. `teams` is the desired set of normalized team tokens ([] = untagged).
//
// Non-destructive by default (`removeMissing = false`): it inserts missing team
// rows, resurrects soft-deleted ones, and refreshes matches, but never removes
// a team the caller didn't mention. This is what makes re-importing safe — a
// photo dropped in again (with fewer/no teams) keeps the tags it already had.
// Removing a tag is not part of import; pass `removeMissing = true` only for an
// explicit authoritative replace.
async function diffPhoto(
  db: Db,
  eventId: string,
  filename: string,
  teams: string[],
  template: Template,
  removeMissing = false,
): Promise<{ stats: DiffStats; touched: Set<string> }> {
  const stats = emptyStats();
  const touched = new Set<string>();

  const realTeams = Array.from(new Set(teams));
  const desired: (string | null)[] = realTeams.length ? realTeams : [null];
  const groupId = realTeams.length > 1 ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : null;

  for (const t of realTeams) {
    await touchTeam(db, t, template.postedAt);
    touched.add(t);
  }

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
      await db
        .update(schema.media)
        .set({
          deletedAt: null,
          r2Key: template.r2Key,
          r2FullKey: template.r2FullKey,
          width: template.width,
          height: template.height,
          seasonId: template.seasonId,
          postedAt: template.postedAt,
          multiTeamGroupId: groupId,
        })
        .where(eq(schema.media.id, row.id));
      if (row.deletedAt) stats.resurrected++;
      else stats.updated++;
    } else {
      await db.insert(schema.media).values({
        id: crypto.randomUUID().replace(/-/g, '').slice(0, 16),
        eventId,
        teamNumber: team,
        seasonId: template.seasonId,
        source: 'album',
        sourceChannel: null,
        contentType: 'image',
        postedAt: template.postedAt,
        originalFilename: filename,
        r2Key: template.r2Key,
        r2FullKey: template.r2FullKey,
        width: template.width,
        height: template.height,
        multiTeamGroupId: groupId,
        deletedAt: null,
      });
      stats.inserted++;
    }
  }

  // Only in authoritative-replace mode: soft-delete live rows whose team is no
  // longer desired. Skipped for imports so tags are never silently dropped.
  if (removeMissing) {
    for (const row of existing) {
      if (matchedIds.has(row.id) || row.deletedAt) continue;
      await db.update(schema.media).set({ deletedAt: new Date() }).where(eq(schema.media.id, row.id));
      stats.softDeleted++;
      if (row.teamNumber) touched.add(row.teamNumber);
    }
  }

  return { stats, touched };
}

/** Upsert (or update) the event row by slug; returns its id. */
export async function resolveOrCreateEvent(input: {
  name: string;
  date?: Date | null;
  location?: string | null;
  note?: string | null;
}): Promise<{ id: string; slug: string }> {
  const db = getDb();
  const slug = slugify(input.name);
  if (!slug) throw new Error('Event name must contain at least one alphanumeric character.');
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  await db
    .insert(schema.events)
    .values({
      id,
      name: input.name,
      slug,
      date: input.date ?? null,
      location: input.location ?? null,
      note: input.note ?? null,
    })
    .onConflictDoUpdate({
      target: schema.events.slug,
      // Only overwrite name; keep existing date/location/note unless creating.
      set: { name: input.name },
    });
  const [row] = await db
    .select({ id: schema.events.id, slug: schema.events.slug })
    .from(schema.events)
    .where(eq(schema.events.slug, slug))
    .limit(1);
  if (!row) throw new Error('Failed to resolve event after upsert.');
  return row;
}

/**
 * Import one just-uploaded photo (R2 keys freshly written). Idempotent and
 * non-destructive: re-importing the same filename updates its row(s) in place
 * and never removes tags, so uploading a photo again — with or without a
 * tags.json — can't wipe tags it already had.
 */
export async function importPhoto(input: {
  eventId: string;
  filename: string;
  teams: string[];
  r2Key: string;
  r2FullKey: string;
  width: number | null;
  height: number | null;
  postedAt: Date;
}): Promise<{ stats: DiffStats; touched: Set<string> }> {
  const db = getDb();
  const template: Template = {
    r2Key: input.r2Key,
    r2FullKey: input.r2FullKey,
    width: input.width,
    height: input.height,
    seasonId: seasonForDate(input.postedAt.toISOString()),
    postedAt: input.postedAt,
  };
  return diffPhoto(db, input.eventId, input.filename, input.teams, template);
}

/**
 * Apply tags to a photo already present in the event (bytes in R2). Clones the
 * R2 keys / dims from an existing sibling row. If no row exists for this
 * filename, the entry is skipped (we can't fabricate R2 objects).
 *
 * Non-destructive: adds/resurrects the manifest's teams but never removes teams
 * absent from it, so overlapping or partial tags.json files can't clobber tags
 * someone else already applied.
 */
export async function applyTags(input: {
  eventId: string;
  filename: string;
  teams: string[];
}): Promise<{ stats: DiffStats; touched: Set<string> }> {
  const db = getDb();
  const [sib] = await db
    .select({
      r2Key: schema.media.r2Key,
      r2FullKey: schema.media.r2FullKey,
      width: schema.media.width,
      height: schema.media.height,
      seasonId: schema.media.seasonId,
      postedAt: schema.media.postedAt,
    })
    .from(schema.media)
    .where(and(eq(schema.media.eventId, input.eventId), eq(schema.media.originalFilename, input.filename)))
    .limit(1);
  if (!sib || !sib.r2FullKey) {
    const stats = emptyStats();
    stats.skipped++;
    return { stats, touched: new Set() };
  }
  const template: Template = {
    r2Key: sib.r2Key ?? sib.r2FullKey,
    r2FullKey: sib.r2FullKey,
    width: sib.width,
    height: sib.height,
    seasonId: sib.seasonId,
    postedAt: sib.postedAt,
  };
  return diffPhoto(db, input.eventId, input.filename, input.teams, template);
}

/** Recompute exact media_count for a set of teams after a batch of writes. */
export async function resyncTeamCounts(teams: Iterable<string>): Promise<void> {
  const db = getDb();
  const list = Array.from(new Set(teams));
  for (const t of list) {
    await db
      .update(schema.teams)
      .set({
        mediaCount: sql`(select count(*) from ${schema.media} where ${schema.media.teamNumber} = ${t} and ${schema.media.deletedAt} is null)`,
      })
      .where(eq(schema.teams.teamNumber, t));
  }
}
