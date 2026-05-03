import { db, schema } from './db';
import { eq } from 'drizzle-orm';

export type JobType = 'discord_scrape' | 'discord_refresh' | 'youtube_enrich' | 'backfill';

export interface SyncLogger {
  finish(opts: { itemsAdded?: number; itemsRefreshed?: number; errors?: number; notes?: string }): Promise<void>;
}

export async function startSyncLog(jobType: JobType, notes?: string): Promise<SyncLogger> {
  const [row] = await db
    .insert(schema.syncLog)
    .values({
      jobType,
      startedAt: new Date(),
      itemsAdded: 0,
      itemsRefreshed: 0,
      errors: 0,
      notes,
    })
    .returning({ id: schema.syncLog.id });
  const id = row.id;
  return {
    async finish(opts) {
      await db
        .update(schema.syncLog)
        .set({
          finishedAt: new Date(),
          itemsAdded: opts.itemsAdded ?? 0,
          itemsRefreshed: opts.itemsRefreshed ?? 0,
          errors: opts.errors ?? 0,
          notes: opts.notes,
        })
        .where(eq(schema.syncLog.id, id));
    },
  };
}
