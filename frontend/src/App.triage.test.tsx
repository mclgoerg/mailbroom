// @vitest-environment jsdom
/* Swipe triage: deck, decisions, gestures, and the single confirmed apply. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let state: any;
const protectMany = vi.fn().mockResolvedValue({ protected: [] });
const unsubscribeBulk = vi.fn().mockResolvedValue(
  { queued: 1, skipped_protected: 0, skipped_done: 0, capped: 0 });
const deleteGroups = vi.fn().mockResolvedValue({ ok: true, queued: 1, skipped: 0 });
const calls: string[] = [];

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
    group: () => Promise.resolve([]),
    scan: () => Promise.resolve({ ok: true }),
    protectMany: (...a: unknown[]) => { calls.push("protect"); return protectMany(...a); },
    unsubscribeBulk: (...a: unknown[]) => { calls.push("unsub"); return unsubscribeBulk(...a); },
    deleteGroups: (...a: unknown[]) => { calls.push("trash"); return deleteGroups(...a); },
  },
  downloadFile: () => Promise.resolve(),
  setAccount: () => {},
  withAccount: (p: string) => p,
  fmtSize: (b: number) => `${b} B`,
  fmtUsd: (c: number) => `$${c}`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { AppState, Config, Group } from "./types";

const cfg = {
  accounts: { proton: {
    excluded_folders: [], host: "h", port: 993, security: "ssl",
    smtp_host: "", smtp_port: 587, smtp_security: "auto", user: "",
    password: "", password_set: true, cafile: "", preset: "custom",
    oauth: null,
    digest: { schedule: "off", recipient: "", hour: 8, minute: 0 },
    auto_scan: { enabled: false, unit: "hours", value: 6, align_minute: 0 },
  } },
  default_account: "proton", oauth_providers: [],
  oauth_ms_device_available: false, auth: { mode: "none", is_admin: false },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "m", foundry_endpoint: "",
    price_in: 0, price_out: 0, budget_usd: 0, month_cost: 0,
    prices_effective: [2, 10], api_key: "", api_key_set: false,
    available: false, source: null, shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
} as unknown as Config;

const grp = (key: string, label: string, over: Partial<Group> = {}): Group => ({
  key, label, sub: key, count: 5, size: 500, unread: 1, first: "2024-01-01",
  last: "2025-06-01", tags: [], samples: ["Weekly digest", "Offer inside"],
  bulk: false, unsub: false, ai: null, ratings: null, protected: false,
  replied: false, att_size: 0, unsubscribed: null, new: false, pinned: 0,
  engagement: 20, ...over,
});

// Default sort is by count, descending: this is the deck order.
const FIXTURE = [
  grp("a@news.example", "News A", { count: 50, size: 5000, unsub: true }),
  grp("b@shop.example", "Shop B", { count: 40, size: 4000 }),
  grp("c@bank.example", "Bank C", { count: 30, size: 3000, protected: true,
    unsub: true }),
  grp("d@list.example", "List D", { count: 20, size: 2000, unsub: true,
    unsubscribed: { n: 1, of: 1, status: "done", link: "", addr: "" } }),
  grp("e@pin.example", "Pin E", { count: 10, size: 1000, pinned: 4 }),
];

const baseState = (groups: Group[]): AppState => ({
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: ["INBOX"],
  groups: { sender: Object.fromEntries(groups.map((g) => [g.key, g])),
    smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "", usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: [],
  presets: [],
} as unknown as AppState);

let reduced = false;
beforeEach(() => {
  reduced = true;       // most tests skip the fly-out animation
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("prefers-reduced-motion") ? reduced : false,
    media: q, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
  }));
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  setLang("en");
  for (const m of [protectMany, unsubscribeBulk, deleteGroups]) m.mockClear();
  calls.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const open = async (groups = FIXTURE) => {
  localStorage.setItem("pmc_account", "proton");
  state = baseState(groups);
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(screen.getAllByText(groups[0].label).length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole("button", { name: "Tools" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Triage/ }));
  return await screen.findByRole("dialog", { name: "Triage" });
};
const card = () => screen.getByTestId("triage-card");
const btn = (dlg: HTMLElement, name: string | RegExp) =>
  within(dlg).getByRole("button", { name });
const key = (k: string) => fireEvent.keyDown(window, { key: k });

test("deck follows the current list order and shows the card details", async () => {
  const dlg = await open();
  expect(within(dlg).getByText("Card 1 of 5")).toBeTruthy();
  expect(within(card()).getByText("News A")).toBeTruthy();
  expect(within(card()).getByText("Weekly digest")).toBeTruthy();
  expect(within(card()).getByText("50")).toBeTruthy();
  fireEvent.click(btn(dlg, /Keep/));
  await waitFor(() => expect(within(card()).getByText("Shop B")).toBeTruthy());
});

test("the filter narrows the deck (current list, current filter)", async () => {
  localStorage.setItem("pmc_account", "proton");
  state = baseState(FIXTURE);
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(screen.getAllByText("News A").length).toBeGreaterThan(0));
  fireEvent.change(screen.getByPlaceholderText(/Filter/i), { target: { value: "shop" } });
  fireEvent.click(screen.getByRole("button", { name: "Tools" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Triage/ }));
  const dlg = await screen.findByRole("dialog", { name: "Triage" });
  expect(within(dlg).getByText("Card 1 of 1")).toBeTruthy();
  expect(within(card()).getByText("Shop B")).toBeTruthy();
});

test("the deck holds at most 50 cards", async () => {
  const many = Array.from({ length: 70 }, (_, i) =>
    grp(`s${i}@m.example`, `Sender ${i}`, { count: 100 - i }));
  const dlg = await open(many);
  expect(within(dlg).getByText("Card 1 of 50")).toBeTruthy();
});

test("buttons decide, the running summary adds up, Undo takes one back", async () => {
  const dlg = await open();
  const status = () => within(dlg).getByRole("status").textContent;
  expect(status()).toBe("Nothing decided yet");
  fireEvent.click(btn(dlg, /Trash/));                                  // News A
  await waitFor(() => expect(status()).toBe("Trash 1 group · 5000 B"));
  fireEvent.click(btn(dlg, /Trash/));                                  // Shop B
  await waitFor(() => expect(status()).toBe("Trash 2 groups · 9000 B"));
  fireEvent.click(btn(dlg, "Undo last decision"));
  await waitFor(() => expect(status()).toBe("Trash 1 group · 5000 B"));
  expect(within(card()).getByText("Shop B")).toBeTruthy();    // back on it
  fireEvent.click(btn(dlg, /Protect/));
  await waitFor(() => expect(status()).toBe("Trash 1 group · 5000 B · Protect 1"));
});

test("keyboard: arrows decide, Backspace undoes", async () => {
  const dlg = await open();
  const status = () => within(dlg).getByRole("status").textContent;
  key("ArrowUp");                                    // News A: has a header
  await waitFor(() => expect(status()).toBe("Unsubscribe 1"));
  key("ArrowLeft");                                  // Shop B
  await waitFor(() => expect(status()).toBe("Trash 1 group · 4000 B · Unsubscribe 1"));
  key("Backspace");
  await waitFor(() => expect(status()).toBe("Unsubscribe 1"));
  key("ArrowRight");                                 // Shop B kept
  await waitFor(() => expect(within(card()).getByText("Bank C")).toBeTruthy());
  expect(status()).toBe("Unsubscribe 1");
  expect(calls).toEqual([]);                         // nothing touched yet
});

test("unsubscribe is not offered without a header or when already done", async () => {
  const dlg = await open();
  fireEvent.click(btn(dlg, /Keep/));                          // News A -> Shop B
  await waitFor(() => expect(within(card()).getByText("Shop B")).toBeTruthy());
  expect((btn(dlg, /Unsubscribe/) as HTMLButtonElement).disabled).toBe(true);
  key("ArrowUp");                                    // keyboard cannot either
  expect(within(card()).getByText("Shop B")).toBeTruthy();
  fireEvent.click(btn(dlg, /Keep/));
  fireEvent.click(btn(dlg, /Keep/));                          // Bank C -> List D
  await waitFor(() => expect(within(card()).getByText("List D")).toBeTruthy());
  expect((btn(dlg, /Unsubscribe/) as HTMLButtonElement).disabled).toBe(true);
});

test("a protected group is shown but cannot be trashed", async () => {
  const dlg = await open();
  fireEvent.click(btn(dlg, /Keep/)); fireEvent.click(btn(dlg, /Keep/));         // -> Bank C
  await waitFor(() => expect(within(card()).getByText("Bank C")).toBeTruthy());
  expect(within(card()).getByText("Protected - kept")).toBeTruthy();
  expect((btn(dlg, /Trash/) as HTMLButtonElement).disabled).toBe(true);
  key("ArrowLeft");
  expect(within(card()).getByText("Bank C")).toBeTruthy();    // still here
  expect(within(dlg).getByRole("status").textContent).toBe("Nothing decided yet");
});

let clock = 1000;
const drag = (dx: number, dy: number, ms = 400) => {
  const el = card();
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  clock = 1000;
  fireEvent.pointerDown(el, { clientX: 200, clientY: 300, pointerId: 1, button: 0 });
  fireEvent.pointerMove(el, { clientX: 200 + dx, clientY: 300 + dy, pointerId: 1 });
  clock = 1000 + ms;
  fireEvent.pointerUp(el, { clientX: 200 + dx, clientY: 300 + dy, pointerId: 1 });
};

test("a drag past the threshold commits, a short one springs back", async () => {
  const dlg = await open();
  const status = () => within(dlg).getByRole("status").textContent;
  drag(-40, 0);                                      // < 30% of the 300px fallback
  expect(within(card()).getByText("News A")).toBeTruthy();
  expect(status()).toBe("Nothing decided yet");
  drag(-120, 0);                                     // left = Trash
  await waitFor(() => expect(status()).toBe("Trash 1 group · 5000 B"));
  drag(120, 0);                                      // right = Keep (Shop B)
  await waitFor(() => expect(within(card()).getByText("Bank C")).toBeTruthy());
  expect(status()).toBe("Trash 1 group · 5000 B");
  drag(0, -120);                                     // up on a protected: no
  expect(within(card()).getByText("Bank C")).toBeTruthy();
  drag(-120, 0);                                     // left on a protected: no
  expect(within(card()).getByText("Bank C")).toBeTruthy();
});

test("without reduced motion the card flies out before the next shows", async () => {
  reduced = false;
  const dlg = await open();
  drag(-120, 0);
  expect(within(card()).getByText("News A")).toBeTruthy();    // still leaving
  expect(card().style.opacity).toBe("0");
  await waitFor(() => expect(within(card()).getByText("Shop B")).toBeTruthy());
  expect(within(dlg).getByRole("status").textContent).toBe("Trash 1 group · 5000 B");
});

const toSummary = async (dlg: HTMLElement) => {
  fireEvent.click(btn(dlg, "Done"));
  await within(dlg).findByRole("button", { name: "Apply" });
};

test("nothing is called before Apply + confirm; Cancel leaves the deck alone", async () => {
  const dlg = await open();
  fireEvent.click(btn(dlg, /Trash/));
  await toSummary(dlg);
  expect(within(dlg).getByText(/Move 50 mails from 1 group to Trash/)).toBeTruthy();
  fireEvent.click(btn(dlg, "Apply"));
  const c = await findDialog();
  expect(c.textContent).toContain("Move 50 mails from 1 group to Trash");
  await cancelDialog();
  await expectNoDialog();
  expect(calls).toEqual([]);
  expect(screen.getByRole("dialog", { name: "Triage" })).toBeTruthy();
});

test("Apply runs protect, unsubscribe, then trash with exactly the decided keys", async () => {
  const dlg = await open();
  fireEvent.click(btn(dlg, /Unsubscribe/));     // News A
  fireEvent.click(btn(dlg, /Trash/));           // Shop B
  fireEvent.click(btn(dlg, /Keep/));            // Bank C (protected)
  fireEvent.click(btn(dlg, /Keep/));            // List D
  fireEvent.click(btn(dlg, /Protect/));         // Pin E
  await within(dlg).findByRole("button", { name: "Apply" });   // deck ended
  fireEvent.click(btn(dlg, "Apply"));
  const c = await findDialog();
  expect(c.textContent).toContain("Move 40 mails from 1 group to Trash");
  expect(c.textContent).toContain("Unsubscribe from 1 sender");
  expect(c.textContent).toContain("Add 1 entry to your protected list");
  expect(calls).toEqual([]);
  await pressDialog("Apply");
  await waitFor(() => expect(deleteGroups).toHaveBeenCalledOnce());
  expect(calls).toEqual(["protect", "unsub", "trash"]);
  expect(protectMany).toHaveBeenCalledWith(["e@pin.example"], true);
  expect(unsubscribeBulk).toHaveBeenCalledWith("sender", ["a@news.example"]);
  expect(deleteGroups.mock.calls[0].slice(0, 3))
    .toEqual(["sender", ["b@shop.example"], "trash"]);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Triage" })).toBeNull());
});

test("pinned mails are left out of the counted mails", async () => {
  const dlg = await open();
  for (let i = 0; i < 4; i++) fireEvent.click(btn(dlg, /Keep/));       // -> Pin E
  await waitFor(() => expect(within(card()).getByText("Pin E")).toBeTruthy());
  fireEvent.click(btn(dlg, /Trash/));
  await within(dlg).findByRole("button", { name: "Apply" });
  fireEvent.click(btn(dlg, "Apply"));
  const c = await findDialog();
  expect(c.textContent).toContain("Move 6 mails from 1 group to Trash");
  expect(c.textContent).toContain("4 protected mails stay untouched");
});

test("a second finger voids the gesture: no decision on either pointer up", async () => {
  const dlg = await open();
  const el = card();
  fireEvent.pointerDown(el, { clientX: 200, clientY: 300, pointerId: 1, button: 0 });
  fireEvent.pointerDown(el, { clientX: 320, clientY: 300, pointerId: 2, button: 0 });
  fireEvent.pointerUp(el, { clientX: 80, clientY: 300, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: 150, clientY: 300, pointerId: 2 });
  await new Promise((r) => setTimeout(r, 50));
  expect(within(card()).getByText("News A")).toBeTruthy();
  expect(within(dlg).getByRole("status").textContent).toBe("Nothing decided yet");
  drag(-120, 0);                       // a fresh single-finger drag works again
  await waitFor(() => expect(within(dlg).getByRole("status").textContent)
    .toBe("Trash 1 group · 5000 B"));
});

test("keys do nothing while the discard prompt is on top", async () => {
  const dlg = await open();
  fireEvent.click(btn(dlg, /Trash/));
  fireEvent.click(btn(dlg, "Close"));
  await findDialog();
  key("ArrowLeft"); key("ArrowRight");
  await cancelDialog();
  expect(within(dlg).getByRole("status").textContent).toBe("Trash 1 group · 5000 B");
  expect(within(card()).getByText("Shop B")).toBeTruthy();
});

test("Back to cards at the end keeps the last decision", async () => {
  const dlg = await open();
  for (let i = 0; i < 4; i++) fireEvent.click(btn(dlg, /Keep/));
  fireEvent.click(btn(dlg, /Trash/));                         // last card
  await within(dlg).findByRole("button", { name: "Apply" });
  fireEvent.click(btn(dlg, "Back to cards"));
  await waitFor(() => expect(within(card()).getByText("Pin E")).toBeTruthy());
  expect(within(dlg).getByRole("status").textContent).toContain("Trash 1 group");
});

test("a group protected since the deck was dealt is skipped and said so", async () => {
  const dlg = await open();
  fireEvent.click(btn(dlg, /Unsubscribe/));                   // News A
  fireEvent.click(btn(dlg, /Trash/));                         // Shop B
  fireEvent.click(btn(dlg, "Done", ));
  await within(dlg).findByRole("button", { name: "Apply" });
  state = baseState(FIXTURE.map((x) => x.key === "b@shop.example"
    ? { ...x, protected: true } : x));
  fireEvent.click(screen.getAllByRole("button", { name: "Scan" })[0]);
  await new Promise((r) => setTimeout(r, 100));
  fireEvent.click(btn(dlg, "Apply"));
  const c = await findDialog();
  expect(c.textContent).toContain("1 protected group skipped");
  expect(c.textContent).not.toContain("to Trash");
  await pressDialog("Apply");
  await waitFor(() => expect(unsubscribeBulk).toHaveBeenCalled());
  expect(deleteGroups).not.toHaveBeenCalled();
});

test("only pinned mails left: no Move-0 step is offered", async () => {
  const dlg = await open([grp("p@pin.example", "All Pinned",
    { count: 4, pinned: 4, size: 400 })]);
  fireEvent.click(btn(dlg, /Trash/));
  await within(dlg).findByRole("button", { name: "Apply" });
  fireEvent.click(btn(dlg, "Apply"));
  await new Promise((r) => setTimeout(r, 100));
  expect(screen.queryAllByRole("dialog").filter((d) => d.hasAttribute("aria-labelledby")))
    .toHaveLength(0);
  expect(deleteGroups).not.toHaveBeenCalled();
});

test("a step failing after another ran ends the deck (no resend)", async () => {
  deleteGroups.mockRejectedValueOnce(new Error("busy"));
  const dlg = await open();
  fireEvent.click(btn(dlg, /Unsubscribe/));
  fireEvent.click(btn(dlg, /Trash/));
  fireEvent.click(btn(dlg, "Done"));
  fireEvent.click(btn(dlg, "Apply"));
  await pressDialog("Apply");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Triage" })).toBeNull());
  expect(unsubscribeBulk).toHaveBeenCalledOnce();
});

test("a failing step stops the rest and keeps the deck open", async () => {
  unsubscribeBulk.mockRejectedValueOnce(new Error("busy"));
  const dlg = await open();
  fireEvent.click(btn(dlg, /Unsubscribe/));
  fireEvent.click(btn(dlg, /Trash/));
  fireEvent.click(btn(dlg, "Done"));
  fireEvent.click(btn(dlg, "Apply"));
  await pressDialog("Apply");
  await waitFor(() => expect(unsubscribeBulk).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 50));
  expect(deleteGroups).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Triage" })).toBeTruthy();
});

test("closing with decisions asks to discard; keeping them stays open", async () => {
  const dlg = await open();
  fireEvent.click(btn(dlg, /Trash/));
  fireEvent.click(btn(dlg, "Close"));
  const c = await findDialog();
  expect(c.textContent).toContain("Discard 1 decision?");
  expect(c.textContent).toContain("Nothing has been changed in your mailbox.");
  await cancelDialog();
  expect(screen.getByRole("dialog", { name: "Triage" })).toBeTruthy();
  fireEvent.click(btn(dlg, "Close"));
  await pressDialog("Discard");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Triage" })).toBeNull());
  expect(calls).toEqual([]);
});

test("closing without decisions needs no prompt", async () => {
  const dlg = await open();
  fireEvent.click(btn(dlg, /Keep/));                          // keep changes nothing
  fireEvent.click(btn(dlg, "Close"));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Triage" })).toBeNull());
});

test("Triage lives in the Tools menu only - no loose toolbar button " +
  "(DESIGN.md toolbar rule; it wrapped the German phone toolbar)", async () => {
  localStorage.setItem("pmc_account", "proton");
  state = baseState(FIXTURE);
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(screen.getAllByText(FIXTURE[0].label).length)
    .toBeGreaterThan(0));
  expect(screen.queryByRole("button", { name: /Triage/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Tools" }));
  expect(await screen.findByRole("menuitem", { name: /Triage/ })).toBeTruthy();
});

test("the entry is disabled with no groups", async () => {
  localStorage.setItem("pmc_account", "proton");
  state = baseState([]);
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Tools" }));
  const item = await screen.findByRole("menuitem", { name: /Triage/ });
  expect(item.hasAttribute("disabled") || item.getAttribute("aria-disabled") === "true").toBe(true);
});

test("German strings", async () => {
  setLang("de");
  localStorage.setItem("pmc_account", "proton");
  state = baseState(FIXTURE);
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(screen.getAllByText("News A").length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole("button", { name: "Werkzeuge" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Triage/ }));
  const dlg = await screen.findByRole("dialog", { name: "Triage" });
  expect(within(dlg).getByText("Karte 1 von 5")).toBeTruthy();
  fireEvent.click(btn(dlg, /Papierkorb/));
  await waitFor(() => expect(within(dlg).getByRole("status").textContent)
    .toBe("1 Gruppe in den Papierkorb · 5000 B"));
  fireEvent.click(btn(dlg, "Fertig"));
  fireEvent.click(btn(dlg, "Anwenden"));
  const c = await findDialog();
  expect(c.textContent).toContain("50 Mails aus 1 Gruppe in den Papierkorb verschieben");
});
