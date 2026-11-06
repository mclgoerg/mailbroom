# Demo bundle

Builds the static files the in-browser demo (the real backend on Pyodide, in
a Web Worker) loads. Dev-only tooling: nothing here ships in the app image.

    npm ci
    node build.mjs --out dist      # needs a Python with backend/requirements.txt
    node smoke.mjs dist            # boots the bundle in Pyodide, Trash + Undo

`build.mjs` prints a per-file size table and exits 1 above the budget (10 MB
estimated on the wire: brotli q9 for wasm/js/css/html/json, zips and wheels as
they are). Pass `--ui ../../frontend/dist-demo` to count the demo UI build
(page, scripts, worker) too: the budget is for the whole first visit, and CI
does. The headroom is small (about 0.25 MB), and the figure assumes brotli
level 9; check the real on-the-wire sizes once the site is live (Cloudflare may
compress at a lower level).

CI (`.github/workflows/demo-bundle.yml`) runs on every PR that touches
backend, frontend, tests or the demo scripts, and on `main`/tags:

- the backend test suite on Pyodide's Python and package versions
  (`pyodide-pins.mjs` reads them from the pinned Pyodide's lockfile, and
  checks `backend/requirements.in` for packages Pyodide lacks),
- this build with the size budget, twice, to prove it is reproducible,
- `smoke.mjs` and the headless-browser run in `../demo-e2e/`
  (page + worker + bundle in Chromium: boot, first `/api/state`, Trash and
  Undo through the UI, scan/delete/undo over the API; about 25 s),

and uploads the bundle as an artifact.

## What comes out

    manifest.json                  entry points + sizes (cache: no-cache)
    pyodide-<ver>-<hash>/          runtime, trimmed lockfile, 10 wheels
    app.<hash>.zip                 backend, tests/conftest.py, the demo scripts
    seed.<hash>.zip                the pre-built demo mailboxes

Every path but `manifest.json` carries a content hash: `Cache-Control:
public, max-age=31536000, immutable`. The worker reads the manifest, then:

    loadPyodide({ indexURL: base + manifest.pyodide.dir + "/" })
    loadPackage(manifest.pyodide.roots)
    unpackArchive(app zip -> /app), unpackArchive(seed zip -> /app/seed)
    import demo_glue; demo_glue.boot(); await demo_glue.request(...)

(`scripts/demo_glue.py`; `smoke.mjs` is a working example.)

## Decisions

- **One Pyodide pin:** `dependencies.pyodide` in `package.json`, exact. A bump
  is that line plus `npm install`; `build.mjs` refuses to run if `node_modules`
  disagrees. The runtime comes from the npm package, the wheels from Pyodide's
  release CDN (checked against the lockfile's sha256, cached in
  `node_modules/.cache`). A new Pyodide usually means a new Python minor: check
  the backend still runs on it (`smoke.mjs`) before merging.
- **10 packages, not 18:** the roots (fastapi, pydantic) minus `httpx` and
  `jinja2`; `cryptography` stays out (backend/demo.py's Fernet stand-in).
- **Bytecode only:** every pure-Python file of the wheels and the app is
  compiled by Pyodide's own Python to an unchecked-hash `.pyc` (no `.py`, no
  docstrings, `assert` kept). It saves about 1.6 s of imports at boot.
- **Reproducible:** zips have sorted entries and fixed timestamps; the seed is
  built with `DEMO_NOW` pinned to a fixed instant, which also stops the clock
  and fixes the random bytes while it is generated (`demo.py build`).
  The browser shifts its clock back to that instant on load
  (`demo_seed.set_clock`), so ages stay as designed however old the bundle is.

## The page that loads it

The UI side is `frontend/src/demo/` (boot screen, banner, the worker, the
`window.fetch` intercept). `npm run build:demo` in `frontend/` builds it
(`vite build --mode demo --base /demo/`, output `dist-demo/`); the deploy puts
this bundle's output at `/demo/bundle/` next to it:

    /demo/index.html, /demo/assets/*   the UI + the hashed worker
    /demo/bundle/manifest.json, ...    what `build.mjs` wrote

Cache headers for those paths are in `website/public/_headers`.
