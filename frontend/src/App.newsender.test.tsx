// @vitest-environment jsdom
/* New-sender review queue (PR #6): the "New (n)" chip only appears once
 * something is flagged, shows a live count, and tapping it adds the
 * flagged, non-protected groups to the selection (same ADD, not
 * replace, semantics as the other quick-select chips). */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

let state: any;

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
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

test("no New chip renders when nothing is flagged", async () => {
  localStorage.setItem("pmc_account", "proton");
  const a = mkGroup();
  state = { ...baseState,
    groups: { sender: { [a.key]: a }, smart: {}, domain: {}, subject: {}, thread: {} } };
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(screen.getAllByText("Sender A").length)
    .toBeGreaterThan(0));
  expect(screen.queryByText(/^New \(/)).toBeNull();
});

test("the New chip shows a live count; tap 1 filters, tap 2 selects " +
  "only the flagged, non-protected groups, tap 3 clears the filter",
  async () => {
  localStorage.setItem("pmc_account", "proton");
  const flagged = mkGroup({
    key: "a@x.example", label: "Sender A", count: 5, new: true });
  const flaggedProtected = mkGroup({
    key: "b@x.example", label: "Sender B", count: 9, new: true,
    protected: true });
  const notFlagged = mkGroup({
    key: "c@x.example", label: "Sender C", count: 3, new: false });
  state = { ...baseState, groups: { sender: {
    [flagged.key]: flagged, [flaggedProtected.key]: flaggedProtected,
    [notFlagged.key]: notFlagged }, smart: {}, domain: {}, subject: {}, thread: {} } };
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(screen.getAllByText("Sender A").length)
    .toBeGreaterThan(0));

  // The chip's count is every flagged group (2) - protection only
  // affects which ones selectPreset actually adds to the selection.
  const chip = await screen.findByText("New (2)");

  // Tap 1: filters to is:new, selection untouched. Both flagged groups
  // stay visible (protection only affects selection, not visibility),
  // the unflagged one disappears.
  fireEvent.click(chip);
  expect((screen.getByPlaceholderText("filter groups…") as HTMLInputElement)
    .value).toBe("is:new");
  expect(screen.queryAllByText("Sender A").length).toBeGreaterThan(0);
  expect(screen.queryAllByText("Sender B").length).toBeGreaterThan(0);
  expect(screen.queryAllByText("Sender C").length).toBe(0);
  expect(screen.queryByText(/^Trash \d+$/)).toBeNull();
  // The chip itself must survive its OWN filter being active (regression
  // check: its count/visibility come from the full mailbox, not the
  // now-filtered list).
  expect(screen.getByText("New (2)")).toBeTruthy();

  // Tap 2: already showing is:new -> selects every match except the
  // protected one (bar scoped to exactly Sender A's 5 mails).
  fireEvent.click(chip);
  await waitFor(() => expect(screen.getByText("Trash 5")).toBeTruthy());

  // Tap 3: un-selects what tap 2 selected AND clears the filter (Sender
  // C reappears, the bulk bar disappears).
  fireEvent.click(chip);
  await waitFor(() => {
    const el = screen.getByPlaceholderText("filter groups…");
    expect((el as HTMLInputElement).value).toBe("");
  });
  expect(screen.queryAllByText("Sender C").length).toBeGreaterThan(0);
  expect(screen.queryByText(/^Trash \d+$/)).toBeNull();

  // Regression: a second cycle must look identical to the first - tap 2
  // must visibly reselect (not silently no-op because tap 3 left the
  // matches selected).
  fireEvent.click(chip);                                  // tap 4: filter
  expect(screen.queryByText(/^Trash \d+$/)).toBeNull();
  fireEvent.click(chip);                                   // tap 5: select
  await waitFor(() => expect(screen.getByText("Trash 5")).toBeTruthy());
});
