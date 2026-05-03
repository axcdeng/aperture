import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

declare global {
  // Reuse a single pool across hot reloads in dev.

  var __vexscout_pgpool: Pool | undefined;
}

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Either configure your Neon connection string in .env.local or set USE_SEED_DATA=true to use the local seed.',
    );
  }
  if (!global.__vexscout_pgpool) {
    global.__vexscout_pgpool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    });
  }
  return global.__vexscout_pgpool;
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    _db = drizzle(getPool(), { schema });
  }
  return _db;
}

export { schema };
