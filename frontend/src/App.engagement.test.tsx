// @vitest-environment jsdom
/* Engagement sort: the "Sort: engagement" option orders groups by score,
 * and the choice survives reloads. */

import { cleanup, fireEvent, render, screen, waitFor } from
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
import { ToastProvider } from "./components/ui";
import type { AppState, Config, Group } from "./types";

const acctCfg = {
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
  accounts: { proton: { ...acctCfg, user: "marcel@proton.example" } },
};

const group: Group = {
  key: "news@shop.example", label: "Shop News", sub: "news@shop.example",
  count: 12, size: 12000, unread: 2, first: "2024-01-01", last: "2025-01-01",
  tags: [], samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
  new: false,
  pinned: 0,
  engagement: 50,
};

const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: ["Archive"],
  groups: { sender: { [group.key]: group }, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: ["Archive"],
  rules: [], presets: [],
};


const mk = (key: string, label: string, engagement: number): Group => ({
  ...group, key, label, sub: key, engagement });

const withGroups = (...gs: Group[]): AppState => ({ ...baseState,
  groups: { sender: Object.fromEntries(gs.map((g) => [g.key, g])),
    domain: {}, subject: {}, thread: {} } });

afterEach(() => {
  cleanup();
  localStorage.clear();
  FakeEventSource.instances.length = 0;
});

const rowLabels = (container: HTMLElement) =>
  [...container.querySelectorAll("tbody tr")]
    .map((tr) => tr.querySelector("button")!.textContent);

const mountReady = () => localStorage.setItem("pmc_account", "proton");

test("sorting by engagement orders groups high to low, and the arrow " +
  "flips it", async () => {
  state = withGroups(mk("a@x", "Alpha", 10), mk("b@x", "Bravo", 90),
    mk("c@x", "Charlie", 50));
  mountReady();
  const { container } = render(<ToastProvider><App /></ToastProvider>);
  await waitFor(() => expect(rowLabels(container).length).toBe(3),
    { timeout: 5000 });

  fireEvent.change(screen.getByDisplayValue("Sort: mails"),
    { target: { value: "engagement" } });
  await waitFor(() => expect(rowLabels(container))
    .toEqual(["Bravo", "Charlie", "Alpha"]));

  fireEvent.click(screen.getByLabelText(/Sorted descending/));
  await waitFor(() => expect(rowLabels(container))
    .toEqual(["Alpha", "Charlie", "Bravo"]));
});

test("the engagement sort is persisted like the other sort keys", async () => {
  state = withGroups(mk("a@x", "Alpha", 10), mk("b@x", "Bravo", 90));
  mountReady();
  const first = render(<ToastProvider><App /></ToastProvider>);
  await waitFor(() => expect(rowLabels(first.container).length).toBe(2),
    { timeout: 5000 });
  fireEvent.change(screen.getByDisplayValue("Sort: mails"),
    { target: { value: "engagement" } });
  await waitFor(() =>
    expect(localStorage.getItem("pmc_sort_k")).toBe("engagement"));
  first.unmount();

  const again = render(<ToastProvider><App /></ToastProvider>);
  await waitFor(() => expect(rowLabels(again.container).length).toBe(2),
    { timeout: 5000 });
  expect(screen.getByDisplayValue("Sort: engagement")).toBeTruthy();
  expect(rowLabels(again.container)).toEqual(["Bravo", "Alpha"]);
});

test("an eng:low filter shows only the low-engagement groups", async () => {
  state = withGroups(mk("a@x", "Alpha", 10), mk("b@x", "Bravo", 90),
    mk("c@x", "Charlie", 33));
  mountReady();
  const { container } = render(<ToastProvider><App /></ToastProvider>);
  await waitFor(() => expect(rowLabels(container).length).toBe(3),
    { timeout: 5000 });
  fireEvent.change(screen.getByPlaceholderText(/Filter/i),
    { target: { value: "eng:low" } });
  await waitFor(() => expect(rowLabels(container).sort())
    .toEqual(["Alpha", "Charlie"]));
});
