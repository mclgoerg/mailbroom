// The built demo (page + worker + bundle) in headless Chromium: boot, first
// /api/state, Trash and Undo through the real UI, and the job endpoints
// (scan, delete, undo) called directly. Tests tagged @fast are the subset
// for when the whole run is too slow.
import { expect, test } from "@playwright/test";

const BOOT_BUDGET_MS = 90_000;   // ~6 s warm on a 4-core VM; CI runners vary
const TITLE = "Getting your demo ready to rake it";

test.describe.configure({ mode: "serial" });

let page;
const problems = [];
let bootMs;
let seenDone = 0;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()}`));
  page.on("response", (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  // the boot screen is transient: record how far its checkmarks got
  await page.addInitScript(() => {
    window.__seenDone = 0;
    new MutationObserver(() => {
      const n = document.querySelectorAll('[aria-label="Done"]').length;
      if (n > window.__seenDone) window.__seenDone = n;
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  await context.addInitScript(() => {
    localStorage.setItem("pmc_lang", "en");
    localStorage.setItem("pmc_account", "proton");
  });
});

test.afterAll(async () => {
  await page.context().close();
});

// One backend call through the page's own fetch (the demo intercepts it).
const api = (method, url, body) => page.evaluate(async ([method, url, body]) => {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}, [method, url, body]);

const senders = async () => (await api("GET", "/api/state?account=proton")).json.groups.sender;

test("boots: progress steps, then the app on the demo mailboxes @fast", async () => {
  const t0 = Date.now();
  await page.goto("/demo/");
  await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
  for (const step of ["Downloading the demo engine", "Starting Python",
    "Loading libraries", "Filling the demo mailboxes"]) {
    await expect(page.getByText(step, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("Demo - your changes live only in this tab"))
    .toBeVisible({ timeout: BOOT_BUDGET_MS });
  await expect(page.locator("[data-gidx]").first()).toBeVisible({ timeout: 30_000 });
  bootMs = Date.now() - t0;
  seenDone = await page.evaluate(() => window.__seenDone);
  expect(seenDone, "the boot screen ticked its steps off").toBeGreaterThanOrEqual(3);
  expect(bootMs).toBeLessThan(BOOT_BUDGET_MS);
  console.log(`boot to first sender row: ${bootMs} ms`);
});

test("the first /api/state answers (synthetic Host: localhost) @fast", async () => {
  const state = await api("GET", "/api/state?account=proton");
  expect(state.status).toBe(200);
  expect(Object.keys(state.json.groups.sender).length).toBeGreaterThan(100);
  // the Host guard must keep accepting what the demo sends; none of this
  // reached a real network (the page only ever talks to its own origin)
  expect((await api("GET", "/api/auth")).status).toBe(200);
});

test("Trash and Undo through the UI", async () => {
  const before = await senders();
  const row = page.locator("[data-gidx]").first();
  await row.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: /^Trash \d+$/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // confirm buttons ignore a click this soon after the dialog opens
  // (DIALOG_ARM_MS in frontend/src/components/ui.tsx, 500 ms)
  await page.waitForTimeout(700);
  await dialog.getByRole("button", { name: /^Move to Trash \(\d+\)$/ }).click();
  const toast = page.getByText(/Moved \d+ mails? to Trash/);
  await expect(toast).toBeVisible();
  await toast.locator("xpath=..").getByRole("button", { name: "Undo" }).click();
  // the sender is really gone, until the Undo is confirmed
  expect(Object.keys(await senders()).length).toBeLessThan(Object.keys(before).length);
  const restore = page.getByRole("dialog", { name: /^Restore \d+ mails?/ });
  await expect(restore).toBeVisible();
  await page.waitForTimeout(700);
  await restore.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText(/Restored \d+ of \d+ mails/)).toBeVisible();
  expect(Object.keys(await senders()).length).toBe(Object.keys(before).length);
});

// Scan, delete and undo are the jobs that run on threads in the real app. In
// the demo they run inside the request; a change that makes them WAIT for
// another thread would hang here (and trip the test timeout).
test("job endpoints: scan, delete, undo all come back", async () => {
  const scan = await api("POST", "/api/scan?account=proton");
  expect(scan.status).toBe(200);
  await expect.poll(async () =>
    (await api("GET", "/api/state?account=proton")).json.status,
  { timeout: 60_000 }).not.toBe("scanning");

  const before = await senders();
  const [key] = Object.entries(before).find(([, g]) => !g.protected && g.count > 5);
  const del = await api("POST", "/api/delete?account=proton", { grouping: "sender", keys: [key] });
  expect(del.status).toBe(200);
  expect(key in await senders()).toBe(false);
  expect((await api("POST", "/api/undo?account=proton", {})).status).toBe(200);
  expect(key in await senders()).toBe(true);
});

// The other thread users: attachment analysis, an executed rule, bulk
// unsubscribe. Each has to come back (a wait on a missing thread would hang).
test("job endpoints: attachment scan, rule run, bulk unsubscribe come back", async () => {
  expect((await api("POST", "/api/attachments?account=proton")).status).toBe(200);
  await expect.poll(async () => {
    const r = await api("GET", "/api/attachments?account=proton");
    return r.status === 200 && JSON.stringify(r.json).length > 2;
  }, { timeout: 60_000 }).toBe(true);

  // a rule that really acts: report run first (required), then execute on
  // the smallest unprotected sender, then put the mails back
  const [key] = Object.entries(await senders())
    .filter(([, g]) => !g.protected && g.count > 0).sort((a, b) => a[1].count - b[1].count)[0];
  const rule = await api("POST", "/api/rules?account=proton",
    { name: "e2e", query: key, schedule: "manual" });
  expect(rule.status).toBe(200);
  const id = rule.json.id;
  expect((await api("POST", `/api/rules/${id}/run`)).status).toBe(200);
  expect((await api("POST", `/api/rules/${id}`, { mode: "execute" })).status).toBe(200);
  const run = await api("POST", `/api/rules/${id}/run`);
  expect(run.status).toBe(200);
  expect(run.json.acted).toBeGreaterThan(0);
  expect(key in await senders()).toBe(false);
  expect((await api("POST", "/api/undo?account=proton", {})).status).toBe(200);
  expect(key in await senders()).toBe(true);
  expect((await api("DELETE", `/api/rules/${id}`)).status).toBe(200);

  const [bulk] = Object.entries(await senders()).find(([, g]) => !g.protected && g.count > 5);
  const unsub = await api("POST", "/api/unsubscribe_bulk?account=proton",
    { grouping: "sender", keys: [bulk] });
  expect(unsub.status).toBe(200);
});

test("no console errors, page errors or failed requests", async () => {
  expect(problems).toEqual([]);
});
