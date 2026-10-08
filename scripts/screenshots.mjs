/* High-resolution README screenshots against scripts/demo.py.
 *
 * Run from the repo root. The demo needs a writable /data and read access to
 * the checkout (repo files are mode 600), hence --user and the tmpfs; build
 * the frontend first if you want your working tree's UI instead of the
 * release image's bundle (drop the STATIC_DIR line to use the image's).
 *
 *   (cd frontend && npm ci && npx vite build)
 *   docker network create mb-docs-net
 *   docker run -d --name mb-docs-demo --network mb-docs-net \
 *     --user "$(id -u):$(id -g)" -e HOME=/tmp \
 *     --tmpfs /data:uid=$(id -u),gid=$(id -g) \
 *     -v "$PWD":/repo:ro -e STATIC_DIR=/repo/frontend/dist \
 *     ghcr.io/mclgoerg/mailbroom:latest python /repo/scripts/demo.py
 *   docker run --rm --network mb-docs-net -v "$PWD":/repo -w /tmp node:26 \
 *     bash -c "apt-get update -q && apt-get install -yq chromium \
 *       fonts-noto-color-emoji fonts-noto-core \
 *       && mkdir rig && cd rig && npm i -s puppeteer-core \
 *       && cp /repo/scripts/*.mjs . && node screenshots.mjs \
 *            http://mb-docs-demo:8765 \
 *       && cp /tmp/rig/out/*.png /repo/docs/screenshots/"
 *   docker rm -f mb-docs-demo
 *
 * The colour-emoji font is required: without it the emoji in the rows
 * render as empty boxes. Start from a fresh demo container (the demo keeps
 * state in memory, e.g. a dismissed notice or a trashed group).
 * Output: PNGs in ./out at 2x device scale (mobile.png: three 3x phones).
 * Optional OUT=<dir> overrides the output folder.
 */

import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import {
  byRole, click, dismissNotice, hideCaret, launch, open, openGroup, settle,
  sleep, waitText,
} from "./capture-lib.mjs";

const BASE = process.argv[2] ?? "http://127.0.0.1:8765";
const OUT = process.env.OUT ?? "out";
mkdirSync(OUT, { recursive: true });

const browser = await launch();
const save = async (page, name) => {
  await hideCaret(page);
  await page.screenshot({ path: `${OUT}/${name}` });
  console.log(name);
};

/** Quick chips cycle filter -> select, so two taps leave the matches ticked. */
const selectViaChip = async (page, chip) => {
  await click(page, "button", chip);
  await click(page, "button", chip);
  await byRole(page, "button", /^Trash \d+$/);        // the bulk bar is up
  await settle(page);
};

// 1) Hero: the group list, dark.
let page = await open(browser, BASE, { width: 1440, height: 900, scale: 2 });
await dismissNotice(page);
await settle(page);
await save(page, "groups-dark.png");
await page.close();

// 2) Same, light theme.
page = await open(browser, BASE, {
  width: 1440, height: 900, scale: 2, theme: "light",
});
await dismissNotice(page);
await settle(page);
await save(page, "groups-light.png");
await page.close();

// 3) Split pane (>= 1280 px): a group beside the list.
page = await open(browser, BASE, { width: 1440, height: 900, scale: 2 });
await dismissNotice(page);
await openGroup(page, "PayBank");
await save(page, "split-pane.png");
await page.close();

// 4) Drill-down as the modal (below the split-pane breakpoint).
page = await open(browser, BASE, { width: 1024, height: 768, scale: 2 });
await dismissNotice(page);
await openGroup(page, "PayBank");
await save(page, "detail.png");
await page.close();

// 5) Statistics, via the Tools menu.
page = await open(browser, BASE, { width: 1440, height: 900, scale: 2 });
await dismissNotice(page);
await click(page, "button", "Tools");
await click(page, "menuitem", "Statistics");
await waitText(page, /top (senders|domains)/i);
await settle(page);
await save(page, "stats.png");
await page.close();

// 6) Phone: list, a group's details, the confirm sheet - composed below.
const PHONE = { width: 390, height: 844, scale: 3, mobile: true };
const phones = [];
page = await open(browser, BASE, PHONE);
await dismissNotice(page);
await save(page, "_phone-list.png");
phones.push("_phone-list.png");
await page.close();

page = await open(browser, BASE, PHONE);
await dismissNotice(page);
await openGroup(page, "PayBank");
await save(page, "_phone-detail.png");
phones.push("_phone-detail.png");
await page.close();

page = await open(browser, BASE, PHONE);
await dismissNotice(page);
await selectViaChip(page, "AI-safe groups");
await click(page, "button", /^Trash \d+$/);
await byRole(page, "dialog", /Trash/);
await settle(page);
await save(page, "_phone-confirm.png");
phones.push("_phone-confirm.png");
await page.close();

// Compose the phones side by side on the app's dark surface colour, with
// rounded corners - laid out by a plain page, so no extra tooling.
const surface = "#171310";
const imgs = phones.map((f) =>
  `data:image/png;base64,${readFileSync(`${OUT}/${f}`).toString("base64")}`);
const sheet = await browser.newPage();
const GAP = 40, PAD = 56, W = 390, H = 844;
await sheet.setViewport({
  width: PAD * 2 + W * imgs.length + GAP * (imgs.length - 1),
  height: PAD * 2 + H, deviceScaleFactor: 2,
});
await sheet.setContent(`<body style="margin:0;background:${surface};
  display:flex;gap:${GAP}px;padding:${PAD}px">${imgs.map((src) =>
  `<img src="${src}" width="${W}" height="${H}" style="border-radius:36px;
   box-shadow:0 0 0 1px #3a2f25">`).join("")}</body>`);
await sheet.evaluate(() => Promise.all(
  [...document.images].map((i) => i.decode())));
await sheet.screenshot({ path: `${OUT}/mobile.png` });
console.log("mobile.png");
await sheet.close();
phones.forEach((f) => unlinkSync(`${OUT}/${f}`));

await browser.close();
