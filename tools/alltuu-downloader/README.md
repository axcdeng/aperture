# Alltuu Album Fast Downloader (Chrome extension)

A zero-token alternative to Phases 1–2 of the `import-alltuu-album` skill: harvest
an alltuu / piufoto album's live feed and bulk-download every photo in parallel,
right in your browser. Tagging + R2 upload still go through the agent.

## Install (one time)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder:
   `tools/alltuu-downloader/`.
4. The "Alltuu Album Fast Downloader" icon appears in the toolbar.

## Use

1. Open the album, e.g. `https://m.alltuu.com/album/<id>/`.
   (If you installed the extension while the page was already open, **reload** it
   once so the content scripts inject.)
2. Click the extension icon.
3. **Harvest feed** — it clicks into the 图片直播 (live feed) tab and auto-scrolls
   to capture every photo's signed URL. Watch the count climb; it stops when it
   plateaus. *Keep the popup open during this step.*
4. Set a **folder name** (e.g. `WRCT_Beijing`) and pick a resolution
   (`bl` 1600px is the default — plenty for the site and plate-reading).
5. **Download all** — fires all downloads into `~/Downloads/<folder>/`. Chrome
   runs them in parallel and they continue even if you close the popup.
   Photos already downloaded into that folder are skipped.

## After downloading

Move the folder into the project and continue with the agent:

```bash
mv ~/Downloads/WRCT_Beijing/* "Albums/WRCT_Beijing/"
```

Then ask the agent to run the tagging phase (and R2 upload) on `Albums/WRCT_Beijing/`.

## How it works / limits

- **Harvest** hooks the page's own `fetch`/`XHR` (`/rest/v4c/fplN/`) so it captures
  each signed result page as the SPA loads it — the provider signs pagination
  server-side, so this is the only way to page through without 403s.
- **Download** uses `chrome.downloads`; the signed image URLs (`bl`/`url1920`/`ol`)
  are plain OSS links that download without cookies and expire ~1 month out.
- **Resolution tiers:** `bl` = 1600px medium (default), `url1920` = 1620×1080,
  `ol` = 4000px original (~5.6 MB each). The live-feed `sl` field is only 720px
  and is never used.
- **Skip / resume** is best-effort, based on Chrome's download history for the
  same folder (files you deleted or downloaded elsewhere won't be known). For
  exact disk-based resume, use the skill's `download.sh` instead.
- Extensions can only write under `~/Downloads/`, hence the move step above.

## "View full size" on the Aperture site

The extension also adds a **View full size** button to each photo tile on your
Aperture album pages. Clicking it opens that photo's 4000px original from the
linked alltuu album.

How it works:
- Each Aperture album stores its alltuu album URL (`events.source_url`, set at
  import via `--source-url`). The album page exposes it as `data-alltuu-album-url`
  and each tile as `data-original-filename`.
- On the first click for an album, the extension opens that alltuu album in a
  background tab, harvests the `filename → original-URL` map, and caches it in
  `chrome.storage` for ~25 days (bounded by the OSS signature lifetime). That
  first click takes ~30s ("Preparing…"); every click after is instant until the
  cache expires, then it re-harvests automatically.

### Where it runs

The Aperture content script is configured for `http://localhost:6606/*` (local
dev) and `https://aperture-peach.vercel.app/*` (production). To add another
domain, put it in **two** places in `manifest.json`, then reload the extension:

1. `host_permissions`: add `"https://your-domain/*"`
2. the last `content_scripts` entry's `matches`: add `"https://your-domain/*"`

(Requires the site to be running the `source_url` changes so the album pages
carry `data-alltuu-album-url` / `data-original-filename`.)
