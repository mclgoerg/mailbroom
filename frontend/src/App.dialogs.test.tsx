// @vitest-environment jsdom
/* Global keyboard shortcuts stay quiet while a confirm/prompt dialog is open. */

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
import { DialogProvider, ToastProvider, confirmDialog }
  from "./components/ui";
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
  groups: { sender: { [group.key]: group }, smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: ["Archive"],
  rules: [], presets: [],
};



afterEach(() => {
  cleanup();
  localStorage.clear();
  FakeEventSource.instances.length = 0;
});

Element.prototype.scrollIntoView = () => {};

test("App shortcuts are ignored while a confirm dialog is open", async () => {
  state = { ...baseState };
  localStorage.setItem("pmc_account", "proton");
  groupApi.mockClear();
  const { container } = render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(container.querySelectorAll("tbody tr").length)
    .toBe(1), { timeout: 5000 });

  fireEvent.keyDown(window, { key: "j" });            // focus the row
  const answer = confirmDialog({ title: "Sure?", confirmLabel: "Yes",
    tone: "danger" });
  await screen.findByText("Sure?");
  fireEvent.keyDown(screen.getByText("Cancel"), { key: "Enter" });
  fireEvent.keyDown(window, { key: "o" });
  fireEvent.keyDown(window, { key: "#" });
  expect(groupApi).not.toHaveBeenCalled();            // no detail opened
  expect(api.deleteGroups).not.toHaveBeenCalled();    // no second trash
  expect(screen.getAllByRole("dialog")).toHaveLength(1);

  fireEvent.click(screen.getByText("Cancel"));
  expect(await answer).toBe(false);
  // Positive control: with the dialog gone the same key opens the detail.
  fireEvent.keyDown(window, { key: "o" });
  await waitFor(() => expect(groupApi).toHaveBeenCalled());
});
