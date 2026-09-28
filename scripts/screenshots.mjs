/* High-resolution README screenshots against scripts/demo.py.
 *
 *   docker network create shots-net
 *   docker run -d --name mailbroom-demo --network shots-net \
 *     -v "$PWD":/repo ghcr.io/mclgoerg/mailbroom:latest \
 *     python /repo/scripts/demo.py
 *   docker run --rm --network shots-net -v "$PWD":/repo -w /tmp node:26 \
 *     bash -c "apt-get update -q && apt-get install -yq chromium \
 *       fonts-noto-color-emoji fonts-noto-core && npm i -s puppeteer-core \
 *       && node /repo/scripts/screenshots.mjs http://mailbroom-demo:8765"
 *
 * Output: docs/screenshots/*.png at 2x device scale (2880×1800).
 */

import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://127.0.0.1:8765";
const OUT = "/repo/docs/screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars",
         "--force-color-profile=srgb"],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fresh(storage = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((items) => {
    for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
  }, { pmc_account: "proton", ...storage });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await page.waitForSelector("[data-gidx]", { timeout: 20000 });
  await sleep(700);                       // let counts/status settle
  return page;
}

async function clickHeaderButton(page, emoji) {
  await page.evaluate((e) => {
    const btn = [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim().startsWith(e));
    btn?.click();
  }, emoji);
}

// 1) Hero: the group table, dark sandy theme.
let page = await fresh();
await page.screenshot({ path: `${OUT}/groups-dark.png` });
console.log("groups-dark.png");

// 2) Group drill-down (keyboard: focus first row, open).
await page.keyboard.press("j");
await page.keyboard.press("Enter");
await page.waitForFunction(
  () => document.body.innerText.includes("Trash selected"),
  { timeout: 15000 });
await sleep(700);
await page.screenshot({ path: `${OUT}/detail.png` });
console.log("detail.png");
await page.close();

// 3) Statistics panel (own page - cleaner than closing the modal).
page = await fresh();
await clickHeaderButton(page, "📊");
await page.waitForFunction(
  () => document.body.innerText.toLowerCase().includes("top senders"),
  { timeout: 15000 });
await sleep(700);
await page.screenshot({ path: `${OUT}/stats.png` });
console.log("stats.png");
await page.close();

// 4) Hero again in the light theme.
page = await fresh({ pmc_theme: "light" });
await page.screenshot({ path: `${OUT}/groups-light.png` });
console.log("groups-light.png");

await browser.close();
