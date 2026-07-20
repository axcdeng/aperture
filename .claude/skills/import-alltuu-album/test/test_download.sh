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
#     entries, one already on disk. The missing one points at a dead host.
mkdir -p "$TMP/album"
printf '\xff\xd8\xffdummy' > "$TMP/album/EXISTS.JPG"
cat > "$TMP/urls.json" <<'JSON'
[{"n":"EXISTS.JPG","bl":"https://127.0.0.1:1/never","os":"10"},
 {"n":"NOPE.JPG","bl":"https://127.0.0.1:1/never","os":"10"}]
JSON
out="$("$DL" "$TMP/urls.json" "$TMP/album" -j 2 2>/dev/null)"
echo "$out" | grep -q 'skipped=1' ; check "skips existing" "$?" "0"
[ -f "$TMP/album/EXISTS.JPG" ] ; check "existing untouched" "$?" "0"

# --- Fixture B: JPEG validation. A failed download must not be saved.
[ ! -f "$TMP/album/NOPE.JPG" ] ; check "bad download not saved" "$?" "0"
echo "$out" | grep -q 'failed=1' ; check "counts failure" "$?" "0"

# --- Fixture C: real fetch (network). Known-good signed bl (1600px) URL.
BL='https://uib.alltuu.com/ml/pl1eLOA3s76.jpg?Expires=1788135304&OSSAccessKeyId=LTAI5tCKgYFjLSzev9mGY4Vs&Signature=mPlJaN8g6JFrnEXPrPdgskghBAA%3D&response-content-disposition=attachment%3Bfilename%3DDS889828-4820361589.jpg&response-content-type=image%2Fjpeg'
cat > "$TMP/urls2.json" <<JSON
[{"n":"DS889828.JPG","bl":"$BL","os":"538117"}]
JSON
"$DL" "$TMP/urls2.json" "$TMP/album" -j 1 >/dev/null 2>&1
if [ -f "$TMP/album/DS889828.JPG" ]; then
  # od's column spacing differs between BSD (macOS) and GNU (Linux); strip
  # spaces before matching so the magic-byte check is portable.
  head -c 3 "$TMP/album/DS889828.JPG" | od -An -tx1 | tr -d ' ' | grep -qi 'ffd8ff' ; check "real jpeg saved" "$?" "0"
else echo "SKIP: network fetch (offline?)"; fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
