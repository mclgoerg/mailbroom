/* README demo GIF: one frame per step (filter builder -> filtered ->
 * AI-safe selection -> group drill-down), assembled with ffmpeg.
 *
 *   docker run -d --name mailbroom-demo --user "$(id -u)" -v "$PWD":/repo \
 *     ghcr.io/mclgoerg/mailbroom:latest python /repo/scripts/demo.py
 *   docker run --rm -v /tmp/frames:/frames -w /tmp node:26 bash -c \
 *     "apt-get update -q && apt-get install -yq chromium ffmpeg \
 *       fonts-noto-color-emoji fonts-noto-core && npm i -s puppeteer-core \
 *       && cp /repo/scripts/demo-gif.mjs . && node demo-gif.mjs \
 *       http://<demo-container-ip>:8765 && ffmpeg -framerate 2/3 \
 *       -i /frames/f%02d.png -vf 'scale=1100:-1:flags=lanczos,split[a][b];\
 *       [a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer' \
 *       -loop 0 /frames/demo.gif"
 */
import puppeteer from "puppeteer-core";
const BASE = process.argv[2];
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars",
         "--force-color-profile=srgb"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => {
  localStorage.setItem("pmc_account", "proton");
});
await page.goto(BASE, { waitUntil: "networkidle2" });
await page.waitForSelector("[data-gidx]", { timeout: 20000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const shot = async () => {
  await sleep(500);
  console.log(await page.evaluate(() =>
    (document.body.innerText.match(/\d+ groups[^\n]*/) || ["?"])[0]));
  await page.screenshot({ path: `/frames/f${String(++n).padStart(2, "0")}.png` });
  console.log("frame", n);
};
const clickText = (txt) => page.evaluate((t) => {
  [...document.querySelectorAll("button")]
    .find((b) => b.textContent.trim() === t || b.textContent.includes(t))
    ?.click();
}, txt);

await shot();                                   // 1 groups overview
await clickText("🧰");                          // open builder
await shot();                                   // 2 builder
await page.evaluate(() => {                     // tag:newsletter
  [...document.querySelectorAll("button")]
    .filter((b) => b.textContent.trim() === "Add")[0]?.click();
});
await shot();                                   // 3 filtered by tag
await clickText("with unsubscribe link");
await shot();                                   // 4 + is:unsub
await clickText("Done");
await shot();                                   // 5 clean filtered view
await page.evaluate(() => {                     // preset: AI-safe groups
  const sel = [...document.querySelectorAll("select")]
    .find((s) => [...s.options].some((o) => o.value === "aisafe"));
  Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype, "value").set.call(sel, "aisafe");
  sel.dispatchEvent(new Event("change", { bubbles: true }));
});
await shot();                                   // 6 AI-safe selected
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press("j");
await page.keyboard.press("Enter");
await page.waitForFunction(
  () => document.body.innerText.includes("Trash selected"),
  { timeout: 15000 });
await shot();                                   // 7 group drill-down
await browser.close();
