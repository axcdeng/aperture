import type { Config } from 'drizzle-kit';
import { config } from 'dotenv';

// Next.js convention is .env.local for local-only secrets; load that first
// (with override) and then fall back to .env if present.
config({ path: '.env.local', override: true });
config();

export default {
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
} satisfies Config;
