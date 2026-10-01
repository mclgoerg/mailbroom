// @vitest-environment jsdom
/* Header account switcher: lives in the profile menu once >1 account is
 * configured. Covers the redesign that replaced the truncated pill strip
 * (frontend/src/App.tsx header) - see ai-workspaces/proton-mail-cleaner
 * PLAN.md "header redesign + account switcher". */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const stateCalls = { n: 0 };
let state: any;
let versions = ["v1"];        // api.version() walks through this in order
let versionCalls = 0;

const block = vi.fn().mockResolvedValue({ rule: { id: "r1" } });
const deleteRule = vi.fn().mockResolvedValue(undefined);

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => { stateCalls.n++; return Promise.resolve(state); },
    emptyTrash: () => Promise.resolve({ ok: true }),
    logout: () => Promise.resolve(),
    exportUrl: (mode: string) => `/api/export?grouping=${mode}`,
    version: () => Promise.resolve(
      { build: versions[Math.min(versionCalls++, versions.length - 1)] }),
    block: (...args: unknown[]) => block(...args),
    deleteRule: (...args: unknown[]) => deleteRule(...args),
  },
  downloadFile: () => Promise.resolve(),
  setAccount: () => {},
  withAccount: (p: string) => p,
  fmtSize: (b: number) => `${b} B`,
  fmtUsd: (c: number) => `$${c}`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
}));

import App from "./App";
import type { AppState, Config } from "./types";

const acct = {
  excluded_folders: [] as string[],
  host: "h", port: 993, security: "ssl" as const,
  smtp_host: "", smtp_port: 587, smtp_security: "auto" as const,
  user: "", password: "", password_set: true,
  cafile: "", preset: "custom" as const, oauth: null,
};

const cfgBase: Omit<Config, "accounts" | "default_account"> = {
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

const multiCfg: Config = {
  ...cfgBase,
  default_account: "proton",
  accounts: {
    proton: { ...acct, user: "marcel@proton.example" },
    icloud: { ...acct, user: "marcel@icloud.example" },
    gmail: { ...acct, user: "marcel@gmail.example" },
  },
};

const singleCfg: Config = {
  ...cfgBase,
  default_account: "proton",
  accounts: { proton: { ...acct, user: "marcel@proton.example" } },
};

let cfg: Config = multiCfg;

const baseState: AppState = {
  account: "proton", status: "idle", scanned_ts: null, groups_rev: 0,
  progress: "", error: "", folders: [],
  groups: { sender: {}, domain: {}, subject: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: [],
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  stateCalls.n = 0;
  versions = ["v1"];
  versionCalls = 0;
  block.mockClear();
  deleteRule.mockClear();
});

const openMenu = async () => {
  await waitFor(() =>
    expect(screen.getByLabelText("Profile & settings")).toBeTruthy());
  fireEvent.click(screen.getByLabelText("Profile & settings"));
};

// Mounting with an empty stored account always fires exactly 2
// api.state() calls before things settle (the initial data-fetch effect,
// then again once switchAccount resolves the default account) - wait for
// both, or a race can catch the count between them and read it as final.
const settleStateCalls = () =>
  waitFor(() => expect(stateCalls.n).toBeGreaterThanOrEqual(2));

test("profile menu lists every account with its address", async () => {
  cfg = multiCfg;
  state = { ...baseState };
  render(<App />);
  // Wait for config to load (multi-account trigger) before opening the
  // menu - opening too early would still show the single-account menu.
  await waitFor(() => expect(screen.getByLabelText("Profile & settings")
    .textContent).toContain("proton"));
  await openMenu();
  expect(screen.getByText("Accounts")).toBeTruthy();
  expect(screen.getByText("marcel@proton.example")).toBeTruthy();
  expect(screen.getByText("marcel@icloud.example")).toBeTruthy();
  expect(screen.getByText("marcel@gmail.example")).toBeTruthy();
});

test("the active account is marked and the trigger shows its name",
  async () => {
    cfg = multiCfg;
    state = { ...baseState };
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText("Profile & settings")
      .textContent).toContain("proton"));
    await openMenu();
    const rows = screen.getAllByRole("menuitemradio");
    const active = rows.find((r) => r.getAttribute("aria-checked") === "true");
    expect(active?.textContent).toContain("proton");
    expect(rows.filter((r) => r.getAttribute("aria-checked") === "true"))
      .toHaveLength(1);
  });

test("clicking a different account switches; clicking the active one " +
  "does not re-fetch", async () => {
  cfg = multiCfg;
  state = { ...baseState };
  render(<App />);
  await waitFor(() => expect(screen.getByLabelText("Profile & settings")
    .textContent).toContain("proton"));
  await settleStateCalls();
  const callsAfterMount = stateCalls.n;

  // Clicking the ALREADY active account must not trigger a state refetch.
  await openMenu();
  fireEvent.click(screen.getByText("marcel@proton.example"));
  expect(stateCalls.n).toBe(callsAfterMount);

  // Clicking a DIFFERENT account switches (new refresh, trigger updates).
  await openMenu();
  fireEvent.click(screen.getByText("marcel@icloud.example"));
  await waitFor(() => expect(screen.getByLabelText("Profile & settings")
    .textContent).toContain("icloud"));
  expect(stateCalls.n).toBeGreaterThan(callsAfterMount);
  expect(localStorage.getItem("pmc_account")).toBe("icloud");
});

