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
5. Loop up to ~40 times, a few scroll steps per `javascript_tool` call:
   ```js
   (async () => { for (let i=0;i<6;i++){ window.__harvestScroll(); await new Promise(r=>setTimeout(r,750)); } return window.__harvestStatus(); })()
   ```
   Stop when `growingRounds >= 2` (count stable two rounds running). A large
   album grows +60/round into the thousands — keep going until it plateaus.
6. **Write the manifest to disk without routing it through your context.** The
   dump can be 100s of KB of signed URLs — do NOT return it from `javascript_tool`.
   Instead run this skill's one-shot receiver and have the page POST to it:
   ```bash
   mkdir -p Albums/<folder>/.harvest
   python3 .claude/skills/import-alltuu-album/recv.py \
     "$(pwd)/Albums/<folder>/.harvest/urls.json" &   # run in background
   ```
   Then one `javascript_tool` call:
   ```js
   (async () => {
     const photos = [...window.__HARVEST.values()];
     const r = await fetch('http://127.0.0.1:8799/', {method:'POST', headers:{'Content-Type':'text/plain'}, body: JSON.stringify(photos)});
     return 'status='+r.status+' count='+photos.length;
   })()
   ```
   The receiver writes `urls.json` and exits. (If the browser can't reach
   localhost, fall back to `window.__harvestDump()` in chunks.)
7. Capture album meta once (small enough to return directly): `javascript_tool`
   → `JSON.parse(window.__harvestDump()).meta` → write `Albums/<folder>/.harvest/meta.json`.

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
- Downloads the **`bl` 1600px tier** (~0.5–1 MB) by default — enough for the
  site (import-album downscales to 1080px WebP) and for plate-reading (tagging
  downscales to 1280px). Field tiers: `bl`=1600px (default), `url1920`=1620×1080,
  `ol`=4000px original. Add `--field ol` only if the operator wants the 5.6 MB
  camera originals. (Note: the live-feed `sl` field is only 720px — never use it.)
- If any `failed` line is a 403 / expired signature, the harvest signatures
  aged out — re-run **Phase 1** to re-sign, then Phase 2 again.

## Phase 3 — Classify

Invoke the `[[tagging-album-photos]]` skill with `Albums/<folder>/` as the event
directory. It resume-checks and writes `Albums/<folder>/Sorted/tags.json`. No
changes to that skill; it makes its own downscaled working copies.

## Phase 4 — Upload to R2 (gated — ask first)

### 4a. Reconcile with existing albums FIRST (never blind-create)

An event may already be half-uploaded (e.g. you sorted part of it on an earlier
day). `import-album` keys the album on `slug = slugify(--event)` and **upserts on
that slug** — so reusing an existing album's *exact name* uploads INTO it, while a
slightly different name silently creates a duplicate album. Always check before
choosing a name.

List what's already published (read-only, unauthenticated). `$APERTURE` is the
deployed site base URL — **ask the operator for it if you don't have it**:

```bash
curl -s "$APERTURE/api/public/albums" | jq '.albums'
# -> [{ slug, name, date, photoCount, taggedCount }, …]
```

Find likely matches to THIS album, using `.harvest/meta.json`:
- **date** — compare each album's `date` to `meta.dateStart` (e.g. `2026-07-15`).
- **name** — compare `name` against the album title / your suggested event name.

Then **ask the operator**, showing any candidate with its `slug` and
`photoCount` (a nonzero count is the tell-tale of a half-done upload):

> Found an existing album that looks like this event: **"<name>"** (`<slug>`,
> <photoCount> photos already). Upload into it, create a new album, or pick a
> different one?

- **Upload into the matched album** → set `--event` to that album's **exact
  `name`** (verbatim, so `slugify` reproduces its `slug` and the upsert updates
  it — no duplicate). Optionally confirm which files are new via
  `curl -s "$APERTURE/api/public/albums/<slug>/sorted" | jq '.photos|keys'`.
- **Create a new album** → pick a clean English event name (see below).
- **Different album / not sure** → show the full `.albums` list and let them choose.

If the list is empty or nothing plausibly matches, proceed as a new album.

### 4b. Upload

Publishing is outward-facing: **ask the operator before uploading.** For a new
album, pre-fill from `.harvest/meta.json`, but the raw title is Chinese — offer a
clean English event name (that string becomes the event name and R2 slug). For a
matched album, use its existing name from 4a. Then, from `scripts/`:

```bash
cd scripts && npm run import-album -- \
  --event "<matched name (verbatim) OR new clean name>" \
  --dir "../Albums/<folder>" \
  --tags "../Albums/<folder>/Sorted/tags.json" \
  --date <YYYY-MM-DD> --location "<Location>"
```

Suggest `--dry-run` first (it prints the resolved `slug` — verify it matches the
intended existing album). `import-album` is idempotent (content-hash R2 keys +
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
| Blind-creating a duplicate album for a half-uploaded event | Phase 4a: list `/api/public/albums`, match by date+name, reuse the matched album's exact name so the slug upserts. |
| Putting the Chinese title in the R2 slug unintentionally | Offer a clean English `--event` name. |
| Stale signatures mid-download | Re-run Phase 1 to re-sign, then Phase 2. |
