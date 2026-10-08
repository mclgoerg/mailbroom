// @vitest-environment jsdom
/* UX12: group details as a split pane at >= 1280 px, modal below. */

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
    domain: {}, subject: {}, thread: {} },
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

// A controllable matchMedia: `resize(wide)` fires the change listeners the
// way crossing 1280 px does in a browser.
let isWide = true;
const listeners = new Set<() => void>();
const resize = (wide: boolean) => act(() => {
  isWide = wide; listeners.forEach((l) => l());
});
const widen = (wide: boolean) => {
  isWide = wide; listeners.clear();
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() { return isWide && q.includes("1280"); }, media: q,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }));
};

const mount = (wide = true, groups?: Record<string, unknown>) => {
  widen(wide);
  state = groups ? { ...baseState,
    groups: { ...baseState.groups, sender: groups } } : baseState;
  localStorage.setItem("pmc_account", "proton");
  return render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
};
// The table row (jsdom lays out both the table and the phone cards).
const row = async (label: string) => {
  const find = () => [...document.querySelectorAll("tr[data-gidx]")]
    .find((tr) => tr.textContent?.includes(label)) as HTMLElement | undefined;
  await waitFor(() => expect(find()).toBeTruthy());
  return find()!;
};
const pane = () => document.querySelector("[data-split-pane]");
const paneTitle = () => pane()?.querySelector(".type-heading")?.textContent;
const key = (k: string, target: Element = document.body) =>
  fireEvent.keyDown(target, { key: k });

beforeEach(() => {
  groupFetch.mockClear();
  groupFetch.mockImplementation((key) => Promise.resolve(mails(key)));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals();
  localStorage.clear(); deleteGroups.mockClear(); block.mockClear(); });

