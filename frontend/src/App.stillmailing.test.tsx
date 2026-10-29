// @vitest-environment jsdom
/* Unsubscribe watchdog: the "Still mailing (n)" chip only appears once a
 * sender is flagged and behaves like the other quick-select chips (filter,
 * select, clear); the row shows the badge with its popover. */

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
  new: false, pinned: 0, engagement: 50, still_mailing: null, ...over,
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

const SINCE = Date.UTC(2025, 9, 3, 12) / 1000;
const sm = (n: number) => ({ n, senders: 1, since_ts: SINCE, addrs: [] });

const renderApp = () => render(<ToastProvider><DialogProvider><App />
  </DialogProvider></ToastProvider>);

test("no chip renders when nothing is still mailing", async () => {
  localStorage.setItem("pmc_account", "proton");
  const a = mkGroup();
  state = { ...baseState,
    groups: { sender: { [a.key]: a }, smart: {}, domain: {}, subject: {}, thread: {} } };
  renderApp();
  await waitFor(() => expect(screen.getAllByText("Sender A").length)
    .toBeGreaterThan(0));
  expect(screen.queryByText(/^Still mailing/)).toBeNull();
});

test("the chip counts flagged groups; tap 1 filters, tap 2 selects the " +
  "non-protected matches, tap 3 clears", async () => {
  localStorage.setItem("pmc_account", "proton");
  const hit = mkGroup({ key: "a@x.example", label: "Sender A", count: 5,
    still_mailing: sm(2) });
  const hitProtected = mkGroup({ key: "b@x.example", label: "Sender B",
    count: 9, protected: true, still_mailing: sm(1) });
  const other = mkGroup({ key: "c@x.example", label: "Sender C", count: 3 });
  state = { ...baseState, groups: { sender: {
    [hit.key]: hit, [hitProtected.key]: hitProtected, [other.key]: other },
    smart: {}, domain: {}, subject: {}, thread: {} } };
  renderApp();
  await waitFor(() => expect(screen.getAllByText("Sender A").length)
    .toBeGreaterThan(0));
  const chip = await screen.findByText("Still mailing (2)");

  fireEvent.click(chip);                                    // tap 1: filter
  expect((screen.getByPlaceholderText("filter groups…") as HTMLInputElement)
    .value).toBe("is:still-mailing");
  expect(screen.queryAllByText("Sender C").length).toBe(0);
  expect(screen.queryAllByText("Sender B").length).toBeGreaterThan(0);
  expect(screen.getByText("Still mailing (2)")).toBeTruthy();

  fireEvent.click(chip);                                    // tap 2: select
  await waitFor(() => expect(screen.getByText("Trash 5")).toBeTruthy());

  fireEvent.click(chip);                                    // tap 3: clear
  await waitFor(() => expect((screen.getByPlaceholderText("filter groups…") as
    HTMLInputElement).value).toBe(""));
  expect(screen.queryAllByText("Sender C").length).toBeGreaterThan(0);
  expect(screen.queryByText(/^Trash \d+$/)).toBeNull();
});

test("the row shows the badge; a tap opens the popover with the numbers",
  async () => {
  localStorage.setItem("pmc_account", "proton");
  const hit = mkGroup({ still_mailing: sm(4),
    unsubscribed: { n: 1, of: 1, status: "done", link: "", addr: "" } });
  state = { ...baseState, groups: { sender: { [hit.key]: hit },
    smart: {}, domain: {}, subject: {}, thread: {} } };
  renderApp();
  await waitFor(() => expect(screen.getAllByText("Sender A").length)
    .toBeGreaterThan(0));
  // the broken promise replaces the "Unsubscribed" tick
  expect(screen.queryByText(/✓ Unsubscribed/)).toBeNull();
  const badge = screen.getAllByText("Still mailing")[0].closest("button")!;
  expect(screen.queryByText(/since you unsubscribed on 3 Oct/)).toBeNull();
  fireEvent.click(badge);
  expect(screen.getByRole("dialog").textContent)
    .toMatch(/4 mails since you unsubscribed on 3 Oct/);
});
