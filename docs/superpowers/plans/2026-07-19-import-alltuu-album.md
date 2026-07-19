# import-alltuu-album Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `import-alltuu-album` skill that turns an alltuu/piufoto album link + folder name into: fast parallel download of only-new photos → classify (existing tagging skill) → gated R2 upload.

**Architecture:** Orchestrator skill with four phases. Phase 1 harvests signed image URLs by driving the Claude Browser (the provider signs each result page, so pagination must go through the app). Phases 2–4 are headless: a POSIX `download.sh` (curl × 6, skip-by-filename), then the existing `tagging-album-photos` skill, then the existing `npm run import-album`. New code = `download.sh` + `harvest.js` + `SKILL.md`.

**Tech Stack:** POSIX shell, curl, xargs, `file`; browser JS (fetch hook); the existing `scripts/` TS workspace (`import-album`) and `tagging-album-photos` skill — both reused unchanged.

## Global Constraints

- Skill lives at `.claude/skills/import-alltuu-album/` (mirrors `tagging-album-photos/`).
- Download tier is `sl` (1600px, ~0.5–1 MB). Never `ol` (5.6 MB) unless a flag overrides.
- Default 6 parallel workers; overridable via `-j`.
- Dedup / skip / resume key is the original filename `n` (e.g. `DS889828.JPG`).
- Never overwrite an existing file in the target dir; never save a non-JPEG body.
- R2 upload (Phase 4) is gated behind explicit operator confirmation.
- Downloaded images land flat in `Albums/<folder>/`; tagging writes `Albums/<folder>/Sorted/tags.json`.
- Signed OSS image URLs download headless (no cookies/referer); signatures expire ~1 month out.

---

### Task 1: `download.sh` — parallel downloader with skip-set + JPEG validation

**Files:**
- Create: `.claude/skills/import-alltuu-album/download.sh`
- Test: `.claude/skills/import-alltuu-album/test/test_download.sh`

**Interfaces:**
- Consumes: `urls.json` — a JSON array `[{ "n": "DS889828.JPG", "sl": "https://uib…", "os": "5597341.00" }, …]`.
- Produces: CLI `download.sh <urls.json> <target-dir> [-j N]`. Writes `<target-dir>/<n>` for each photo not already present. Prints a final summary line `downloaded=<d> skipped=<s> failed=<f>` and, on any failure, the failed filenames. Exit 0 unless a fatal arg/parse error.

**Behavioral contract (what the tests pin down):**
1. A filename already present in `<target-dir>` is skipped (counted in `skipped`, never re-fetched).
2. Each fetched body is validated as JPEG (magic bytes `FF D8 FF`); a non-JPEG (e.g. a 403 HTML error page) is discarded, counted `failed`, and no `.JPG` is written.
3. Downloads run concurrently (`xargs -P`), default 6.
4. Writes are atomic: download to a temp path, validate, then `mv` into place — a killed run never leaves a half-written `<n>`.

- [ ] **Step 1: Write the failing test**

`test/test_download.sh` — a self-contained bash test using a local `file://`-style fixture via a tiny python http server is overkill; instead test the two pure-logic guarantees (skip-set + JPEG validation) with local fixtures, and one real network fetch against a known-good signed URL captured in the spec.

