// @vitest-environment jsdom
/* Select mode: the "Select" button toggles checkboxes on every sender row;
 * "Done" ends it and clears the selection; the keyboard `x` and the
 * bottom bar keep working; changing the grouping ends it. */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

let state: any;

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    mails: () => new Promise(() => {}),   // All mail view: never answers
    version: () => Promise.resolve({ build: "v1" }),
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
import type { AppState, Config, Group } from "./types";

const acct = {
  excluded_folders: [] as string[],
  host: "h", port: 993, security: "ssl" as const,
  smtp_host: "", smtp_port: 587, smtp_security: "auto" as const,
  user: "", password: "", password_set: true,
  cafile: "", preset: "custom" as const, oauth: null,
  digest: { schedule: "off" as const, recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours" as const, value: 6,
    align_minute: 0 },
};

const cfg: Config = {
  default_account: "proton",
  accounts: { proton: { ...acct, user: "marcel@proton.example" } },
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "claude-sonnet-5",
    foundry_endpoint: "", price_in: 0, price_out: 0, budget_usd: 0,
    month_cost: 0, prices_effective: [2, 10], api_key: "",
    api_key_set: false, available: false, source: null,
    shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
};

const mkGroup = (over: Partial<Group> = {}): Group => ({
  key: "a@x.example", label: "Sender A", sub: "a@x.example", count: 5,
  size: 1000, unread: 0, first: "2024-01-01", last: "2025-01-01",
  tags: [], samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
  new: false, pinned: 0, engagement: 50, ...over,
});

const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: [],
  groups: { sender: {}, smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: [],
  presets: [],
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});


// jsdom has no scrollIntoView (App scrolls the focused row into view).
Element.prototype.scrollIntoView = () => {};

const two = () => {
  const a = mkGroup();
  const b = mkGroup({ key: "b@x.example", label: "Sender B",
    sub: "b@x.example", count: 3 });
  state = { ...baseState, groups: { sender: { [a.key]: a, [b.key]: b },
    smart: {}, domain: {}, subject: {}, thread: {} } };
};
const boot = async () => {
  localStorage.setItem("pmc_account", "proton");
  two();
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(screen.getAllByText("Sender A").length)
    .toBeGreaterThan(0));
};
const boxes = () => document.querySelectorAll(
  "tbody input[type=checkbox]");
const hiddenBoxes = () => [...boxes()].filter(
  (b) => b.closest("label")!.className.includes("opacity-0"));

test("Select shows every row's checkbox, Done hides them and clears", async () => {
  await boot();
  expect(hiddenBoxes().length).toBe(2);
  const btn = screen.getByRole("button", { name: "Select" });
  expect(btn.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(btn);
  expect(hiddenBoxes().length).toBe(0);
  expect(screen.getByRole("button", { name: "Done" })
    .getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(boxes()[0]);
  expect((boxes()[0] as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(hiddenBoxes().length).toBe(2);
  expect([...boxes()].some((b) => (b as HTMLInputElement).checked)).toBe(false);
  expect(screen.getByRole("button", { name: "Select" })).toBeTruthy();
});

test("a selection reveals the checkboxes without select mode, and the x key toggles", async () => {
  await boot();
  fireEvent.keyDown(window, { key: "j" });
  fireEvent.keyDown(window, { key: "x" });
  expect(hiddenBoxes().length).toBe(0);
  expect([...boxes()].filter((b) => (b as HTMLInputElement).checked).length)
    .toBe(1);
  fireEvent.keyDown(window, { key: "x" });
  // the focused row keeps its box (x has a visible target), the other waits
  expect(hiddenBoxes().length).toBe(1);
});

test("changing the grouping ends select mode", async () => {
  await boot();
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  fireEvent.click(screen.getByRole("tab", { name: "Subject" }));
  expect(screen.getByRole("button", { name: "Select" })
    .getAttribute("aria-pressed")).toBe("false");
});

test("Back / Forward (a page change from the URL) ends select mode", async () => {
  await boot();
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  window.location.hash = "#/all";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Done" }))
    .toBeNull());
  window.location.hash = "#/senders";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Select" })
    .getAttribute("aria-pressed")).toBe("false"));
  window.location.hash = "";
});
