// @vitest-environment jsdom
/* UX3-4: sidebar navigation from 1024 px; the old header and Tools menu below. */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const stateCalls = { n: 0 };
let state: any;
let versions = ["v1"];        // api.version() walks through this in order
let versionCalls = 0;

const block = vi.fn().mockResolvedValue({ rule: { id: "r1" } });
const deleteRule = vi.fn().mockResolvedValue(undefined);
const deleteGroups = vi.fn()
  .mockResolvedValue({ ok: true, queued: 1, skipped: 0 });
const aiReview = vi.fn().mockResolvedValue({ ok: true });
const downloadFile = vi.fn().mockResolvedValue(undefined);
const mails = (key: string) => [1, 2, 3].map((uid) => ({
  uid, folder: "INBOX", date: "2024-01-01", ts: uid,
  subject: `Mail ${uid} of ${key}`, addr: key, size: 100,
  seen: true, ai: null, pinned: false }));
// Every group-detail fetch goes through here (count it, or hold it back).
const groupFetch = vi.fn((key: string) => Promise.resolve(mails(key)));

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => { stateCalls.n++; return Promise.resolve(state); },
    emptyTrash: () => Promise.resolve({ ok: true }),
    logout: () => Promise.resolve(),
    exportUrl: (mode: string, keys?: string[]) =>
      `/api/export?grouping=${mode}`
      + (keys?.length ? `&keys=${keys.join(",")}` : ""),
    version: () => Promise.resolve(
      { build: versions[Math.min(versionCalls++, versions.length - 1)] }),
    block: (...args: unknown[]) => block(...args),
    deleteRule: (...args: unknown[]) => deleteRule(...args),
    // three unpinned mails, matching groupFixture.count (the detail panel's
    // "Trash all N" counts the loaded, unpinned mails)
    group: (_grouping: string, key: string) => groupFetch(key),
    deleteGroups: (...args: unknown[]) => deleteGroups(...args),
    aiReview: (...args: unknown[]) => aiReview(...args),
    mails: () => Promise.resolve({ items: [], total: 0 }),
    folders: () => Promise.resolve({ folders: [], wildcards: [] }),
  },
  downloadFile: (...args: unknown[]) => downloadFile(...args),
  setAccount: () => {},
  withAccount: (p: string) => p,
  fmtSize: (b: number) => `${b} B`,
  fmtUsd: (c: number) => `$${c}`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
import type { AppState, Config } from "./types";

const cfg: Config = {
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "claude-sonnet-5",
    foundry_endpoint: "", price_in: 0, price_out: 0, budget_usd: 0,
    month_cost: 0, prices_effective: [2, 10], api_key: "",
    api_key_set: false, available: false, source: null,
    shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
  default_account: "proton",
  accounts: { proton: {
    excluded_folders: [], host: "h", port: 993, security: "ssl",
    smtp_host: "", smtp_port: 587, smtp_security: "auto",
    user: "me@proton.example", password: "", password_set: true,
    cafile: "", preset: "custom", oauth: null,
    digest: { schedule: "off", recipient: "", hour: 8, minute: 0 },
    auto_scan: { enabled: false, unit: "hours", value: 6, align_minute: 0 },
  } },
} as unknown as Config;

const mk = (label: string, count: number) => ({
  key: `${label.toLowerCase()}@x.example`, label, sub: `${label.toLowerCase()}@x.example`,
  count, size: 1000, unread: 0, first: "2024-01-01", last: "2024-06-01",
  tags: [], samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
});
// Default sort is by count, descending: Alpha, Bravo, Charlie.
const A = mk("Alpha", 30), B = mk("Bravo", 20), C = mk("Charlie", 10);

const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: null, groups_rev: 0,
  progress: "", error: "", folders: [],
  groups: { sender: { [A.key]: A, [B.key]: B, [C.key]: C },
    smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: [],
  presets: [],
} as unknown as AppState;

// jsdom has no scrollIntoView (App scrolls the focused row into view).
Element.prototype.scrollIntoView = () => {};

