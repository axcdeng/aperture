---
name: tagging-album-photos
description: Use when tagging a folder of raw competition robot photos by the VEX team number(s) on each robot's license plate — reading plates off the images to build an album for the site. Keywords - license plate, team number, VEX, album, Raw, Sorted, tags.json, manifest, contact sheet, triage, subagents.
---

# Tagging Album Photos

## Overview

Read the **team license-plate number(s)** off each competition photo and record them in
one JSON manifest, then make per-team alias folders. A photo can show several robots →
several teams. Many photos are crowds/venue shots with no robot → no teams.

**Core principle — cheap triage, then targeted reads, in parallel:**
1. **Triage** every photo on cheap contact sheets → is it a robot or not?
2. **Skip** the obvious non-robot photos (tag `[]`). **Fan out** the rest to subagents that
   read plates at full 720p.
3. **Merge** all results into `Sorted/tags.json` (only the main agent writes it).

Small album (≤ ~40 photos)? Skip the machinery — just do "Read a plate" (below) inline.

## 0. Before you start — resume check (multi-day events)

Someone (you on an earlier day, or another person) may have already sorted part of this
event. **Never re-tag photos that are already done.** Build a skip-set from two sources,
then process only the *remaining* raw files.

**a) Local manifest.** If `Sorted/tags.json` already exists in this event folder, load it —
its keys are already-sorted filenames. You will merge new results into it (don't overwrite).

**b) The site (other people / other machines).** The Aperture site exposes a read-only,
unauthenticated API of what's already uploaded/tagged for an album. Use it so parallel
sorters don't collide.

First find the album's `slug`. You need the site base URL (call it `$APERTURE`); if you
don't know it, **ask the user for the site URL**. Then:
```bash
# List albums to find the one you're working on:
curl -s "$APERTURE/api/public/albums" | jq .
# If exactly one album name matches this event folder, use its slug. If several
# match or none do, STOP and ask the user which album this is.

# Already-present photos for that album (filenames only; [] = uploaded, untagged):
curl -s "$APERTURE/api/public/albums/<slug>/sorted" | jq '.photos | keys'
```

**Skip-set = keys of local `tags.json` ∪ keys from the `/sorted` response.** Exclude those
filenames from triage and from the to-read list entirely. Only brand-new raw files get
processed. If the skip-set already covers every raw file, there's nothing to do — report that.

> The `/sorted` and `/albums` endpoints are rate-limited (~30 req/min). One call each is
> plenty — don't poll.

## Layout

```
Albums/<Event>/[Raw]/            ← operator drops raw photos here (READ this)
Albums/<Event>/Sorted/tags.json  ← you WRITE this (the manifest)
Albums/<Event>/Sorted/<teamnum>/ ← you WRITE these (symlink aliases, never copies)
```
Work with `Albums/<Event>/` as the current directory.

## Why it's cheap (token facts)

Claude bills an image by **pixels**: `⌈w/28⌉ × ⌈h/28⌉` visual tokens (Haiku caps at 1568).
- A 5×5 **contact sheet** classifies ~25 photos for ~1,568 tokens (~63/photo) instead of
  ~1,196 each. ~20× cheaper for triage. Skipping crowd shots then avoids the expensive read.
- **Format is irrelevant to tokens** — WebP saves nothing and can smear plate digits. Keep
  JPEG; resize to 720p (1280 px long edge). Convert HEIC → JPEG only so the model can read it.
- Plate digits are unreadable at thumbnail size — that is why plate-reading happens at full
  720p, and why only **high-confidence non-robot** photos are skipped.

## Read a plate (the core judgment, used everywhere)

View the 720p copy. Record EVERY plate visible, **UPPERCASE**, matching `^[0-9]{1,5}[A-Z]?$`
(`229V`, `1234A`, `5588B`, `98`). Reject all-zero (`000`). Never guess a blurry plate —
re-view that one photo at higher res (`sips -Z 2000 …`) or leave it out.

## Workflow

### 0. Make 720p working copies (keep JPEG; HEIC → JPEG)
Only make copies for files **not in the skip-set** from the resume check — already-sorted
photos are never re-processed.
```bash
mkdir -p .work Sorted
for f in "[Raw]"/*; do
  base="$(basename "$f")"
  # Skip if this filename is already in Sorted/tags.json (or the site's /sorted set).
  if [ -f Sorted/tags.json ] && jq -e --arg k "$base" '.photos | has($k)' Sorted/tags.json >/dev/null; then
    continue
  fi
  sips -s format jpeg -Z 1280 "$f" --out ".work/${base%.*}.jpg" >/dev/null
done
```

