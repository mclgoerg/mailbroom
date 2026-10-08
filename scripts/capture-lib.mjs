/* Shared helpers for screenshots.mjs and demo-gif.mjs (see their headers for
 * how to run them). Everything is found by role / accessible name / visible
 * text, so the scripts survive restyling - they only break when the UI's
 * words change.
 */
import puppeteer from "puppeteer-core";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const launch = () => puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars",
         "--force-color-profile=srgb"],
});

/** New page with a pinned account, theme and language (English). */
export async function open(browser, base, {
  width, height, scale, theme = "dark", mobile = false,
}) {
  const page = await browser.newPage();
  await page.setViewport({
    width, height, deviceScaleFactor: scale, isMobile: mobile, hasTouch: mobile,
  });
  await page.evaluateOnNewDocument((th) => {
    localStorage.setItem("pmc_account", "proton");
    localStorage.setItem("pmc_theme", th);
    localStorage.setItem("pmc_lang", "en");
    localStorage.setItem("pmc_view", "groups");
  }, theme);
  await page.goto(base, { waitUntil: "networkidle2" });
  await page.waitForSelector("[data-gidx]", { timeout: 30000 });
  await settle(page);
  return page;
}

/** Quiet page: no spinners, no running job strip, fonts and layout done. */
export async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(
    () => !document.querySelector('[role="status"][aria-label]'
      + ', [role="progressbar"]'), { timeout: 30000 });
  await sleep(400);
}

/** The visible element with this role whose accessible name matches `name`
 *  (string = exact, RegExp = test). */
export async function byRole(page, role, name, timeout = 15000) {
  const sel = {
    button: "button", tab: '[role="tab"]', menuitem: '[role="menuitem"]',
    checkbox: 'input[type="checkbox"]', dialog: '[role="dialog"]',
    status: '[role="status"]',
  }[role];
  const found = await page.waitForFunction((sel, name, isRe, flags) => {
    const re = isRe ? new RegExp(name, flags) : null;
    const label = (e) => (e.getAttribute("aria-label")
      || e.textContent || "").replace(/\s+/g, " ").trim();
    const hit = [...document.querySelectorAll(sel)].find((e) => {
      if (!e.offsetParent && getComputedStyle(e).position !== "fixed")
        return false;
      const l = label(e);
      return re ? re.test(l) : l === name;
    });
    return hit ?? null;
  }, { timeout }, sel, name instanceof RegExp ? name.source : name,
  name instanceof RegExp, name instanceof RegExp ? name.flags : "");
  return found.asElement();
}

export async function click(page, role, name) {
  const el = await byRole(page, role, name);
  await el.evaluate((e) => e.scrollIntoView({ block: "nearest" }));
  await el.click();
  await sleep(250);
}

/** Wait until visible page text matches. */
export const waitText = (page, re, timeout = 20000) =>
  page.waitForFunction((src, flags) => new RegExp(src, flags)
    .test(document.body.innerText), { timeout }, re.source, re.flags);

/** The "12 cached AI verdicts applied" notice is dismissible; tidy shots
 *  don't show it. */
export async function dismissNotice(page) {
  const btn = await page.$('[role="status"] button[aria-label="Dismiss"]');
  if (btn) { await btn.click(); await sleep(300); }
}

/** Open the first group of the current list the way a keyboard user would
 *  (j, Enter) and wait for its mails and footer actions. */
export async function openGroup(page, label) {
  if (label) await click(page, "button", label);
  else { await page.keyboard.press("j"); await page.keyboard.press("Enter"); }
  await byRole(page, "button", /^Trash (all \d+|1 mail)$/);
  await page.waitForFunction(() => document.querySelector(
    '[data-split-pane] input[type="checkbox"], '
    + '[role="dialog"] input[type="checkbox"]'), { timeout: 20000 });
  await settle(page);
}

export async function hideCaret(page) {
  await page.evaluate(() => document.activeElement?.blur?.());
}
