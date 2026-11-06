#!/usr/bin/env bash
# Assembles the whole inboxrake.com static tree (what the deploy uploads):
#
#   <out>/                landing page  (website/dist-landing, built with the demo button)
#   <out>/_headers        Cloudflare response headers (website/public/_headers)
#   <out>/docs/           documentation (website/dist)
#   <out>/demo/           the in-browser demo UI (frontend/dist-demo)
#   <out>/demo/bundle/    Pyodide + app + seed (scripts/demo-bundle output)
#
#   scripts/build-site.sh [--out DIR] [--bundle DIR]
#
# --out     default site-dist at the repo root (git-ignored)
# --bundle  use an already built demo bundle instead of building one
#
# Needs `npm ci` done in website/, frontend/ and scripts/demo-bundle/, and
# (unless --bundle) the backend's Python dependencies on python3 / $PYTHON.
# Ends with check_tree: any piece missing or mis-placed fails the build, so a
# broken tree can never reach the deploy step.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$REPO/site-dist"
BUNDLE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$(realpath -m "${2:?--out needs a value}")"; shift 2 ;;
    --bundle) BUNDLE="$(realpath "${2:?--bundle needs a value}")"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

die() { echo "build-site: $*" >&2; exit 1; }

# Cloudflare Workers static assets limits (free plan): 20 000 files, 25 MiB
# per file, 100 header rules, 2000 characters per header line.
MAX_FILES=20000
MAX_FILE_BYTES=$((25 * 1024 * 1024))

check_tree() {
  local t="$1" f n
  for f in index.html 404.html favicon.svg _headers docs/index.html docs/404.html \
           demo/index.html demo/bundle/manifest.json; do
    [ -f "$t/$f" ] || die "missing $f in the assembled tree"
  done
  [ -d "$t/landing-assets" ] || die "missing landing-assets/ (landing page CSS/images)"
  [ -d "$t/docs/_astro" ] || die "missing docs/_astro/ (docs CSS/JS)"
  [ -d "$t/demo/assets" ] || die "missing demo/assets/ (demo JS/CSS and worker)"

  grep -q "Inboxrake" "$t/index.html" || die "landing page does not mention Inboxrake"
  grep -q 'href="/demo/"' "$t/index.html" \
    || die 'landing page has no "Try the demo" link (INBOXRAKE_DEMO_LIVE=1 not applied?)'
  grep -q "/demo/assets/" "$t/demo/index.html" \
    || die "demo/index.html does not load /demo/assets/ (built without --base /demo/?)"
  grep -q 'href="/docs/' "$t/docs/index.html" || die "docs are not rooted at /docs/"

  # _headers only works at the root; one anywhere else would be a dead copy
  n=$(find "$t" -name _headers -not -path "$t/_headers" | wc -l)
  [ "$n" -eq 0 ] || die "stray _headers file(s) below the root"
  for f in "/demo/bundle/*" "/demo/assets/*" "/docs/_astro/*" "/demo/bundle/manifest.json"; do
    grep -qxF "$f" "$t/_headers" || die "_headers has no rule for $f"
  done
  [ "$(grep -c '^/' "$t/_headers")" -le 100 ] || die "_headers has over 100 rules"
  [ "$(awk '{ if (length($0) > m) m = length($0) } END { print m + 0 }' "$t/_headers")" -le 2000 ] \
    || die "_headers has a line over 2000 characters"

  # every file the manifest lists exists, and the entry points it names too
  node - "$t/demo/bundle" <<'JS' || die "demo bundle does not match its manifest"
const fs = require("node:fs"), path = require("node:path");
const dir = process.argv[2];
const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
const need = [m.app, m.seed, ...m.files.map((f) => f.path)];
const missing = need.filter((p) => !fs.existsSync(path.join(dir, p)));
if (!m.files.length || missing.length) {
  console.error("manifest lists missing files:", missing.slice(0, 5));
  process.exit(1);
}
for (const f of ["pyodide.asm.wasm", "pyodide.mjs"]) {
  if (!m.files.some((x) => x.path === `${m.pyodide.dir}/${f}`)) {
    console.error(`manifest does not list ${f}`); process.exit(1);
  }
}
JS

  n=$(find "$t" -type f | wc -l)
  [ "$n" -le "$MAX_FILES" ] || die "$n files, over the $MAX_FILES Workers assets limit"
  f=$(find "$t" -type f -size +"$MAX_FILE_BYTES"c | head -1)
  [ -z "$f" ] || die "$f is over the 25 MiB per-file Workers assets limit"
  echo "tree ok: $n files, $(du -sh "$t" | cut -f1)"
}

echo "== landing + docs"
rm -rf "$REPO/website/dist" "$REPO/website/dist-landing"
(cd "$REPO/website" && INBOXRAKE_DEMO_LIVE=1 npm run build)

echo "== demo UI"
rm -rf "$REPO/frontend/dist-demo"
(cd "$REPO/frontend" && npm run build:demo)

if [ -z "$BUNDLE" ]; then
  echo "== demo bundle"
  BUNDLE="$(mktemp -d)"
  trap 'rm -rf "$BUNDLE"' EXIT
  node "$REPO/scripts/demo-bundle/build.mjs" --out "$BUNDLE"
fi

echo "== assemble $OUT"
rm -rf "$OUT"
mkdir -p "$OUT/docs" "$OUT/demo/bundle"
cp -R "$REPO/website/dist-landing/." "$OUT/"
cp -R "$REPO/website/dist/." "$OUT/docs/"
cp -R "$REPO/frontend/dist-demo/." "$OUT/demo/"
cp -R "$BUNDLE/." "$OUT/demo/bundle/"
# unknown paths outside /docs/ get the docs' (root-absolute, self-contained) 404 page
cp "$OUT/docs/404.html" "$OUT/404.html"
# the docs build brings its own copy of public/_headers; only the root one counts
rm -f "$OUT/docs/_headers" "$OUT/demo/_headers"
check_tree "$OUT"