test(">= 1280 px: a row opens the pane (no dialog); the row is marked open",
  async () => {
  mount();
  fireEvent.click(await row("Alpha"));
  await waitFor(() => expect(paneTitle()).toBe("Alpha"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect((await row("Alpha")).getAttribute("aria-current")).toBe("true");
  // clicking another row replaces it
  fireEvent.click(await row("Bravo"));
  await waitFor(() => expect(paneTitle()).toBe("Bravo"));
  expect(document.querySelectorAll("[data-split-pane]").length).toBe(1);
  // Close button closes it
  fireEvent.click(within(pane() as HTMLElement)
    .getByRole("button", { name: "Close" }));
  expect(pane()).toBeNull();
});

test("< 1280 px: the same click opens the modal, not a pane", async () => {
  mount(false);
  fireEvent.click(await row("Alpha"));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(pane()).toBeNull();
});

test("j/k move the list and the pane follows after a debounce; Esc closes",
  async () => {
  mount();
  fireEvent.click(await row("Alpha"));
  await waitFor(() => expect(paneTitle()).toBe("Alpha"));
  key("j"); key("j");
  expect(paneTitle()).toBe("Alpha");            // not yet: debounced
  await waitFor(() => expect(paneTitle()).toBe("Charlie"));  // one fetch, not two
  key("k");
  await waitFor(() => expect(paneTitle()).toBe("Bravo"));
  key("Escape");
  expect(pane()).toBeNull();
});

test("keys typed in a pane control are not list shortcuts", async () => {
  mount();
  fireEvent.click(await row("Alpha"));
  await waitFor(() => expect(paneTitle()).toBe("Alpha"));
  const sort = within(pane() as HTMLElement).getByDisplayValue("Sort: date");
  key("j", sort);
  key("Escape", sort);
  await new Promise((r) => setTimeout(r, 300));
  expect(paneTitle()).toBe("Alpha");            // neither followed nor closed
  // ...and a pane button keeps Enter / # for itself, only j/k pass through
  const btn = within(pane() as HTMLElement)
    .getByRole("button", { name: /Trash all/ });
  key("#", btn);
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("Trash all in the pane moves on to the next group, then closes",
  async () => {
  mount(true, { [A.key]: A, [B.key]: B });
  fireEvent.click(await row("Alpha"));
  await waitFor(() => expect(paneTitle()).toBe("Alpha"));
  fireEvent.click(await screen.findByRole("button", { name: "Trash all 3" }));
  await pressDialog("Move to Trash (30)");
  await waitFor(() => expect(deleteGroups).toHaveBeenCalled());
  await waitFor(() => expect(paneTitle()).toBe("Bravo"));
  // (the mocked state still lists both groups; the focus outline follows)
  fireEvent.click(await screen.findByRole("button", { name: "Trash all 3" }));
  await pressDialog("Move to Trash (20)");
  await waitFor(() => expect(deleteGroups).toHaveBeenCalledTimes(2));
  // Bravo's neighbour is Alpha (still in the stale mock list): moves there
  await waitFor(() => expect(paneTitle()).toBe("Alpha"));
});

test("a ConfirmDialog from the pane is a modal on top of it; Esc closes " +
  "only the dialog", async () => {
  mount();
  fireEvent.click(await row("Alpha"));
  await waitFor(() => expect(paneTitle()).toBe("Alpha"));
  fireEvent.click(await screen.findByRole("button", { name: "Trash all 3" }));
  await findDialog();
  key("Escape");
  await expectNoDialog();
  expect(paneTitle()).toBe("Alpha");
});

// The contract (not the timing): whoever uses an Esc marks it defaultPrevented
// and nobody later in the chain acts on a used Esc. In a real browser React
// re-renders between the Modal's and App's window listeners, so App can no
// longer see the dialog open - only the mark tells it.
const esc = (target: EventTarget = document.body) => {
  const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true,
    cancelable: true });
  act(() => { target.dispatchEvent(ev); });
  return ev;
};

test("Esc contract: the topmost Modal marks the Esc as used", async () => {
  mount();
  fireEvent.click(await row("Alpha"));
  await waitFor(() => expect(paneTitle()).toBe("Alpha"));
  fireEvent.click(await screen.findByRole("button", { name: "Trash all 3" }));
  await findDialog();
  expect(esc().defaultPrevented).toBe(true);
  await expectNoDialog();
  expect(paneTitle()).toBe("Alpha");
});

test("Esc contract: App ignores an Esc something else already used",
  async () => {
  mount();
  fireEvent.click(await row("Alpha"));
  await waitFor(() => expect(paneTitle()).toBe("Alpha"));
  // (a popover / menu / dialog earlier in the chain)
  const use = (e: Event) => e.preventDefault();
  document.addEventListener("keydown", use);
  try { esc(); } finally { document.removeEventListener("keydown", use); }
  expect(paneTitle()).toBe("Alpha");
  expect(esc().defaultPrevented).toBe(false);   // App doesn't mark its own
  expect(pane()).toBeNull();                    // an unused Esc does close it
});

test("rapid j/k: the last row wins with ONE fetch (debounced)", async () => {
  mount();
  fireEvent.click(await row("Alpha"));
  await waitFor(() => expect(paneTitle()).toBe("Alpha"));
  groupFetch.mockClear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  for (const k of ["j", "j", "k", "j", "j"]) { key(k); vi.advanceTimersByTime(100); }
  expect(groupFetch).not.toHaveBeenCalled();       // never paused 150 ms yet
  act(() => { vi.advanceTimersByTime(150); });
  vi.useRealTimers();
  await waitFor(() => expect(paneTitle()).toBe("Charlie"));
  expect(groupFetch.mock.calls).toEqual([[C.key]]);
});

test("a slow fetch for group A arriving after B is open doesn't show A",
  async () => {
  mount();
  let release!: () => void;
  groupFetch.mockImplementationOnce((key) => new Promise((r) => {
    release = () => r(mails(key));
  }));
  fireEvent.click(await row("Alpha"));
  await waitFor(() => expect(groupFetch).toHaveBeenCalledTimes(1));
  fireEvent.click(await row("Bravo"));
  await waitFor(() => screen.getByText(`Mail 1 of ${B.key}`));
  await act(async () => { release(); });
  expect(screen.queryByText(`Mail 1 of ${A.key}`)).toBeNull();
  expect(screen.getByText(`Mail 1 of ${B.key}`)).toBeTruthy();
  expect(paneTitle()).toBe("Bravo");
});

// Block + "Move to Trash": the mocked state drops the open group.
const blockAndTrash = async (dropped: string[]) => {
  block.mockImplementationOnce(async () => {
    const sender = { ...(state.groups.sender as Record<string, unknown>) };
    dropped.forEach((k) => delete sender[k]);
    state = { ...state, groups_rev: state.groups_rev + 1,
      groups: { ...state.groups, sender } };
    return { rule: { id: "r1" } };
  });
  fireEvent.click(await screen.findByRole("button", { name: "Block sender" }));
  await pressDialog("Block");
  await pressDialog(/Move to Trash/);
};

test("the open group vanishing from the mailbox advances to its neighbour",
  async () => {
  mount();
  fireEvent.click(await row("Bravo"));
  await waitFor(() => expect(paneTitle()).toBe("Bravo"));
  await blockAndTrash([B.key]);
  await waitFor(() => expect(paneTitle()).toBe("Charlie"));
  expect((await row("Charlie")).getAttribute("aria-current")).toBe("true");
});

test("...and closes without stealing focus from the filter input",
  async () => {
  mount(true, { [A.key]: A });
  fireEvent.click(await row("Alpha"));
  await waitFor(() => expect(paneTitle()).toBe("Alpha"));
  const filter = screen.getByPlaceholderText(/filter groups/i);
  filter.focus();
  await blockAndTrash([A.key]);
  await waitFor(() => expect(pane()).toBeNull());
  expect(document.activeElement).toBe(filter);
});

test("keyboard: Enter on the focused row opens the pane AND focuses it; " +
  "j/k with focus inside keep focus in the pane", async () => {
  mount();
  await row("Alpha");
  key("j");                       // focus the first row
  key("Enter");
  await waitFor(() => expect(paneTitle()).toBe("Alpha"));
  await waitFor(() => expect(document.activeElement).toBe(pane()));
  within(pane() as HTMLElement).getByRole("button", { name: /Trash all/ })
    .focus();
  key("j", document.activeElement!);
  await waitFor(() => expect(paneTitle()).toBe("Bravo"));
  await waitFor(() => expect(document.activeElement).toBe(pane()));
});

test("a list selection hides the pane's group actions (one red scope)",
  async () => {
  mount();
  fireEvent.click(await row("Alpha"));
  await waitFor(() => expect(paneTitle()).toBe("Alpha"));
  expect(screen.getByRole("button", { name: "Trash all 3" })).toBeTruthy();
  const box = (await row("Charlie")).querySelector("input[type=checkbox]")!;
  fireEvent.click(box);
  expect(screen.queryByRole("button", { name: "Trash all 3" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Block sender" })).toBeNull();
  fireEvent.click(box);
  expect(screen.getByRole("button", { name: "Trash all 3" })).toBeTruthy();
});

test("resizing across 1280 px swaps pane and modal, keeping the open group",
  async () => {
  mount();
  fireEvent.click(await row("Bravo"));
  await waitFor(() => expect(paneTitle()).toBe("Bravo"));
  expect(groupFetch).toHaveBeenCalledTimes(1);
  await resize(false);
  const dlg = await screen.findByRole("dialog");
  expect(within(dlg).getByText("Bravo")).toBeTruthy();
  expect(pane()).toBeNull();
  await resize(true);
  await waitFor(() => expect(paneTitle()).toBe("Bravo"));
  expect(screen.queryByRole("dialog")).toBeNull();
  // each swap remounts the panel: exactly one refetch per swap, no more
  await new Promise((r) => setTimeout(r, 300));
  expect(groupFetch).toHaveBeenCalledTimes(3);
  // j continues from the open row, not from wherever focus used to be
  key("j");
  await waitFor(() => expect(paneTitle()).toBe("Charlie"));
});

test("Trash all on the only group closes the pane", async () => {
  mount(true, { [A.key]: A });
  fireEvent.click(await row("Alpha"));
  await waitFor(() => expect(paneTitle()).toBe("Alpha"));
  fireEvent.click(await screen.findByRole("button", { name: "Trash all 3" }));
  await pressDialog("Move to Trash (30)");
  await waitFor(() => expect(pane()).toBeNull());
});
