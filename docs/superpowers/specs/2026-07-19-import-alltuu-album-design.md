# Design: `import-alltuu-album` skill

**Date:** 2026-07-19
**Status:** Approved (design phase)

## Problem

Competition photos are hosted on alltuu.com / piufoto (mobile web album, e.g.
`https://m.alltuu.com/album/<32-hex-id>/`). There is no public API. Today the
operator manually downloads every photo through the site UI — the site serves
~5.6 MB originals, so a ~500-photo album is slow, and sorting/tagging is a
separate manual step afterward.

Goal: one command — **send an album link + a folder name** — that downloads only
the new photos fast (parallel), skips anything already downloaded, then
classifies via the existing tagging skill, then (after asking) uploads to R2.

## Provider facts (reverse-engineered 2026-07-19)

The album is a Vue SPA. The photo list comes from a signed endpoint:

```
https://v4c.alltuu.com/<sig>/<hextime>/rest/v4c/fplN/a<albumId>/n60/o4/pc/pd/s<offset>/<token>/t<ts>/v1
```

Response: `{ "d": [ <photo>, ... ], "e": 0, "m": "OK" }`. Each `<photo>`:

| field | meaning | example |
|-------|---------|---------|
| `n` | **original filename** (dedup / skip key) | `DS889828.JPG` |
| `sl` | 1600px signed OSS URL (~0.5–1 MB) | `https://uib.alltuu.com/ml/…` |
| `url1920` | 1620×1080 q90 (~0.5 MB) | `https://uip.alltuu.com/…` |
| `ol` | 4000px true original (~5.6 MB) | `https://uio.alltuu.com/…` |
| `os` | size in bytes | `5597341.00` |
| `w`,`h` | dimensions | 4000, 2666 |

**Key constraints, all verified:**
- The `s` offset (and `n` page size) are part of the server signature — changing
  them by hand → HTTP 403. Pagination MUST go through the app. → harvest needs a browser.
- Individual image URLs (`sl`/`ol`/`url1920`) are plain signed OSS links that
  download with `curl` headless (no cookies/referer), HTTP 200. Signature
  `Expires` ≈ 1 month out. → download is fully parallelizable outside the browser.
- The "热门 (hot)" tab returns a curated ~99. The "图片直播 (live feed)" tab is the
  complete chronological set → harvest from the live feed.

**Chosen tier: `sl` (1600px).** `import-album` downscales to 1080px WebP for R2
and the tagging skill downscales to 1280px, so 1600px loses nothing for either
the site or plate-reading, at ~5–10× the speed and ~1/10 the disk of originals.
Matches the existing `Albums/WRCT_Beijing/DS887xxx.JPG` files (~1 MB each).

## Architecture

New orchestrator skill `import-alltuu-album` chaining four phases. It reuses two
existing pieces unchanged: the `tagging-album-photos` skill (classify) and
`npm run import-album` (R2 upload). New code is only the harvest procedure and a
parallel download script.

```
link + folder
   │  Phase 1 (browser)      harvest signed image URLs + album meta
   ▼
Albums/<folder>/.harvest/urls.json  +  meta.json
   │  Phase 2 (headless)     parallel curl, skip existing by filename
   ▼
Albums/<folder>/*.JPG
   │  Phase 3                invoke tagging-album-photos skill
   ▼
Albums/<folder>/Sorted/tags.json
   │  Phase 4 (gated: ask)   npm run import-album
   ▼
R2 (1080px + 480px WebP) + Postgres
```

### Phase 1 — Harvest (browser)

Agent drives the Claude Browser MCP:
1. `preview_start` / `navigate` to the album URL.
2. Click past the intro splash ("进入…" button) if present.
3. Switch to the **图片直播 (live feed)** tab.
4. Inject a `fetch` interceptor that appends every `fplN` response's `d[]` into a
   `window.__HARVEST` map keyed by `n` (dedup).
5. Scroll the feed container to the bottom in a loop (via `scrollTo` /
   dispatched scroll events — not the `computer` scroll action, which stalled
   in testing). Stop when the map size is unchanged for 2 consecutive rounds.
6. Read `window.__HARVEST` out as JSON → write `Albums/<folder>/.harvest/urls.json`
   as `[{ n, sl, os }...]`. Capture album `title`, date range, location from the
   page → `meta.json`.

Failure modes: 0 photos after entering feed → report and ask the operator to
open the album manually first (as they do today); harvest never partially
overwrites a prior `urls.json` without reporting the delta.

### Phase 2 — Parallel download (`download.sh`, POSIX shell)

Inputs: `urls.json`, target `Albums/<folder>/`, optional `-j <workers>` (default 6).

1. **Skip-set** = basenames already present in the target dir. (Resume: the 390
   existing `DS887xxx.JPG` are skipped; only new files download.)
2. Emit `filename\tURL` lines for photos NOT in the skip-set.
3. `xargs -P<workers>` → per line: `curl -fsS --retry 3 -o <tmp> <URL>`, verify
   the result is a JPEG (`file`/magic-byte check — guards against a 403 HTML
   body being saved), then `mv` into place atomically. Never overwrite existing.
4. Report `downloaded / skipped / failed`; list any persistent failures. A
   403/expired-signature failure → advise re-running Phase 1 to re-sign.

### Phase 3 — Classify

Invoke the existing `tagging-album-photos` skill with `Albums/<folder>/` as the
event dir. It already does resume-checking and produces `Sorted/tags.json`. No
changes to that skill. (Note: it reads the folder as `[Raw]` today — the
orchestrator points it at the flat `Albums/<folder>/` where files landed.)

### Phase 4 — Upload to R2 (gated)

Ask the operator explicitly (outward-facing action). On yes:
`npm run import-album -- --event "<title>" --dir Albums/<folder> --tags Albums/<folder>/Sorted/tags.json --date <start> --location <loc>`,
event/date/location pre-filled from `meta.json`, editable first. `import-album`
already consumes `tags.json` natively (no format conversion) — it just isn't in
the importer's auto-discovery candidates for our nested `Albums/<folder>/Sorted/`
layout, so pass `--tags` explicitly. `import-album` is idempotent (content-hash
R2 keys + HeadObject skip) and supports `--dry-run`.

## Testing

- Download: curl of `sl`/`ol` already verified HTTP 200 headless. Test skip-set
  against the existing `DS887xxx` files (all skipped, only new pulled) and the
  JPEG-validation guard (a 403 body is rejected, not saved as `.JPG`).
- Harvest: validate the live-feed count reaches the full album (≫ 99).
- Upload: `import-album --dry-run` first.

## Out of scope

- Reverse-engineering the page-signing for pure-CLI harvest (fragile; breaks on
  provider change). Browser harvest is the deliberate choice.
- Providers other than alltuu/piufoto.
- Changes to `tagging-album-photos` or `import-album` internals.
