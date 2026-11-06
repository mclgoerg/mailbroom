# Demo bundle

Builds the static files the in-browser demo (the real backend on Pyodide, in
a Web Worker) loads. Dev-only tooling: nothing here ships in the app image.

    npm ci
    node build.mjs --out dist      # needs a Python with backend/requirements.txt
    node smoke.mjs dist            # boots the bundle in Pyodide, Trash + Undo

`build.mjs` prints a per-file size table and exits 1 above the budget (10 MB
estimated on the wire: brotli for wasm/js/html/json, zips and wheels as they
are). CI (`.github/workflows/demo-bundle.yml`) runs both on PRs that touch the
bundle's inputs, builds twice to prove the output is reproducible, and
uploads the result as an artifact.

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
