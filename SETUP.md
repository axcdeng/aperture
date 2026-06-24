# Aperture — Setup Guide

This walks you through standing up Aperture from scratch. Every external service signup, every key, every config step. Assume zero prior knowledge of any of these tools — just follow the steps in order.

You'll set up:

1. A Postgres database on Neon (free tier).
2. A YouTube Data API key from Google Cloud (free tier).
3. A throwaway Discord account + user token (only used by the scraper).
4. A GitHub repo + GitHub Actions secrets (free for public repos).
5. A Vercel project for the web frontend (free tier).

End state: scrapers run on cron in GitHub Actions, write to Neon, the Vercel site reads from Neon.

Total time: about 45–75 minutes if all goes smoothly.

---

## 1. Prerequisites

You need installed locally:

- **Node.js 20 or newer.** Check with `node -v`. If you need to install/upgrade, use [nvm](https://github.com/nvm-sh/nvm) (`nvm install 20`) or download from [nodejs.org](https://nodejs.org).
- **git.** Check with `git --version`. Comes preinstalled on macOS/Linux; on Windows, install [Git for Windows](https://git-scm.com/download/win).
- A **GitHub account** ([github.com/signup](https://github.com/signup)).

Strongly recommended:

- A **throwaway Discord account.** The scraper uses a personal Discord token, which technically violates Discord ToS for "selfbot" behavior. Using a throwaway account isolates the risk — if it gets flagged, your real account is unaffected. Create one at [discord.com](https://discord.com) using a fresh email.

> ⚠️ **About Discord user tokens:** They expire when you log out, change password, or rotate sessions. If your scraper suddenly returns 401 errors, you'll need to grab a new token (step 5 below).

---

## 2. Clone and install

```sh
git clone <your-fork-url> mediascout
cd mediascout

# Install web app dependencies
cd web
npm install
cd ..

# Install scripts dependencies
cd scripts
npm install
cd ..
```

You should now have two separate `node_modules/` directories — one in `web/`, one in `scripts/`. That's expected.

**Verify:**

```sh
cd web && npm run build && cd ..
```

The web build should finish with a list of routes. If it fails, stop here and fix Node version / dependencies before continuing.

---

## 3. Set up Neon (Postgres database)

**What it is:** Neon is a managed Postgres host with a generous free tier (3 GB storage, autoscale, branching). Aperture stores teams + media here.

**Steps:**

1. Go to [console.neon.tech](https://console.neon.tech) and sign up (you can sign in with GitHub).
2. Click **Create Project**.
   - Project name: `aperture` (anything works).
   - Postgres version: leave the default.
   - Region: pick the closest to where your users are. For most users, choose the same region you'll deploy Vercel to (US East works for most of North America).
3. After it's created, the dashboard shows a **Connection Details** card.
4. Pick the **Pooled connection** (recommended for serverless apps like Next.js).
5. Copy the connection string. It looks like:

   ```
   postgresql://USER:PASSWORD@ep-xxxx-pooler.neon.tech/neondb?sslmode=require
   ```

6. Save it somewhere safe (a password manager, or a `notes.txt` file you'll delete later). This is your `DATABASE_URL`.

**Verify:** You should see your project listed in the Neon dashboard, with one branch called `main` and one role (default `neondb_owner`).

---

## 4. Set up YouTube Data API

**What it is:** Google's API that returns metadata for any YouTube video given its ID. The enricher uses this to fill in titles, channel names, durations, and thumbnails for YouTube links found in Discord. Free tier is 10,000 quota units/day — you'll never hit it (each batch lookup of up to 50 videos costs 1 unit).

**Steps:**

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. If you've never used it, accept the terms.
3. Click the **project picker** at the top → **New Project**.
   - Name: `aperture`.
   - Leave organization blank if there's no option, or pick **No organization**.
   - Click **Create**. Wait ~10 seconds.
4. Make sure the new project is selected (project picker should show `aperture`).
5. Open the navigation menu → **APIs & Services** → **Library**.
6. Search for **YouTube Data API v3**. Click it. Click **Enable**.
7. Once enabled, go to **APIs & Services** → **Credentials**.
8. Click **+ Create Credentials** → **API key**.
9. A modal pops up with your key. Copy it.
10. Click **Edit API key** (or **Restrict key**).
    - Under **API restrictions**: choose **Restrict key**, then in the dropdown pick **YouTube Data API v3** only.
    - Save.
11. Save the key somewhere safe. This is your `YOUTUBE_API_KEY`.

**Verify:** You should see one credential listed under **Credentials** → **API Keys**, with `YouTube Data API v3` shown under "Restrictions".

---

## 5. Get a Discord user token (throwaway account)

**What it is:** A bearer token tied to a Discord user that authenticates HTTP API calls. The scraper uses it to read messages from public channels.

> ⚠️ **One more time:** Use a throwaway account, not your main account. Discord may flag automated reading of message history as selfbot activity, which can result in account locks.

**Steps:**

1. Open [discord.com](https://discord.com) **in a web browser** (not the desktop app — the desktop app blocks DevTools).
2. Log in with the throwaway account.
3. Make sure you've **joined the three target servers** (the ones that host `vex-reveals`, `vex-cad-robots`, and `robolytics-robots`). Find their invites in the VEX community Discord lists or directly from team contacts.
4. Press `F12` (or right-click → **Inspect**) to open DevTools.
5. Click the **Network** tab.
6. In the filter box, type `/api/`.
7. Click any channel in Discord. The Network tab fills with requests like `GET /api/v9/channels/.../messages`.
8. Click any one of those requests.
9. In the right pane, click **Headers** → scroll to **Request Headers** → find `authorization`.
10. **Copy the value of the `authorization` header.** It does **not** start with `Bot ` — it starts with letters/digits like `MTAxMzM...`. That's your `DISCORD_USER_TOKEN`.
11. Save it somewhere safe.

> If you can't find the `authorization` header: switch off any browser extensions that strip headers, then refresh the page and look again. As a fallback, type `Application` in DevTools' top tab list, then go to **Local Storage** → `https://discord.com` → look for `token` (it'll be wrapped in extra quotes — strip them).

**Verify your token works:** Run this in a terminal (replace `YOUR_TOKEN`):

```sh
curl -s -H "Authorization: YOUR_TOKEN" https://discord.com/api/v10/users/@me | head -c 200
```

You should see your throwaway account's user JSON (`{"id":"...","username":"...",...}`). If you get `{"message": "401: Unauthorized"...}`, your token is wrong.

---

## 6. Get the Discord channel IDs

**What it is:** Every Discord channel has a numeric "snowflake" ID. The scraper config in `scripts/src/lib/channels.ts` needs three of them.

**Steps:**

1. In Discord, click the gear icon (User Settings).
2. Go to **Advanced** → toggle **Developer Mode** ON.
3. Close Settings.
4. Right-click each of the three target channels → **Copy Channel ID**.

   - `vex-reveals`
   - `vex-cad-robots`
   - `robolytics-robots`

5. Open `scripts/src/lib/channels.ts` in your editor.
6. Replace each `<TODO_CHANNEL_ID>` placeholder with the corresponding numeric ID:

   ```ts
   {
     id: '1234567890123456789',  // ← paste here
     name: 'vex-reveals',
     ...
   },
   ```

7. Save the file. Commit + push the change later (step 8).

> The actual server/guild names in the file are descriptive only — the scraper doesn't use them. The channel ID is what matters.

---

## 7. Set up local development

This step verifies the database schema works end-to-end before you push to GitHub.

1. **Copy the env template:**

   ```sh
   cd web
   cp .env.local.example .env.local
   ```

2. **Edit `web/.env.local`:**

   ```
   DATABASE_URL=postgresql://USER:PASSWORD@.../neondb?sslmode=require
   USE_SEED_DATA=false
   ```

   Paste the Neon connection string from step 3.

3. **Push the schema to Neon** (creates all the tables):

   ```sh
   npm run db:push
   ```

   You'll see Drizzle list the tables it's creating. Type `y` if it asks for confirmation. This is safe — the database is empty.

4. **Verify the schema** by opening Drizzle Studio (a built-in DB browser):

   ```sh
   npm run db:studio
   ```

   It opens [https://local.drizzle.studio](https://local.drizzle.studio) in your browser. You should see five empty tables: `teams`, `media`, `scrape_state`, `youtube_enrichment_queue`, `sync_log`. Close it when done (Ctrl-C in the terminal).

5. **Run the dev server:**

   ```sh
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000). The site loads with empty data — every page has an empty state. That's correct: you haven't scraped anything yet.

6. **Try the seed-data fallback** (optional sanity check):

   In `web/.env.local`, temporarily set `USE_SEED_DATA=true`. Restart `npm run dev`. The site now shows ~150 fake media items. Set it back to `false` when done.

> If you ever want to wipe and rebuild the schema, it's safe to drop all tables in Neon and re-run `npm run db:push`. You'll lose data but no scraper state is irreplaceable — just rerun the workflows.

---

## 8. Push to GitHub

1. Go to [github.com/new](https://github.com/new) and create a new repository.
   - Name: `aperture` (anything is fine).
   - Visibility: **Public** is recommended — public repos get **unlimited GitHub Actions minutes** for free. Private repos get 2,000 minutes/month, which is plenty for these workloads but not infinite.
   - **Don't** initialize with a README — you already have one.
2. Push your local repo:

   ```sh
   cd ..   # back to /mediascout root
   git add -A
   git commit -m "Initial backend setup"
   git remote add origin git@github.com:YOUR_USER/aperture.git
   git branch -M main
   git push -u origin main
   ```

3. Visit your repo on github.com and confirm the files are there. The `.github/workflows/` folder should show three YAML files.

> ⚠️ Confirm `.env.local` is **not** in your repo. Run `git ls-files | grep env`. The only result should be `web/.env.local.example`. If `.env.local` is in there, the gitignore wasn't applied — fix that immediately and rotate any leaked secrets.

---

## 9. Configure GitHub Actions secrets

GitHub Actions reads secrets from a per-repo store. The workflows reference them as `${{ secrets.NAME }}`.

1. On your GitHub repo, click **Settings** (top-right of the repo).
2. In the left sidebar: **Secrets and variables** → **Actions**.
3. Click **New repository secret** and add each of these:

| Name                  | Value                                                |
| --------------------- | ---------------------------------------------------- |
| `DATABASE_URL`        | The Neon connection string from step 3               |
| `DISCORD_USER_TOKEN`  | The Discord token from step 5                        |
| `YOUTUBE_API_KEY`     | The Google Cloud API key from step 4                 |

4. Save each one. Once saved you can't view the values again (you can only overwrite them) — that's normal.

**Verify:** The Secrets page should now list three repository secrets.

> Add four more R2 secrets (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`) here too — see step 9b — if you want durable image thumbnails.

---

## 9b. (Optional, recommended) Set up Cloudflare R2 for durable thumbnails

Discord CDN URLs are signed and expire (~24h), and vanish entirely if a message is deleted. The `r2-mirror` workflow makes a durable 720p WebP copy of every Discord image in **Cloudflare R2** — a free object store (10 GB + zero egress) — and the site serves images straight from there. At ~30k images growing ~15k/year, this stays well inside the free tier for years.

1. Sign up at [cloudflare.com](https://dash.cloudflare.com) → in the left sidebar pick **R2**. (R2 requires adding a payment method even on the free tier; you won't be charged within the free limits.)
2. **Create bucket** → give it a name (e.g. `mediascout-thumbs`). That name is your `R2_BUCKET`.
3. Note your **Account ID** (shown on the R2 overview page / account home). That's `R2_ACCOUNT_ID`.
4. **Manage R2 API Tokens** → **Create API token** → permission **Object Read & Write**, scoped to the bucket. Copy the **Access Key ID** (`R2_ACCESS_KEY_ID`) and **Secret Access Key** (`R2_SECRET_ACCESS_KEY`) — the secret is shown only once.
5. **Enable public read access** so the website can load images:
   - **Recommended:** bucket → **Settings** → **Custom Domains** → connect a subdomain you control (e.g. `media.yourdomain.com`). It's served behind Cloudflare's CDN. That URL is your `R2_PUBLIC_BASE_URL`.
   - **Quick start:** bucket → **Settings** → **Public Development URL** → enable. Cloudflare gives you a `https://pub-xxxx.r2.dev` URL — use that as `R2_PUBLIC_BASE_URL`.
6. Add the four upload secrets to **GitHub Actions** (Settings → Secrets and variables → Actions): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
7. Add `R2_PUBLIC_BASE_URL` (no trailing slash) to **Vercel** env vars (step 13) so the site reads from R2. It must be present at build time.

Then run the mirror: **Actions** → **r2-mirror** → **Run workflow**. For the initial 30k-image backlog, set **max_runtime_minutes** to `340` to drain as much as possible per run, and re-run until the logs report `stop=done`. After that, the every-2-hour cron keeps newly-scraped images mirrored automatically.

> If you skip this step entirely, the site still works — it falls back to the on-demand `/api/img` proxy that re-signs Discord URLs live (the previous behavior).

---

## 10. Run your first Discord scrape

1. On GitHub, click the **Actions** tab.
2. If prompted, click **I understand my workflows, go ahead and enable them**.
3. In the left sidebar pick **discord-scrape**.
4. Click **Run workflow** (top-right of the job list) → **Run workflow** (in the popup, leave the input blank).
5. Wait ~30 seconds for it to start, then watch it run. Click into the run and follow the logs in real-time.

Expected output (in the `Routine scrape` step):

```
[scrape] channel=vex-reveals type=admin-reposted-youtube dir=forward cursor=null
[scrape] DONE. items_added=312 youtube_queued=87 errors=0
```

The first run takes longer (up to a few minutes) because it processes up to 5,000 messages with no cursor. Subsequent runs are fast.

**Check Neon:** Open Drizzle Studio (`cd web && npm run db:studio`) or the Neon SQL editor. You should now see:

- Rows in `media` (Discord attachments).
- Rows in `youtube_enrichment_queue` (links to enrich).
- One row per channel in `scrape_state`.
- One row in `sync_log` for the run.

**If the run fails:** click the failing step and read the log. Common causes:

| Error                                       | Cause                                                                  | Fix                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `401 Unauthorized` on Discord               | Token expired or revoked                                               | Regrab the token (step 5) and update the secret                                      |
| `403 Forbidden` on Discord                  | Throwaway account isn't in the server, or doesn't have channel access | Join the server with the throwaway and verify you can see the channel manually       |
| `429 Too Many Requests`                     | Hit Discord's per-route rate limit                                     | Will resolve on the next scheduled run. The scraper backs off and saves its progress |
| `<TODO_CHANNEL_ID> placeholders`            | Forgot to replace the placeholder IDs                                  | Edit `scripts/src/lib/channels.ts`, push, re-run                                     |
| `DATABASE_URL is not set`                   | Missing or misnamed secret                                             | Re-add the GitHub secret                                                             |

---

## 11. Run YouTube enrichment

The Discord scraper queues YouTube video IDs but doesn't fetch their metadata. The enricher does that.

1. **Actions** → **youtube-enrich** → **Run workflow** → **Run workflow**.
2. It picks up to 200 queued IDs and looks them up in batches of 50.
3. Logs end with: `[enrich] DONE. added=183 skipped=4 errors=0`
4. In Drizzle Studio you should now see new rows in `media` with `source = 'youtube'`.

**Quota note:** Each batch of up to 50 videos = 1 quota unit. You have 10,000/day. Even at full capacity (200 queue items per run, every 2 hours), that's ~50 calls/day = 50 quota units. Effectively unlimited.

---

## 12. Backfill historical data

The routine scrape (`*/30 * * * *`) only catches NEW messages from "now" forward. To grab everything that was posted before you turned on the scrapers, run a manual backfill.

1. Find a Discord message ID from "long enough ago" — e.g. a reveal post from 2 seasons back. (Right-click the message → **Copy Message ID**. Developer Mode must be on, see step 6.)
2. **Actions** → **discord-scrape** → **Run workflow**.
3. In the **backfill_before_message_id** input, paste the snowflake.
4. Run it. The workflow takes the backfill branch (calls `npm run backfill` instead of `npm run scrape`). Each run paginates *backwards* up to 5,000 messages.
5. The logs end with the oldest message ID seen. Take that, paste it into the same input, and run again. Repeat until you've covered the history you want.

> Backfill **never** moves the routine forward cursor. The two pagination directions are independent and idempotent — safe to run while normal scrapes continue.

---

## 13. Deploy the web app to Vercel

1. Go to [vercel.com](https://vercel.com) and sign up (you can sign in with GitHub).
2. **Add New** → **Project**.
3. Pick your `aperture` repo.
4. **Configure Project:**
   - **Framework preset:** Next.js (auto-detected).
   - **Root Directory:** click **Edit** → set to `web`. **This is the most important field.** If it's left at the repo root, the build will fail.
   - **Build / Install / Output commands:** leave defaults.
5. **Environment Variables** — click **Add**:

   | Name                  | Value                                                  |
   | --------------------- | ------------------------------------------------------ |
   | `DATABASE_URL`        | The Neon connection string                             |
   | `R2_PUBLIC_BASE_URL`  | (Optional) R2 public base URL from step 9b, no trailing slash |

   You can add `USE_SEED_DATA=true` here if you want the deployed site to serve the seed instead of the DB. Default off.

   > `R2_PUBLIC_BASE_URL` must be set **before** the build — `next.config` reads it to allowlist the image host. If you add it later, trigger a redeploy.

6. Click **Deploy**.
7. Wait ~2 minutes. Click the resulting URL.

The site loads, populated with whatever has been scraped so far.

> If you re-push code, Vercel auto-rebuilds. No further action needed.

---

## 14. Verify automation

The workflows now run on cron:

| Workflow         | Schedule                  | Effect                                                                |
| ---------------- | ------------------------- | --------------------------------------------------------------------- |
| discord-scrape   | every 30 min              | Adds new messages to `media` and `youtube_enrichment_queue`           |
| discord-refresh  | every 6 hours             | Re-signs Discord CDN URLs that expire in <12h                         |
| youtube-enrich   | every 2 hours             | Fetches YouTube metadata + creates rows in `media`                    |
| r2-mirror        | every 2 hours             | Mirrors new Discord images to R2 as durable 720p WebP (if R2 is set up, step 9b) |

Wait until the next cron tick (look at the **Actions** tab — runs appear automatically). The **sync_log** table accumulates one row per run.

```sql
-- Quick sanity check (in Neon's SQL editor or Drizzle Studio):
SELECT job_type, COUNT(*) AS runs, MAX(finished_at) AS last_run
FROM sync_log
GROUP BY job_type
ORDER BY job_type;
```

You should see all three job types showing up over time.

---

## 15. Troubleshooting

**Site shows nothing on a team page.**
The team has zero rows in `media`. Either the scraper hasn't found that team yet, or its number didn't match the regex. Check `media WHERE team_number = '1234A'` in Drizzle Studio.

**Site shows the wrong/empty content for a YouTube embed.**
YouTube's `oembed` is loaded by the browser at view time, not by the API key. If the video says "unavailable" in the iframe, the video itself is private/deleted/region-blocked. The seed-data fake IDs are also expected to fail — that's a known cosmetic limitation of the demo data.

**`/untagged` page is empty but I expect items there.**
The extractor is permissive — almost every Discord message in the configured channels gets tagged via the org-fallback regex. Items only land here if the regex finds nothing in any field. That's by design.

**Workflow run says "skipping channels: vex-reveals, ...".**
You haven't replaced `<TODO_CHANNEL_ID>` for those channels. Edit `scripts/src/lib/channels.ts`, push, re-run.

**`429 Too Many Requests` on Discord.**
Discord rate-limited the throwaway account. The scraper saves its cursor and bails out for this run. The next scheduled run picks up where it left off. If it happens consistently, lower the per-run cap by editing `scripts/src/lib/scrape-channel.ts` (`DEFAULT_CAP`).

**`401 Unauthorized` on Discord (any workflow).**
Token revoked. Regrab from the browser (step 5), update the GitHub secret, re-run.

**`DATABASE_URL is not set` even though I added it.**
Either you added it under **Environment**/Codespaces secrets instead of **Actions** secrets, or the workflow's `env:` block doesn't reference it. Double-check at Settings → Secrets and variables → **Actions** (not Codespaces, not Dependabot).

**Vercel build fails with "Module not found: drizzle-orm".**
You forgot to set the **Root Directory** to `web`. Edit it in the project settings and redeploy.

**Vercel build fails with "DATABASE_URL is not set".**
Add the env var in **Project → Settings → Environment Variables** and redeploy.

**My main Discord account got flagged.**
You used your main account instead of a throwaway. Stop, create a fresh throwaway, regrab the token. Discord doesn't share state across accounts so the throwaway starts clean.

**The scraper inserted the same item N times across multiple channels.**
Same Discord message reposted to multiple channels = N media rows by design. Cross-channel duplication is intentional — each channel is its own provenance record. Use the `multi_team_group_id` for true multi-team reveals; cross-channel cousins keep separate rows.

---

## Appendix: Local-only scrape (skip GitHub Actions)

You can run any of the scripts locally for testing.

```sh
cd scripts

# Required env (use a .env file or export inline):
export DATABASE_URL='postgres://...'
export DISCORD_USER_TOKEN='...'
export YOUTUBE_API_KEY='AIza...'

npm run scrape        # one full pass over all configured channels
npm run refresh       # one refresh pass
npm run enrich        # one enrich pass

# Backfill (export first):
export BACKFILL_BEFORE_MESSAGE_ID='<some_snowflake>'
npm run backfill

# Mirror Discord images to Cloudflare R2 as durable 720p WebP (see step 9b).
# Needs the four R2_* vars; uses DISCORD_USER_TOKEN to re-sign stale URLs.
export R2_ACCOUNT_ID='...' R2_ACCESS_KEY_ID='...' R2_SECRET_ACCESS_KEY='...' R2_BUCKET='...'
export MAX_RUNTIME_MINUTES='5'   # cap the run while testing
npm run r2-mirror
```

`scripts/` will read `scripts/.env` if you create one (via the `dotenv` package). Don't commit it — `.env` is gitignored.

---

## Appendix: What's in the database

After a healthy first day:

| Table                       | Rows (typical)        | Notes                                                  |
| --------------------------- | --------------------- | ------------------------------------------------------ |
| `teams`                     | a few hundred         | Auto-discovered from media. No org/region until later. |
| `media`                     | low thousands         | One row per attachment per team (multi-team rows share `multi_team_group_id`). |
| `scrape_state`              | 3                     | One row per configured channel.                        |
| `youtube_enrichment_queue`  | grows then drains      | Discord scraper writes; enricher reads + marks `enriched_at`. |
| `sync_log`                  | grows over time        | Append-only run log. Useful for debugging.             |

---

You're done. The site will keep itself up-to-date as long as the GitHub Actions workflows keep running. Bookmark this file — you'll come back to it when something breaks at 2am.