### 1. Triage on contact sheets
Build labeled 5×5 grids of the `.work/` copies (drop to `4 4` or `3 3` if cells are too
small to tell robot from crowd), then look at each sheet:
```bash
python3 "<this skill's folder>/contact_sheet.py" .work .work/sheets 5 5
```
For every cell (identified by its printed filename label), classify:
`robot` · `non-robot HIGH` · `non-robot MEDIUM` · `non-robot LOW`.

- **`non-robot HIGH`** → record now as untagged `[]`. Do NOT read it further.
- **`robot`, `non-robot MEDIUM`, `non-robot LOW`** → add to the **to-read list** (uncertain
  cases get a proper full-res look; a small/distant robot must not be dropped on a guess).

### 2. Fan out the to-read list to 5–8 subagents
Split the to-read filenames into 5–8 roughly equal chunks and spawn one subagent per chunk
(in Claude Code, the Task tool; in Codex, needs `multi_agent = true`). Give each subagent:

> Tag competition robot photos. For each filename below, open its copy at `.work/<file>` and
> read EVERY VEX team license-plate number visible — format `^[0-9]{1,5}[A-Z]?$`, uppercase; a
> photo may show several robots. View 3–4 at a time. Return ONLY compact JSON mapping each
> filename to its team array, `[]` if no readable plate. Do not write any files.
> Files: `<chunk>`

**Subagents return JSON; they never write `tags.json`** (parallel writes corrupt it).

### 3. Merge, alias, verify (main agent only)
Merge every subagent's JSON with the `non-robot HIGH` `[]` entries into `Sorted/tags.json`
(keys are the original `[Raw]/` filenames). **Preserve any pre-existing entries** from a
prior day/person — union the new results on top; never drop keys you didn't process this run.
Then build the aliases — symlinks, never copies:
```bash
# per "file → [teams]", for each team:
mkdir -p "Sorted/<TEAM>"
ln -sfn "../../[Raw]/<FILE>" "Sorted/<TEAM>/<FILE>"   # ../../ : Sorted/<TEAM>/ is 2 levels down
```
Run the checklist, report the summary, then delete `.work/`.

## tags.json format (exact)
```json
{
  "event": "Shenzhen Regional 2025",
  "photos": {
    "IMG_0142.jpg": ["5588B", "7700H"],
    "IMG_0143.jpg": ["5588B"],
    "IMG_0210.jpg": []
  }
}
```
Keys = exact `[Raw]/` filenames. Values = deduped uppercase teams, `[]` = untagged.

## Checklist — run before done
```bash
# 1. Every raw file is a key (MUST be empty):
comm -23 <(cd "[Raw]" && ls | sort) <(jq -r '.photos|keys[]' Sorted/tags.json | sort)
# 2. No key without a real file (MUST be empty):
comm -13 <(cd "[Raw]" && ls | sort) <(jq -r '.photos|keys[]' Sorted/tags.json | sort)
# 3. Every team token well-formed (MUST be empty):
jq -r '.photos[][]' Sorted/tags.json | grep -vE '^[0-9]{1,5}[A-Z]?$'
# 4. Summary to report:
jq -r '"photos: \(.photos|length)  tagged: \([.photos[]|select(length>0)]|length)  teams: \([.photos[][]]|unique|length)"' Sorted/tags.json
```

## Handing off to the site
The operator publishes by opening the album's **Import** page on the Aperture site and
dropping (1) every `[Raw]/` photo into the photos box and (2) `Sorted/tags.json` into the
tags box. Photos are downscaled in the browser before upload; tagging matches on filename,
so re-uploading photos already present just updates them. You only produce `Sorted/tags.json`
— you don't upload.

## Common mistakes
| Mistake | Fix |
|--------|-----|
| Converting to WebP "for tokens" | Tokens are per-pixel. Resize instead; keep JPEG. |
| Reading crowd shots at full res | Triage them on the contact sheet; skip `non-robot HIGH`. |
| Skipping a `MEDIUM`/`LOW` photo | Only `HIGH` non-robot is skipped; the rest get a full read. |
| Subagents writing `tags.json` | They return JSON; only the main agent writes the file. |
| Recording the `.work/` filename | Always key by the original `[Raw]/` filename. |
| Copying files into `Sorted/<team>/` | Use `ln -s` aliases; never copy the large originals. |
| Guessing a blurry plate | Re-view that one photo at higher res, or leave it out. |

## When aliases or subagents aren't available
- No `ln -s`: skip the `Sorted/<team>/` folders — `Sorted/tags.json` alone is the source of
  truth the importer reads.
- No subagents (single agent): do steps 1 and 3 yourself, reading the to-read list in
  batches of 3–4 between triage and merge.
