// @vitest-environment jsdom
/* Bulk-action retention selector (keep-latest-N / older-than-N-days). */

import { act, cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

let state: any;

// Stub EventSource so the SSE effect in App.tsx connects (instead of
// hitting the try/catch "unavailable" fallback jsdom normally takes),
// letting tests drive status ticks explicitly.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { FakeEventSource.instances.push(this); }
  close() {}
}
vi.stubGlobal("EventSource", FakeEventSource);

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    emptyTrash: () => Promise.resolve({ ok: true }),
    logout: () => Promise.resolve(),
    exportUrl: (mode: string) => `/api/export?grouping=${mode}`,
    version: () => Promise.resolve({ build: "v1" }),
    deleteGroups: vi.fn().mockResolvedValue({ ok: true, queued: 1, skipped: 0 }),
    group: vi.fn().mockResolvedValue([]),
  },
  setAccount: () => {},
  withAccount: (p: string) => p,
}));

const { api } = await import("./api");
const deleteGroups = api.deleteGroups as ReturnType<typeof vi.fn>;
const groupApi = api.group as ReturnType<typeof vi.fn>;

import App from "./App";
import type { AppState, Config, Group } from "./types";

const acctCfg = {
  excluded_folders: [] as string[],
  host: "h", port: 993, security: "ssl" as const,
  smtp_host: "", smtp_port: 587, smtp_security: "auto" as const,
  user: "", password: "", password_set: true,
  cafile: "", preset: "custom" as const, oauth: null,
};

const cfg: Config = {
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {},
  ai: { provider: "anthropic", model: "claude-sonnet-5",
    foundry_endpoint: "", price_in: 0, price_out: 0, budget_usd: 0,
    month_cost: 0, prices_effective: [2, 10], api_key: "",
    api_key_set: false, available: false, source: null,
    shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
  default_account: "proton",
  accounts: { proton: { ...acctCfg, user: "marcel@proton.example" } },
};

const group: Group = {
  key: "news@shop.example", label: "Shop News", sub: "news@shop.example",
  count: 12, size: 12000, unread: 2, first: "2024-01-01", last: "2025-01-01",
  tags: [], samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
};

const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: ["Archive"],
  groups: { sender: { [group.key]: group }, domain: {}, subject: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: ["Archive"],
  rules: [],
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  deleteGroups.mockClear();
  groupApi.mockClear();
  groupApi.mockResolvedValue([]);
  FakeEventSource.instances.length = 0;
});

// Pre-seed the active account so the initial render skips the
// "drop a stale saved account" bootstrap round-trip (cfg -> switchAccount
// -> refetch) that otherwise races with the assertions below.
const mountReady = () => localStorage.setItem("pmc_account", "proton");

const selectFirstGroup = async () => {
  await waitFor(() => expect(screen.getAllByRole("checkbox").length)
    .toBeGreaterThan(1), { timeout: 5000 });
  const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
  // First checkbox is the "select all" header checkbox - pick the row's.
  fireEvent.click(boxes[1]);
};

test("defaults to acting on every mail (no retention)", async () => {
  state = { ...baseState };
  mountReady();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<App />);
  await selectFirstGroup();
  fireEvent.click(screen.getByText(/^Trash \d+$/));
  await waitFor(() => expect(deleteGroups).toHaveBeenCalledOnce());
  expect(deleteGroups).toHaveBeenCalledWith(
    "sender", [group.key], "trash", "", false, null, null);
});

test("keep-latest-N is sent through to the delete call", async () => {
  state = { ...baseState };
  mountReady();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<App />);
  await selectFirstGroup();

  fireEvent.change(screen.getByTitle("Restrict this action to mails " +
    "beyond a keep-window instead of every mail in the selected groups."),
    { target: { value: "keep_latest" } });
  const n = await screen.findByPlaceholderText("N");
  fireEvent.change(n, { target: { value: "3" } });

  fireEvent.click(screen.getByText(/^Trash \d+$/));
  await waitFor(() => expect(deleteGroups).toHaveBeenCalledOnce());
  expect(deleteGroups).toHaveBeenCalledWith(
    "sender", [group.key], "trash", "", false, 3, null);
});

test("the Trash button count corrects itself to the retention-adjusted " +
  "number instead of the full group count", async () => {
  state = { ...baseState };
  mountReady();
  // group.count is 12; only 7 of those mails would survive a keep_latest:5
  // restriction (5 kept as the newest, per retainedMailKeys parity logic).
  groupApi.mockResolvedValue(
    Array.from({ length: 12 }, (_, i) => (
      { folder: "INBOX", uid: i + 1, ts: 1000 + i })));
  render(<App />);
  await selectFirstGroup();

  // Before the fetch resolves, the button shows the naive (full) count.
  expect(screen.getByText("Trash 12")).toBeTruthy();

  fireEvent.change(screen.getByTitle("Restrict this action to mails " +
    "beyond a keep-window instead of every mail in the selected groups."),
    { target: { value: "keep_latest" } });
  const n = await screen.findByPlaceholderText("N");
  fireEvent.change(n, { target: { value: "5" } });

  await waitFor(() => expect(screen.getByText("Trash 7")).toBeTruthy(),
    { timeout: 2000 });
  expect(groupApi).toHaveBeenCalledWith("sender", group.key);
});

test("an unrelated SSE status tick does not flap the settled count back " +
  "to the naive total or re-fetch", async () => {
  state = { ...baseState };
  mountReady();
  groupApi.mockResolvedValue(
    Array.from({ length: 12 }, (_, i) => (
      { folder: "INBOX", uid: i + 1, ts: 1000 + i })));
  render(<App />);
  await selectFirstGroup();

  fireEvent.change(screen.getByTitle("Restrict this action to mails " +
    "beyond a keep-window instead of every mail in the selected groups."),
    { target: { value: "keep_latest" } });
  const n = await screen.findByPlaceholderText("N");
  fireEvent.change(n, { target: { value: "5" } });
  await waitFor(() => expect(screen.getByText("Trash 7")).toBeTruthy());
  groupApi.mockClear();

  // A slim status tick (job progress, heartbeat, …) with the SAME
  // account/groups_rev as the current state - group data hasn't actually
  // changed, so the settled count must neither reset nor re-fetch.
  const es = FakeEventSource.instances.at(-1);
  expect(es).toBeTruthy();
  act(() => {
    es!.onmessage?.({ data: JSON.stringify(
      { ...baseState, progress: "tick", groups: undefined }) });
  });

  expect(screen.getByText("Trash 7")).toBeTruthy();
  expect(screen.queryByText("Trash 12")).toBeNull();
  expect(groupApi).not.toHaveBeenCalled();
});

test("older-than-days is sent through to the delete call", async () => {
  state = { ...baseState };
  mountReady();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<App />);
  await selectFirstGroup();

  fireEvent.change(screen.getByTitle("Restrict this action to mails " +
    "beyond a keep-window instead of every mail in the selected groups."),
    { target: { value: "older_than_days" } });
  const n = await screen.findByPlaceholderText("N");
  fireEvent.change(n, { target: { value: "30" } });

  fireEvent.click(screen.getByText(/^Trash \d+$/));
  await waitFor(() => expect(deleteGroups).toHaveBeenCalledOnce());
  expect(deleteGroups).toHaveBeenCalledWith(
    "sender", [group.key], "trash", "", false, null, 30);
});