```bash
#!/usr/bin/env bash
# Test download.sh: skip-set, JPEG validation, atomic write.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
DL="$HERE/../download.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0; pass=0
check(){ if [ "$2" = "$3" ]; then pass=$((pass+1)); else echo "FAIL: $1 (got '$2' want '$3')"; fail=$((fail+1)); fi; }

# --- Fixture A: skip-set. Pre-create one existing file; give urls.json two
#     entries, one of which already exists. Point the missing one at a bad host
#     so it "fails" — we only assert skip counting here.
mkdir -p "$TMP/album"
printf '\xff\xd8\xff\xdummy' > "$TMP/album/EXISTS.JPG"
cat > "$TMP/urls.json" <<'JSON'
[{"n":"EXISTS.JPG","sl":"https://127.0.0.1:1/never","os":"10"},
 {"n":"NOPE.JPG","sl":"https://127.0.0.1:1/never","os":"10"}]
JSON
out="$("$DL" "$TMP/urls.json" "$TMP/album" -j 2 2>/dev/null)"
echo "$out" | grep -q 'skipped=1' ; check "skips existing" "$?" "0"
[ -f "$TMP/album/EXISTS.JPG" ] ; check "existing untouched" "$?" "0"

# --- Fixture B: JPEG validation. A URL that returns non-JPEG must not be saved.
#     Use a data-ish stand-in: reuse the bad host → curl fails → failed, no file.
[ ! -f "$TMP/album/NOPE.JPG" ] ; check "bad download not saved" "$?" "0"
echo "$out" | grep -q 'failed=1' ; check "counts failure" "$?" "0"

# --- Fixture C: real fetch (network). Known-good signed sl URL from the spec.
SL='https://uib.alltuu.com/ml/pl1eLOA3s76.jpg?Expires=1788135304&OSSAccessKeyId=LTAI5tCKgYFjLSzev9mGY4Vs&Signature=mPlJaN8g6JFrnEXPrPdgskghBAA%3D&response-content-disposition=attachment%3Bfilename%3DDS889828-4820361589.jpg&response-content-type=image%2Fjpeg'
cat > "$TMP/urls2.json" <<JSON
[{"n":"DS889828.JPG","sl":"$SL","os":"538117"}]
JSON
"$DL" "$TMP/urls2.json" "$TMP/album" -j 1 >/dev/null 2>&1
if [ -f "$TMP/album/DS889828.JPG" ]; then
  head -c 3 "$TMP/album/DS889828.JPG" | od -An -tx1 | grep -qi 'ff d8 ff' ; check "real jpeg saved" "$?" "0"
else echo "SKIP: network fetch (offline?)"; fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash .claude/skills/import-alltuu-album/test/test_download.sh`
Expected: FAIL — `download.sh` does not exist yet (`No such file or directory`).

- [ ] **Step 3: Write `download.sh`**

```bash
#!/usr/bin/env bash
# Parallel downloader for an alltuu/piufoto album manifest.
# Usage: download.sh <urls.json> <target-dir> [-j N] [--field sl|ol|url1920]
# Skips filenames already in <target-dir>; validates each body is a JPEG;
# writes atomically. Prints: downloaded=<d> skipped=<s> failed=<f>
set -u

URLS="${1:?usage: download.sh <urls.json> <target-dir> [-j N] [--field FIELD]}"
DIR="${2:?usage: download.sh <urls.json> <target-dir> [-j N] [--field FIELD]}"
shift 2 || true
JOBS=6
FIELD=sl
while [ $# -gt 0 ]; do
  case "$1" in
    -j) JOBS="$2"; shift 2;;
    --field) FIELD="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
mkdir -p "$DIR"

# Extract "<filename>\t<url>" lines for the chosen field. Prefer jq; fall back
# to a python one-liner so the script has no hard jq dependency.
extract() {
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg f "$FIELD" '.[] | "\(.n)\t\(.[$f])"' "$URLS"
  else
    python3 - "$URLS" "$FIELD" <<'PY'
import json,sys
data=json.load(open(sys.argv[1])); f=sys.argv[2]
for p in data:
    if p.get("n") and p.get(f): print(p["n"]+"\t"+p[f])
PY
  fi
}

# Build skip-set from files already on disk.
declare -A HAVE=()
if [ -d "$DIR" ]; then
  while IFS= read -r existing; do HAVE["$existing"]=1; done < <(cd "$DIR" && ls -1 2>/dev/null)
fi

TODO="$(mktemp)"; trap 'rm -f "$TODO"' EXIT
skipped=0; total=0
while IFS="$(printf '\t')" read -r name url; do
  [ -n "$name" ] || continue
  total=$((total+1))
  if [ -n "${HAVE[$name]:-}" ]; then skipped=$((skipped+1)); continue; fi
  printf '%s\t%s\n' "$name" "$url" >> "$TODO"
done < <(extract)

# Worker: fetch one file to a temp path, validate JPEG magic, atomic move.
fetch_one() {
  local line="$1" dir="$2"
  local name url tmp
  name="${line%%$'\t'*}"; url="${line#*$'\t'}"
  tmp="$dir/.dl.$name.$$"
  if ! curl -fsS --retry 3 --retry-delay 1 -o "$tmp" "$url"; then
    rm -f "$tmp"; echo "FAIL	$name"; return 0
  fi
  # JPEG magic bytes FF D8 FF — rejects 403 HTML bodies saved as .JPG.
  if [ "$(head -c 3 "$tmp" | od -An -tx1 | tr -d ' \n' | tr 'A-F' 'a-f')" != "ffd8ff" ]; then
    rm -f "$tmp"; echo "FAIL	$name"; return 0
  fi
  mv -f "$tmp" "$dir/$name"
  echo "OK	$name"
}
export -f fetch_one

RESULTS="$(mktemp)"; trap 'rm -f "$TODO" "$RESULTS"' EXIT
if [ -s "$TODO" ]; then
  # -P<JOBS> concurrency; pass each manifest line as one arg.
  # shellcheck disable=SC2016
  xargs -P "$JOBS" -I{} bash -c 'fetch_one "$@"' _ {} "$DIR" < "$TODO" > "$RESULTS"
fi

downloaded="$(grep -c '^OK' "$RESULTS" 2>/dev/null || echo 0)"
failed="$(grep -c '^FAIL' "$RESULTS" 2>/dev/null || echo 0)"
echo "downloaded=$downloaded skipped=$skipped failed=$failed total=$total"
if [ "$failed" -gt 0 ]; then echo "failures:"; grep '^FAIL' "$RESULTS" | cut -f2; fi
exit 0
```

