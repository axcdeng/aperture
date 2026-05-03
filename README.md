# VEX Scout

A scouting tool for VEX Robotics teams. Search any team and see every reveal video, robot photo, and CAD render they've posted on Discord and YouTube — aggregated automatically and refreshed on a schedule.

## Repo layout

```
/web        Next.js 15 App Router + Drizzle. The actual site.
/scripts    Standalone Node 20 scripts: Discord scraper, refresher,
            YouTube enricher, backfill. Run by GitHub Actions on cron.
/.github    GitHub Actions workflows (one per script).
SETUP.md    Step-by-step setup guide for first-time deployment.
```

`/web` and `/scripts` are independent — separate `package.json`, separate `node_modules`. The single shared file is the Drizzle schema at `web/lib/db/schema.ts`, which the scripts import via relative path.

## Quick start

See [SETUP.md](./SETUP.md). It assumes zero prior knowledge of Neon, GitHub Actions secrets, or the YouTube API and walks through everything in order.

## Development

```sh
# web app (defaults to USE_SEED_DATA fallback if no DATABASE_URL set)
cd web
npm install
npm run dev

# scripts
cd scripts
npm install
npm run scrape   # needs DATABASE_URL + DISCORD_USER_TOKEN in env
npm run refresh
npm run enrich   # needs DATABASE_URL + YOUTUBE_API_KEY
```

## What's not in this build

Auth, RobotEvents integration, image deduplication beyond DB unique constraints, real-time updates, an admin gate on `/untagged`. All planned for later phases.