test("single account: no Accounts section, header keeps the plain " +
  "profile trigger", async () => {
  cfg = singleCfg;
  state = { ...baseState };
  render(<App />);
  await openMenu();
  expect(screen.queryByText("Accounts")).toBeNull();
  expect(screen.queryByRole("menuitemradio")).toBeNull();
});

test("header has a single account control, not a separate pill strip",
  async () => {
    cfg = multiCfg;
    state = { ...baseState };
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText("Profile & settings")
      .textContent).toContain("proton"));
    // Before opening the menu, only the trigger mentions account names -
    // no standalone per-account pill buttons sit in the header.
    const matches = screen.getAllByText((_, el) =>
      el?.textContent === "proton" || el?.textContent === "icloud"
      || el?.textContent === "gmail");
    expect(matches).toHaveLength(1);
  });

test("shows an update banner once the server build changes, and " +
  "reloading works", async () => {
  cfg = singleCfg;
  state = { ...baseState };
  versions = ["v1", "v2"];       // first poll establishes the baseline
  vi.useFakeTimers();
  try {
    render(<App />);
    await vi.advanceTimersByTimeAsync(0);        // flush the initial check
    expect(screen.queryByText(/new version/i)).toBeNull();
    await vi.advanceTimersByTimeAsync(20_000);   // the next poll tick
    expect(screen.getByText(/new version/i)).toBeTruthy();
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    fireEvent.click(screen.getByText("Reload"));
    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  } finally {
    vi.useRealTimers();
  }
});

test("profile menu shows the release version and the build this tab " +
  "actually loaded with", async () => {
    cfg = singleCfg;
    state = { ...baseState };
    versions = ["abc123"];
    render(<App />);
    await openMenu();
    // package.json's version baked in via vite.config.ts's define, plus
    // the loaded build hash from the (mocked) /api/version poll.
    expect(screen.getByText(/^v[\d.]+ \(build abc123\)$/)).toBeTruthy();
  });

const groupFixture = {
  key: "noreply@dhl.example", label: "DHL Paket", sub: "noreply@dhl.example",
  count: 3, size: 1000, unread: 0, first: "2024-01-01", last: "2024-06-01",
  tags: [], samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
};

// Pre-seed the active account so the initial render skips the "drop a
// stale saved account" bootstrap round-trip (cfg -> switchAccount ->
// refetch), which otherwise races with the assertions below (see the
// same pattern/comment in App.retention.test.tsx).
const renderWithOneSenderGroup = () => {
  cfg = singleCfg;
  localStorage.setItem("pmc_account", "proton");
  state = { ...baseState, status: "done",
    groups: { sender: { [groupFixture.key]: groupFixture },
              domain: {}, subject: {} } };
  return render(<App />);
};

test("Block button confirms, then calls api.block with the trash-existing " +
  "choice", async () => {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  renderWithOneSenderGroup();
  await waitFor(() => expect(screen.getAllByText("DHL Paket").length)
    .toBeGreaterThan(0));
  fireEvent.click(screen.getAllByText("Block")[0]);
  expect(confirmSpy).toHaveBeenCalledWith(
    expect.stringContaining("DHL Paket"));
  await waitFor(() => expect(block).toHaveBeenCalledWith(
    "sender", "noreply@dhl.example", "DHL Paket", true));
  confirmSpy.mockRestore();
});

test("declining the block confirmation never calls api.block", async () => {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
  renderWithOneSenderGroup();
  await waitFor(() => expect(screen.getAllByText("DHL Paket").length)
    .toBeGreaterThan(0));
  fireEvent.click(screen.getAllByText("Block")[0]);
  expect(block).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});

const blockRuleFixture = {
  id: "rule1", name: "DHL Paket", grouping: "sender" as const,
  query: "from:noreply@dhl.example", action: "trash", dest: "",
  schedule: "daily" as const, mode: "execute" as const, keep_latest: null,
  older_than_days: null, origin: "block" as const, report_runs: 1,
  created: 0, last_run: null,
};

const renderWithOneBlockedSenderGroup = () => {
  cfg = singleCfg;
  localStorage.setItem("pmc_account", "proton");
  state = { ...baseState, status: "done",
    groups: { sender: { [groupFixture.key]: groupFixture },
              domain: {}, subject: {} },
    rules: [blockRuleFixture] };
  return render(<App />);
};

test("a blocked group shows Unblock (not Block), which confirms and " +
  "deletes the rule", async () => {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  renderWithOneBlockedSenderGroup();
  await waitFor(() => expect(screen.getAllByText("DHL Paket").length)
    .toBeGreaterThan(0));
  expect(screen.queryAllByText("Block").length).toBe(0);
  fireEvent.click(screen.getAllByText("Unblock")[0]);
  expect(confirmSpy).toHaveBeenCalledWith(
    expect.stringContaining("DHL Paket"));
  await waitFor(() => expect(deleteRule).toHaveBeenCalledWith("rule1"));
  confirmSpy.mockRestore();
});

test("declining the unblock confirmation never calls api.deleteRule",
  async () => {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
  renderWithOneBlockedSenderGroup();
  await waitFor(() => expect(screen.getAllByText("DHL Paket").length)
    .toBeGreaterThan(0));
  fireEvent.click(screen.getAllByText("Unblock")[0]);
  expect(deleteRule).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});