Then `chmod +x download.sh`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `chmod +x .claude/skills/import-alltuu-album/download.sh && bash .claude/skills/import-alltuu-album/test/test_download.sh`
Expected: `pass=5 fail=0` (or `pass=4` + one `SKIP` line if offline). Exit 0.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/import-alltuu-album/download.sh .claude/skills/import-alltuu-album/test/test_download.sh
git commit -m "feat(import-alltuu-album): parallel downloader with skip-set + JPEG validation"
```

---

### Task 2: `harvest.js` — browser fetch-hook + auto-scroll harvester

**Files:**
- Create: `.claude/skills/import-alltuu-album/harvest.js`

**Interfaces:**
- Produces: a browser-pasteable IIFE. On first eval it installs a `fetch`/XHR hook
  that accumulates every `fplN` response's `d[]` into `window.__HARVEST` (a Map
  keyed by `n`). Exposes `window.__harvestStatus()` → `{count, growingRounds}` and
  `window.__harvestDump()` → JSON string `{ photos:[{n,sl,os,w,h}], meta:{title,dateText,location} }`.
- The agent drives it: eval harvest.js → switch to 图片直播 tab → loop `scrollStep()` +
  `__harvestStatus()` until count stable for 2 rounds → `__harvestDump()` → write files.

**Validation contract:** run against the live album
`e0734915b24e62e9c208881f1d53c7bf`; harvested `photos.length` must exceed the 99
returned by the "hot" tab (i.e. it reached the full live feed), and every entry
has a non-empty `n` and `sl`.

- [ ] **Step 1: Write `harvest.js`**

```javascript
// Paste into the Claude Browser (javascript_tool) on an alltuu album page.
// Installs a fetch/XHR hook that captures every photo-list page as the SPA
// lazy-loads it, so we never fight the server-side page signing.
(function () {
  if (window.__HARVEST) return 'already installed; count=' + window.__HARVEST.size;
  window.__HARVEST = new Map();          // n -> {n, sl, os, w, h}
  window.__harvestPrev = -1;
  window.__harvestRounds = 0;

  const ingest = (text) => {
    let j; try { j = JSON.parse(text); } catch { return; }
    const d = j && j.d;
    if (!Array.isArray(d)) return;
    for (const p of d) {
      if (p && p.n && p.sl) window.__HARVEST.set(p.n, { n: p.n, sl: p.sl, os: p.os, w: p.w, h: p.h });
    }
  };

  // Hook fetch.
  const of = window.fetch;
  window.fetch = function (...a) {
    return of.apply(this, a).then((res) => {
      try {
        const u = (res && res.url) || (typeof a[0] === 'string' ? a[0] : a[0] && a[0].url) || '';
        if (/\/rest\/v4c\/fplN\//.test(u)) res.clone().text().then(ingest).catch(() => {});
      } catch {}
      return res;
    });
  };
  // Hook XHR (some SPA builds use it).
  const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url, ...r) { this.__u = url; return oo.call(this, m, url, ...r); };
  XMLHttpRequest.prototype.send = function (...r) {
    this.addEventListener('load', () => { try { if (/\/rest\/v4c\/fplN\//.test(this.__u || '')) ingest(this.responseText); } catch {} });
    return os.apply(this, r);
  };

  // Scroll the tallest scrollable container (or the window) toward the bottom.
  window.__harvestScroll = () => {
    let best = document.scrollingElement || document.documentElement, bestH = best ? best.scrollHeight : 0;
    document.querySelectorAll('*').forEach((el) => {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 200 && el.scrollHeight > bestH) { best = el; bestH = el.scrollHeight; }
    });
    if (best === window || best === document.scrollingElement || best === document.documentElement) window.scrollTo(0, document.body.scrollHeight);
    else best.scrollTop = best.scrollHeight;
    return best && (best.id || best.className || best.tagName) || 'window';
  };

  // One "round": scroll, then report whether the map grew.
  window.__harvestStatus = () => {
    const c = window.__HARVEST.size;
    if (c === window.__harvestPrev) window.__harvestRounds++; else window.__harvestRounds = 0;
    window.__harvestPrev = c;
    return { count: c, growingRounds: window.__harvestRounds };
  };

  window.__harvestDump = () => {
    const photos = [...window.__HARVEST.values()];
    const q = (sel) => (document.querySelector(sel) && document.querySelector(sel).textContent || '').trim();
    const meta = {
      title: (document.querySelector('meta[property="og:title"]') || {}).content || document.title || '',
      dateText: q('[class*="date"]') || '',
      location: q('[class*="location"], [class*="addr"]') || '',
    };
    return JSON.stringify({ photos, meta });
  };
  return 'installed';
})();
```

- [ ] **Step 2: Validate against the live album (browser)**

Drive the Claude Browser MCP:
1. `preview_start {url:"https://m.alltuu.com/album/e0734915b24e62e9c208881f1d53c7bf/?from=qrCode&menu=hot"}`
2. If the intro splash is up, click "进入…" (screenshot to locate).
3. Click the **图片直播** tab.
4. `javascript_tool`: eval the whole `harvest.js` IIFE. Expect `"installed"`.
5. Loop (≈ up to 40×): `javascript_tool` → `window.__harvestScroll(); await new Promise(r=>setTimeout(r,700)); window.__harvestStatus();`
   Stop when `growingRounds >= 2`.
6. `javascript_tool`: `window.__harvestDump()` → parse.
   Expected: `photos.length` ≫ 99; every entry has `n` and `sl`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/import-alltuu-album/harvest.js
git commit -m "feat(import-alltuu-album): browser fetch-hook harvester for signed photo URLs"
```

---

### Task 3: `SKILL.md` — the orchestrator

**Files:**
- Create: `.claude/skills/import-alltuu-album/SKILL.md`

**Interfaces:**
- Consumes: `download.sh` (Task 1) and `harvest.js` (Task 2) by relative path; the
  `tagging-album-photos` skill; `npm run import-album` in `scripts/`.
- Produces: the operator-facing workflow doc that an agent follows when the user
  sends an album link + folder name.

**Content contract — the SKILL.md MUST specify, in order:**

1. **Frontmatter** `name: import-alltuu-album` + a `description:` whose trigger
   keywords include: alltuu, piufoto, m.alltuu.com, album link, download album,
   fast/parallel download, plus folder name. Note it chains into
   `[[tagging-album-photos]]`.
2. **Inputs:** album URL + folder name (`Albums/<folder>/`). If folder exists,
   resume (skip already-downloaded by filename).
3. **Phase 1 — Harvest (browser).** Steps exactly as Task 2 Step 2. Write results
   to `Albums/<folder>/.harvest/urls.json` (the `photos` array) and `.harvest/meta.json`
   (the `meta` object). If `photos.length` is 0, stop and tell the operator to
   open the album manually first, then retry.
4. **Phase 2 — Download.** Run
   `bash .claude/skills/import-alltuu-album/download.sh Albums/<folder>/.harvest/urls.json Albums/<folder> -j 6`.
   Report `downloaded/skipped/failed`. On any `failed` line that is a 403/expired
   signature, re-run Phase 1 (signatures expire ~1 month) and Phase 2.
5. **Phase 3 — Classify.** Invoke the `tagging-album-photos` skill with
   `Albums/<folder>/` as the event directory. It produces `Albums/<folder>/Sorted/tags.json`.
6. **Phase 4 — Upload (gated).** ASK the operator first. Pre-fill from
   `.harvest/meta.json`, let them edit the event name (the raw title is Chinese —
   offer a clean English name). Then run:
   `cd scripts && npm run import-album -- --event "<event>" --dir "../Albums/<folder>" --tags "../Albums/<folder>/Sorted/tags.json" --date <YYYY-MM-DD> --location "<loc>"`.
   Suggest `--dry-run` first.
7. **Resolution note:** downloads the `sl` 1600px tier by default; add
   `--field ol` to `download.sh` only if the operator wants 5.6 MB originals.
8. **Common mistakes table:** re-harvest on 403; never overwrite existing files;
   Phase 4 is gated; keep the Chinese title out of the R2 slug unless intended.

- [ ] **Step 1: Write `SKILL.md`** covering the 8-point contract above, in the
  same house style as `.claude/skills/tagging-album-photos/SKILL.md` (read it
  first for tone: terse, tabbed layout block, "Common mistakes" table).

- [ ] **Step 2: Lint-check the frontmatter**

Run: `head -5 .claude/skills/import-alltuu-album/SKILL.md`
Expected: valid `---`-delimited frontmatter with `name:` and `description:`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/import-alltuu-album/SKILL.md
git commit -m "feat(import-alltuu-album): orchestrator skill doc (harvest→download→tag→upload)"
```

---

### Task 4: Live end-to-end validation on WRCT_Beijing

**Files:** none created — this runs the finished skill against the real album to
prove the pipeline and actually fetch the operator's new photos.

**Interfaces:**
- Consumes: everything from Tasks 1–3, plus the already-open browser album and the
  existing `Albums/WRCT_Beijing/` (~390 `DS887xxx` files).

- [ ] **Step 1: Harvest** the live album → `Albums/WRCT_Beijing/.harvest/urls.json`.
  Expected: `photos.length` ≫ 390.

- [ ] **Step 2: Dry inspection of skip-set.** Count how many harvested filenames
  are already on disk vs new:

```bash
cd "Albums/WRCT_Beijing"
comm -13 <(ls -1 *.JPG 2>/dev/null | sort) \
         <(jq -r '.[].n' .harvest/urls.json | sort) | wc -l   # = new to fetch
```

Expected: a positive count of new `DS889xxx` files; the `DS887xxx` set is NOT in
the "new" list.

- [ ] **Step 3: Download** the new photos:

Run: `bash .claude/skills/import-alltuu-album/download.sh Albums/WRCT_Beijing/.harvest/urls.json Albums/WRCT_Beijing -j 6`
Expected: `skipped=` ≈ 390 (the existing files), `downloaded=` = the new count from Step 2, `failed=0`.

- [ ] **Step 4: Verify** all fetched files are valid JPEGs:

Run: `cd Albums/WRCT_Beijing && for f in $(jq -r '.[].n' .harvest/urls.json); do [ -f "$f" ] || echo "MISSING $f"; done | head`
Expected: no `MISSING` lines (every harvested photo is on disk).

- [ ] **Step 5: Report** the summary to the operator (downloaded/skipped/total,
  disk delta). Do NOT auto-run tagging or upload — hand back for the operator to
  continue Phases 3–4 when ready.

---

## Self-Review

**Spec coverage:** Phase 1 harvest → Task 2 + Task 3§3; Phase 2 download → Task 1 + Task 3§4; Phase 3 classify → Task 3§5; Phase 4 upload → Task 3§6; resolution tier `sl` → Global Constraints + Task 3§7; skip/resume → Task 1 contract + Task 4§2; error handling (403 re-harvest, JPEG guard, gated upload) → Task 1 + Task 3§4,6. All spec sections mapped.

**Placeholder scan:** `<folder>`, `<event>`, `<loc>` are runtime template args, not plan gaps — every code step shows real code. No TODO/TBD.

**Type consistency:** manifest shape `{n, sl, os, w, h}` is identical across harvest.js dump, urls.json, and download.sh `extract()`. `download.sh <urls.json> <target-dir> [-j N] [--field FIELD]` signature is identical in Task 1 interface, Step 3 code, Task 3§4, and Task 4§3. Summary line `downloaded=/skipped=/failed=` identical in Task 1 and Task 4§3.
