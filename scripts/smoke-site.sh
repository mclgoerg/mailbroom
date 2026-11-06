#!/usr/bin/env bash
# Smoke test of a deployed (or locally served) inboxrake.com tree.
#
#   scripts/smoke-site.sh [BASE_URL]      default https://inboxrake.com
#
# Checks the three parts answer, that the demo bundle is served with the
# headers its worker depends on, and logs what really goes over the wire.
# Exit 1 on the first failed check.
set -euo pipefail

BASE="${1:-https://inboxrake.com}"
BASE="${BASE%/}"
fail() { echo "::error::smoke test: $*"; exit 1; }
ok() { echo "ok: $*"; }

# status + headers (lower-cased names) of a GET, body discarded
head_of() { curl -sS -o /dev/null -D - -H 'Accept-Encoding: br, gzip' "$BASE$1" | tr -d '\r' | tr 'A-Z' 'a-z'; }
status() { sed -n 1p | awk '{print $2}'; }
header() { sed -n "s/^$1: *//p" | head -1; }

# --- the three parts -------------------------------------------------------
body=$(curl -sS --fail -L "$BASE/") || fail "GET / failed"
grep -q "Inboxrake" <<<"$body" || fail "/ does not contain \"Inboxrake\""
grep -q 'href="/demo/"' <<<"$body" || fail '/ has no "Try the demo" link'
ok "/ is 200 and mentions Inboxrake"
for p in /docs/ /demo/; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE$p")
  [ "$code" = 200 ] || fail "$p answered $code"
  ok "$p is 200"
done
for p in /docs/no-such-page-$$/ /no-such-page-$$/; do
  code=$(curl -sS -o /tmp/smoke-404.$$ -w '%{http_code}' "$BASE$p")
  [ "$code" = 404 ] || fail "unknown path $p answered $code, expected 404"
  [ -s /tmp/smoke-404.$$ ] || fail "the 404 for $p has an empty body"
done
rm -f /tmp/smoke-404.$$
ok "unknown paths are 404 with a page"

cc=$(header cache-control <<<"$(head_of /demo/)")
[ "$cc" = "no-cache" ] || fail "/demo/ Cache-Control is \"$cc\", expected exactly \"no-cache\""
ok "/demo/: Cache-Control: no-cache"

# --- the demo bundle's headers ---------------------------------------------
h=$(head_of /demo/bundle/manifest.json)
[ "$(status <<<"$h")" = 200 ] || fail "manifest.json is not 200"
cc=$(header cache-control <<<"$h")
# EXACTLY no-cache: the _headers `!` override must not join with the immutable rule
[ "$cc" = "no-cache" ] || fail "manifest.json Cache-Control is \"$cc\", expected exactly \"no-cache\""
ok "manifest.json: Cache-Control: no-cache"

manifest=$(curl -sS --fail "$BASE/demo/bundle/manifest.json")
files=$(node -e '
  const m = JSON.parse(require("fs").readFileSync(0, "utf8"));
  for (const f of m.files) console.log(`${f.path} ${f.bytes}`);
' <<<"$manifest")
[ -n "$files" ] || fail "manifest.json lists no files"

check_file() { # path expected-content-type-regex
  local hh ct cache
  hh=$(head_of "/demo/bundle/$1")
  [ "$(status <<<"$hh")" = 200 ] || fail "bundle file $1 is not 200"
  ct=$(header content-type <<<"$hh"); cache=$(header cache-control <<<"$hh")
  [[ "$ct" =~ $2 ]] || fail "$1 Content-Type is \"$ct\", expected $2"
  [[ "$cache" == *immutable* && "$cache" == *max-age=31536000* ]] \
    || fail "$1 Cache-Control is \"$cache\", expected a year + immutable (else the worker's prefetch is wasted and every file downloads twice)"
  ok "$1: $ct, $cache"
}
wasm=$(node -e 'const m=JSON.parse(process.argv[1]);console.log(m.pyodide.dir+"/pyodide.asm.wasm")' "$manifest")
check_file "$wasm" '^application/wasm'
check_file "$(node -e 'console.log(JSON.parse(process.argv[1]).app)' "$manifest")" '^application/(zip|octet-stream|x-zip)'

# a hashed UI asset is immutable too
asset=$(curl -sS "$BASE/demo/" | grep -o '/demo/assets/[^"]*\.js' | head -1)
[ -n "$asset" ] || fail "/demo/ references no /demo/assets/*.js"
cc=$(header cache-control <<<"$(head_of "$asset")")
[[ "$cc" == *immutable* ]] || fail "$asset Cache-Control is \"$cc\", expected immutable"
ok "$asset: $cc"

doc=$(curl -sS "$BASE/docs/" | grep -o '/docs/_astro/[^"]*\.\(js\|css\)' | head -1)
[ -n "$doc" ] || fail "/docs/ references no /docs/_astro/ asset"
cc=$(header cache-control <<<"$(head_of "$doc")")
[[ "$cc" == *immutable* ]] || fail "$doc Cache-Control is \"$cc\", expected immutable"
ok "$doc: $cc"

# --- sizes on the wire (brotli, as a browser asks) --------------------------
echo "wire sizes (Accept-Encoding: br, gzip):"
total=0
while read -r path raw; do
  read -r wire enc < <(curl -sS -o /dev/null -H 'Accept-Encoding: br, gzip' \
    -w '%{size_download} %header{content-encoding}\n' "$BASE/demo/bundle/$path")
  printf '  %9d raw %9d wire  %-4s %s\n' "$raw" "$wire" "${enc:--}" "$path"
  total=$((total + wire))
done <<<"$files"
echo "  total on the wire: $total bytes"
# the bundle budget (scripts/demo-bundle/build.mjs) assumed brotli q9
if [ "$total" -gt 10000000 ]; then
  echo "::warning::demo bundle is $total bytes on the wire, over the 10 MB budget (Cloudflare's compression may be weaker than the brotli q9 the budget assumed)"
fi
echo "smoke test passed for $BASE"
