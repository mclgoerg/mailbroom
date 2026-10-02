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
import type { AppState, Config, Group } from "./types";

const acct = {
  excluded_folders: [] as string[],
  host: "h", port: 993, security: "ssl" as const,
  smtp_host: "", smtp_port: 587, smtp_security: "auto" as const,
  user: "", password: "", password_set: true,
  cafile: "", preset: "custom" as const, oauth: null,
  digest: { schedule: "off" as const, recipient: "", hour: 8, minute: 0 },
};

const cfg: Config = {
  default_account: "proton",
  accounts: { proton: { ...acct, user: "marcel@proton.example" } },
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {},
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
  new: false, ...over,
});

const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: [],
  groups: { sender: {}, domain: {}, subject: {} },
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
    groups: { sender: { [a.key]: a }, domain: {}, subject: {} } };
  render(<App />);
  await waitFor(() => expect(screen.getAllByText("Sender A").length)
    .toBeGreaterThan(0));
  expect(screen.queryByText(/^New \(/)).toBeNull();
});

test("the New chip shows a live count and tapping it selects only the " +
  "flagged, non-protected groups", async () => {
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
    [notFlagged.key]: notFlagged }, domain: {}, subject: {} } };
  render(<App />);
  await waitFor(() => expect(screen.getAllByText("Sender A").length)
    .toBeGreaterThan(0));

  // The chip's count is every flagged group (2) - protection only
  // affects which ones selectPreset actually adds to the selection.
  const chip = await screen.findByText("New (2)");
  fireEvent.click(chip);

  // The bulk-action bar appears, scoped to exactly the qualifying
  // group's mail count (5) - the protected and not-flagged groups are
  // excluded, same as every other quick-select preset.
  await waitFor(() => expect(screen.getByText("Trash 5")).toBeTruthy());
});
