---
name: import-alltuu-album
description: Use when the operator sends an alltuu / piufoto album link (m.alltuu.com/album/...) plus a folder name and wants the photos pulled down fast and prepared for the site. Fast parallel download of only-new photos (resume by filename), then tagging, then a gated R2 upload. Keywords - alltuu, piufoto, m.alltuu.com, album link, download album, parallel download, resume, folder name, WRCT, competition photos.
---

# Import an alltuu / piufoto album

## Overview

The operator drops an album URL + a folder name. You run four phases and stop
only to confirm the upload:

1. **Harvest** the signed image URLs by driving the browser (the provider signs
   each result page, so pagination must go through the app).
2. **Download** only the new photos, in parallel, skipping anything already on
   disk (resume by filename).
3. **Classify** via the `[[tagging-album-photos]]` skill.
4. **Upload** to R2 via `npm run import-album` — **only after asking**.

Inputs: an album URL like
`https://m.alltuu.com/album/<32-hex-id>/` and a folder name → `Albums/<folder>/`.
If the folder already exists, this resumes: already-downloaded files (matched by
filename) are never re-fetched.

## Why the browser (and why it's still fast)

The photo list comes from `https://v4c.alltuu.com/<sig>/…/rest/v4c/fplN/…/s<offset>/…`.
The `s` offset is part of a **server-side signature** — hand-editing it → HTTP 403,
so only the app can page through results. But each photo's image URL (`sl`, etc.)
is a plain signed OSS link that downloads headless with `curl` (no cookies), valid
~1 month. So: harvest URLs through the app once, then download in parallel offline.

## Layout

```
Albums/<folder>/                 ← photos land here, flat (READ+WRITE)
Albums/<folder>/.harvest/urls.json   ← harvested manifest [{n,sl,os,w,h}]
Albums/<folder>/.harvest/meta.json   ← album title / dates / location
Albums/<folder>/Sorted/tags.json     ← written by the tagging skill
```

## Phase 1 — Harvest (browser)

1. `preview_start` (or `navigate`) to the album URL. Screenshot.
2. If an intro splash is up, click the "进入…" (enter) button. Screenshot to
   confirm the photo grid.
3. Click the **图片直播 (live feed)** tab — the complete chronological set. The
   **热门 (hot)** tab is a curated subset (~99) — do not harvest from it.
4. `javascript_tool`: eval the entire contents of this skill's `harvest.js`.
   Expect `"installed"`.
5. Loop up to ~40 times, one `javascript_tool` call each:
   ```js
   (async () => { window.__harvestScroll(); await new Promise(r=>setTimeout(r,700)); return window.__harvestStatus(); })()
   ```
   Stop when `growingRounds >= 2` (count stable two rounds running).
6. `javascript_tool`: `window.__harvestDump()` → parse the JSON string.
7. Write `photos` → `Albums/<folder>/.harvest/urls.json` and `meta` →
   `Albums/<folder>/.harvest/meta.json`.

If `photos.length` is 0 after entering the live feed, **stop** and ask the
operator to open the album in a browser themselves first, then retry — some
albums gate the feed behind an interaction. Never silently write an empty
manifest over a good one.

## Phase 2 — Download (parallel, headless)

```bash
bash .claude/skills/import-alltuu-album/download.sh \
  Albums/<folder>/.harvest/urls.json Albums/<folder> -j 6
```

It builds a skip-set from filenames already in `Albums/<folder>/`, downloads the
rest with 6 workers, validates each is a real JPEG (a 403 HTML body is discarded,
never saved as `.JPG`), and prints `downloaded=… skipped=… failed=… total=…`.

- `-j N` changes worker count (default 6; 3–8 all safe on the OSS backend).
- Downloads the **`sl` 1600px tier** (~0.5–1 MB) by default — enough for the
  site (import-album downscales to 1080px WebP) and for plate-reading (tagging
  downscales to 1280px). Add `--field ol` only if the operator wants the 5.6 MB
  camera originals.
- If any `failed` line is a 403 / expired signature, the harvest signatures
  aged out — re-run **Phase 1** to re-sign, then Phase 2 again.

## Phase 3 — Classify

Invoke the `[[tagging-album-photos]]` skill with `Albums/<folder>/` as the event
directory. It resume-checks and writes `Albums/<folder>/Sorted/tags.json`. No
changes to that skill; it makes its own downscaled working copies.

## Phase 4 — Upload to R2 (gated — ask first)

Publishing is outward-facing: **ask the operator before uploading.** Pre-fill from
`.harvest/meta.json`, but the raw title is Chinese — offer a clean English event
name (that string becomes the event name and R2 slug). Then, from `scripts/`:

```bash
cd scripts && npm run import-album -- \
  --event "<Clean Event Name>" \
  --dir "../Albums/<folder>" \
  --tags "../Albums/<folder>/Sorted/tags.json" \
  --date <YYYY-MM-DD> --location "<Location>"
```

Suggest `--dry-run` first. `import-album` is idempotent (content-hash R2 keys +
HeadObject skip) and mirrors 1080px + 480px WebP to R2 while writing Postgres.
`tags.json` is consumed natively — pass `--tags` explicitly because our nested
`Albums/<folder>/Sorted/` path isn't in the importer's auto-discovery list.

## Common mistakes
| Mistake | Fix |
|--------|-----|
| Harvesting from the 热门 (hot) tab | Use 图片直播 (live feed) — hot is a ~99 subset. |
| Hand-editing the `s` offset to paginate with curl | Signed server-side → 403. Harvest through the app. |
| Re-downloading everything | The skip-set matches by filename; point at the existing folder to resume. |
| Downloading `ol` originals by default | Default `sl` (1600px) is enough; `--field ol` only on request. |
| A 403 body saved as a `.JPG` | `download.sh` validates JPEG magic and discards it — never bypass that. |
| Uploading without asking | Phase 4 is gated. Confirm event name + R2 slug first. |
| Putting the Chinese title in the R2 slug unintentionally | Offer a clean English `--event` name. |
| Stale signatures mid-download | Re-run Phase 1 to re-sign, then Phase 2. |
