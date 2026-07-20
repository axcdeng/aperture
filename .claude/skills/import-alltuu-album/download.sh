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

# Build skip-set from files already on disk. (Plain file + grep instead of an
# associative array: macOS ships bash 3.2, which lacks `declare -A`.)
EXISTING="$(mktemp)"
if [ -d "$DIR" ]; then
  (cd "$DIR" && ls -1 2>/dev/null) > "$EXISTING"
fi

# TODO is NUL-delimited name/url pairs (not tab-delimited lines) so it can be
# fed to `xargs -0 -n2` below without going through -I{}'s replstr path.
TODO="$(mktemp)"
skipped=0; total=0
while IFS="$(printf '\t')" read -r name url; do
  [ -n "$name" ] || continue
  total=$((total+1))
  if grep -Fxq "$name" "$EXISTING" 2>/dev/null; then
    skipped=$((skipped+1)); continue
  fi
  printf '%s\0%s\0' "$name" "$url" >> "$TODO"
done < <(extract)

# Worker: fetch one file to a temp path, validate JPEG magic, atomic move.
fetch_one() {
  local dir="$1" name="$2" url="$3"
  local tmp
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

RESULTS="$(mktemp)"
trap 'rm -f "$TODO" "$RESULTS" "$EXISTING"' EXIT
if [ -s "$TODO" ]; then
  # -P<JOBS> concurrency. NUL-delimited, 2 items (name,url) per invocation:
  # avoids `xargs -I{}` entirely, whose replstr substitution is capped at 255
  # bytes by default on BSD/macOS xargs (`-S` in `man xargs`) — well under the
  # length of a typical signed OSS URL, which would otherwise make xargs fail
  # with "command line cannot be assembled, too long" for every real album.
  xargs -0 -n 2 -P "$JOBS" bash -c 'fetch_one "$1" "$2" "$3"' _ "$DIR" < "$TODO" > "$RESULTS"
fi

# grep -c always prints a count (even "0"), but exits 1 when the count is 0 —
# so a naive `|| echo 0` fallback would append a spurious second "0" line.
downloaded="$(grep -c '^OK' "$RESULTS" 2>/dev/null)"; downloaded="${downloaded:-0}"
failed="$(grep -c '^FAIL' "$RESULTS" 2>/dev/null)"; failed="${failed:-0}"
echo "downloaded=$downloaded skipped=$skipped failed=$failed total=$total"
if [ "$failed" -gt 0 ]; then echo "failures:"; grep '^FAIL' "$RESULTS" | cut -f2; fi
exit 0
