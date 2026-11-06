# Demo end-to-end

Playwright run of the built in-browser demo in headless Chromium: the boot
screen's steps, the first `/api/state`, Trash and Undo through the real UI,
and the job endpoints (scan, delete, undo) called directly. A backend call
that waits on a thread hangs the demo's single-threaded worker, so every test
has a time limit and a hang fails cleanly instead of stalling CI.
Dev-only; nothing here ships in the app image.

    (cd ../demo-bundle && npm ci)
    (cd ../../frontend && npm ci && npm run build:demo)
    node ../demo-bundle/build.mjs --out /tmp/demo-bundle --ui ../../frontend/dist-demo
    npm ci && npx playwright install chromium
    DEMO_UI=../../frontend/dist-demo DEMO_BUNDLE=/tmp/demo-bundle npx playwright test

`serve.mjs` serves them on 127.0.0.1 laid out like the deploy (`/demo/` the UI,
`/demo/bundle/` the bundle). `CHROME_PATH` points Playwright at an installed
Chromium instead of its own. `@fast` in a test title marks the boot + state
subset (`npx playwright test --grep @fast`), for if the full run ever gets
too slow; today it takes about 25 s, so CI runs all of it.
