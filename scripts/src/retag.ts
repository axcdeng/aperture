// One-off cleanup: re-run the (new, stricter) self-posted team extractor
// against every existing self-posted media row, using the stored
// author_display_name as the nickname source. Untag rows whose stored team
// number no longer matches the new extraction. Drop any teams that end up
// with zero media after the retag.
//
// Run with:  npm run retag

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema, pool } from './lib/db';
import { extractTeams } from './lib/team-extraction';

const SELF_POSTED_CHANNELS = ['vex-cad-robots', 'vex-cad-renders', 'robolytics-robots'];

async function main() {
  const rows = await db
    .select({
      id: schema.media.id,
      teamNumber: schema.media.teamNumber,
      authorDisplayName: schema.media.authorDisplayName,
      sourceChannel: schema.media.sourceChannel,
    })
    .from(schema.media)
    .where(
      and(
        inArray(schema.media.sourceChannel, SELF_POSTED_CHANNELS),
        isNull(schema.media.deletedAt),
      ),
    );

  console.log(`[retag] ${rows.length} self-posted rows to re-evaluate`);

  let untagged = 0;
  let retagged = 0;
  let unchanged = 0;

  for (const r of rows) {
    if (!r.teamNumber) {
      unchanged++;
      continue;
    }
    const teams = extractTeams({
      channelType: 'self-posted',
      posterNickname: r.authorDisplayName ?? undefined,
    });

    if (teams.length === 0) {
      // Untag — author display name no longer yields any team.
      await db
        .update(schema.media)
        .set({ teamNumber: null, multiTeamGroupId: null })
        .where(eq(schema.media.id, r.id));
      untagged++;
      continue;
    }

    if (teams.includes(r.teamNumber)) {
      unchanged++;
      continue;
    }

    // Stored team isn't in the new extraction set. Untag.
    // (We don't auto-retag to teams[0] because the row may have been a
    // multi-team reveal; safer to leave it for manual review.)
    await db
      .update(schema.media)
      .set({ teamNumber: null, multiTeamGroupId: null })
      .where(eq(schema.media.id, r.id));
    retagged++;
  }

  // Drop teams with zero remaining media.
  const orphaned = await db.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (await import('drizzle-orm')).sql`
      delete from teams
      where team_number not in (select distinct team_number from media where team_number is not null)
      returning team_number
    ` as never,
  );
  // drizzle's execute returns { rows } for raw queries via node-postgres.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orphanCount = (orphaned as any).rows?.length ?? (orphaned as any).rowCount ?? 0;

  // Resync media_count for surviving teams.
  await db.execute(
    (await import('drizzle-orm')).sql`
      update teams set media_count = (
        select count(*) from media
        where media.team_number = teams.team_number and media.deleted_at is null
      )
    ` as never,
  );

  console.log(
    `[retag] DONE. unchanged=${unchanged} untagged=${untagged} stale-retagged=${retagged} orphaned-teams=${orphanCount}`,
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error('[retag] error:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
