/* README demo GIF: the main workflow in eight frames - list, filter builder,
 * a condition added, filtered list, select, confirm, result toast with Undo,
 * group in the split pane - assembled with ffmpeg at 1280 px wide.
 *
 * Same demo setup as screenshots.mjs (see its header for the demo
 * container). This script really trashes mails in the demo, so use a FRESH
 * demo container for each run (docker rm -f mb-docs-demo; start it again).
 *
 *   docker run --rm --network mb-docs-net -v "$PWD":/repo -w /tmp node:26 \
 *     bash -c "apt-get update -q && apt-get install -yq --no-install-recommends \
 *       chromium ffmpeg fonts-noto-color-emoji fonts-noto-core || exit 1; \
 *       mkdir rig && cd rig && npm i -s puppeteer-core \
 *       && cp /repo/scripts/*.mjs . && node demo-gif.mjs \
 *            http://mb-docs-demo:8765 \
 *       && cp out/demo.gif /repo/docs/screenshots/ \
 *       && chown $(id -u):$(id -g) /repo/docs/screenshots/demo.gif"
 *
 * Frames are captured at 1280x800 with deviceScaleFactor 2 and scaled down
 * to 1280 px wide by ffmpeg (crisper text than a 1x capture). Optional
 * OUT=<dir> overrides the output folder.
 */
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  byRole, click, dismissNotice, hideCaret, launch, open, openGroup, settle,
  sleep, waitText,
} from "./capture-lib.mjs";

const BASE = process.argv[2] ?? "http://127.0.0.1:8765";
const OUT = process.env.OUT ?? "out";
const FRAMES = `${OUT}/frames`;
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const browser = await launch();
const page = await open(browser, BASE, { width: 1280, height: 800, scale: 2 });
await dismissNotice(page);
await settle(page);

let n = 0;
const shot = async (what) => {
  await hideCaret(page);
  await sleep(300);
  await page.screenshot({ path: `${FRAMES}/f${String(++n).padStart(2, "0")}.png` });
  console.log("frame", n, what);
};

await shot("1 group list");

await click(page, "button", "Build a filter - click conditions together");
await byRole(page, "button", "Done");
await shot("2 filter builder");

// The builder's "Category" row (newsletter is preselected): its Add button.
const addCategory = await page.evaluateHandle(() => {
  const isAdd = (b) => b.textContent.trim() === "Add";
  let row = [...document.querySelectorAll("select")]
    .find((sel) => [...sel.options].some((o) => o.value === "newsletter"));
  while (row && ![...row.querySelectorAll("button")].some(isAdd))
    row = row.parentElement;
  return [...row.querySelectorAll("button")].find(isAdd);
});
await addCategory.asElement().click();
await page.waitForFunction(
  (ph) => document.querySelector(`input[placeholder="${ph}"]`)
    ?.value.includes("newsletter"), { timeout: 10000 }, "filter groups…");
await settle(page);
await shot("3 condition added, list filtered");

await click(page, "button", "Done");
await settle(page);
await shot("4 filtered list");

// Header checkbox: select every group in the filtered list.
await page.click('thead input[type="checkbox"]');
const trash = await byRole(page, "button", /^Trash \d+$/);
await settle(page);
await shot("5 selection bar");

await trash.click();
await byRole(page, "dialog", /Trash/);
await settle(page);
await shot("6 confirm dialog");

const confirm = await byRole(page, "button", /^Move to Trash \(\d+\)$/);
await confirm.click();
await waitText(page, /Moved \d+ mails? to Trash/);
await byRole(page, "button", "Undo");
// The trashed groups are gone: drop the filter so the toast sits over the
// rest of the list instead of an empty result.
await click(page, "button", "Clear filter");
await settle(page);
await shot("7 result toast with undo");

await click(page, "button", "Dismiss");  // keep the toast off the pane footer
await openGroup(page, "PayBank");       // beside the list (>= 1280 px)
await shot("8 group in the split pane");
await browser.close();

// ffmpeg: ~1.8 s per frame, a palette tuned to the frames, 1280 px wide.
const frames = readdirSync(FRAMES).length;
execFileSync("ffmpeg", [
  "-y", "-v", "error", "-framerate", "1/1.8", "-i", `${FRAMES}/f%02d.png`,
  "-vf", "scale=1280:-1:flags=lanczos,split[a][b];"
    + "[a]palettegen=max_colors=256:stats_mode=diff[p];"
    + "[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
  "-loop", "0", `${OUT}/demo.gif`,
], { stdio: "inherit" });
console.log(`demo.gif (${frames} frames)`);