let isWide = true;
const widen = (wide: boolean) => {
  isWide = wide;
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() { return isWide && q.includes("1024"); }, media: q,
    addEventListener: () => {}, removeEventListener: () => {},
  }));
};
const mount = (wide = true) => {
  widen(wide);
  state = { ...baseState, scanned_ts: 1, junk_count: 4, trash_count: 7 };
  localStorage.setItem("pmc_account", "proton");
  return render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
};
const side = () => screen.findByRole("navigation", { name: "Main navigation" });
const row = async (label: string) => {
  const find = () => [...document.querySelectorAll("tr[data-gidx]")]
    .find((tr) => tr.textContent?.includes(label)) as HTMLElement | undefined;
  await waitFor(() => expect(find()).toBeTruthy());
  return find()!;
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear();
  window.location.hash = ""; });

test(">= 1024: sidebar with counts replaces the header, Tools menu and links",
  async () => {
  mount();
  const nav = within(await side());
  await waitFor(() => expect(
    nav.getByRole("link", { name: /Senders/ }).textContent).toContain("3"));
  expect(nav.getByRole("link", { name: /All mail/ }).textContent).toContain("60");
  expect(nav.getByRole("button", { name: /Junk/ }).textContent).toContain("4");
  expect(nav.getByRole("button", { name: /Trash/ }).textContent).toContain("7");
  for (const n of ["Triage", "Duplicates", "Attachments", "Rules", "Statistics",
    "Space map", "Trackers", "Activity", "Settings", "Search all mails"])
    expect(nav.getByRole("button", { name: new RegExp(n) })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Inboxrake" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Tools/ })).toBeNull();
  // the work moved to a "More" menu next to Scan: Export CSV is still there
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(await screen.findByRole("menuitem", { name: /Export CSV/ })).toBeTruthy();
});

test("< 1024: today's header, Tools menu and five segments, no sidebar",
  async () => {
  mount(false);
  expect(await screen.findByRole("heading", { name: "Inboxrake" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Tools/ })).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "Main navigation" })).toBeNull();
  expect(screen.getByRole("tab", { name: "All mails" })).toBeTruthy();
});

test("account menu in the sidebar carries the profile items", async () => {
  mount();
  fireEvent.click(within(await side()).getByRole("button", { name: /proton/ }));
  expect(await screen.findByRole("menuitem", { name: /Settings/ })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: /Add account/ })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Appearance" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: /Empty Trash/ })).toBeTruthy();
});

test("tool items open today's panels; Settings gear too", async () => {
  mount();
  const nav = within(await side());
  fireEvent.click(nav.getByRole("button", { name: /Search all mails/ }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  fireEvent.keyDown(document.body, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(nav.getByRole("button", { name: "Settings" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
});

test("All mail is a page: hash follows, back/forward work, selection resets",
  async () => {
  mount();
  const nav = within(await side());
  expect(nav.getByRole("link", { name: /Senders/ }).getAttribute("aria-current"))
    .toBe("page");
  fireEvent.click(nav.getByRole("link", { name: /All mail/ }));
  expect(window.location.hash).toBe("#/all");
  expect(nav.getByRole("link", { name: /All mail/ }).getAttribute("aria-current"))
    .toBe("page");
  // no grouping segments on the All mail page
  expect(screen.getByRole("tab", { name: "Subject" }).closest(".hidden"))
    .toBeTruthy();
  act(() => {
    window.location.hash = "#/senders";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await waitFor(() => expect(
    nav.getByRole("link", { name: /Senders/ }).getAttribute("aria-current"))
    .toBe("page"));
  expect(screen.getByRole("tab", { name: "Subject" }).closest(".hidden"))
    .toBeNull();
});

test("keyboard shortcuts act only on the senders page", async () => {
  mount();
  await row("Alpha");
  fireEvent.keyDown(document.body, { key: "j" });
  fireEvent.keyDown(document.body, { key: "x" });
  await waitFor(() => expect(screen.getByRole("region", { name: /selected|Selection/i }))
    .toBeTruthy());
  fireEvent.click(within(await side()).getByRole("link", { name: /All mail/ }));
  // switching page cleared the selection
  expect(screen.queryByRole("region", { name: /selected|Selection/i })).toBeNull();
  fireEvent.keyDown(document.body, { key: "x" });
  expect(screen.queryByRole("region", { name: /selected|Selection/i })).toBeNull();
});

test("a reload on #/all lands on All mail", async () => {
  window.location.hash = "#/all";
  mount();
  expect((await within(await side()).findByRole("link", { name: /All mail/ }))
    .getAttribute("aria-current")).toBe("page");
});
