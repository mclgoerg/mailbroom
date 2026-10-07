// @vitest-environment jsdom
/* Feedback: job outcomes arrive as toasts (with Undo after a move), errors
 * stay until dismissed, the status line keeps only the summary + progress,
 * and an empty filter is not mistaken for "no scan yet". */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

let state: any;

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
    logout: () => Promise.resolve(),
    exportUrl: (mode: string) => `/api/export?grouping=${mode}`,
    version: () => Promise.resolve({ build: "v1" }),
    undo: vi.fn().mockResolvedValue({ ok: true }),
  },
  setAccount: () => {},
  withAccount: (p: string) => p,
}));

const { api } = await import("./api");
const undoApi = api.undo as ReturnType<typeof vi.fn>;

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


afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.stubGlobal("EventSource", FakeEventSource);
  localStorage.clear();
  FakeEventSource.instances.length = 0;
  undoApi.mockClear();
});

Element.prototype.scrollIntoView = () => {};

const mount = async (st: AppState) => {
  state = st;
  localStorage.setItem("pmc_account", "proton");
  const r = render(<ToastProvider><App /></ToastProvider>);
  await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
  await waitFor(() => expect(r.container.textContent).toMatch(/scanned|No scan/));
  return r;
};
// Push a slim status tick down the SSE stream.
const tick = (patch: Partial<AppState>) => {
  const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
  const { groups: _g, ...slim } = { ...state, ...patch };
  state = { ...state, ...patch };
  act(() => es.onmessage!({ data: JSON.stringify(slim) }));
};
const job = (status: string, extra: object = {}) =>
  ({ status, progress: "", error: "", moved: 0, ...extra });

test("a finished move shows a toast whose Undo restores the latest entry",
  async () => {
    vi.stubGlobal("confirm", () => true);
    await mount({ ...baseState });
    tick({ delete: job("running", { progress: "3/12" }) as any });
    tick({ delete: job("done", { moved: 12 }) as any,
      undo: [{ ts: 7, label: "Shop News", count: 12, action: "trash" }] });
    const msg = await screen.findByText("Moved 12 mails to Trash");
    const bar = msg.parentElement!;
    fireEvent.click(within(bar).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(undoApi).toHaveBeenCalledWith(0));
    // The toast closes after its action.
    expect(screen.queryByText("Moved 12 mails to Trash")).toBeNull();
    // Reloading onto an already-finished job stays quiet (see below).
  });

test("an old finished job found on load does not toast", async () => {
  await mount({ ...baseState, delete: job("done", { moved: 4 }) as any });
  expect(screen.queryByText(/Moved|processed/)).toBeNull();
});

test("an error toast persists while an info toast times out", async () => {
  await mount({ ...baseState });
  vi.useFakeTimers();
  tick({ ai: { status: "error", grouping: "sender", progress: "",
    error: "boom", usage: null } });
  tick({ unsub: { status: "done", progress: "", error: "", total: 2, done: 2,
    links: 1, failed: 0, skipped: 0 } });
  const err = screen.getByText("AI error: boom");
  expect(err.closest("[data-variant]")!.getAttribute("data-variant"))
    .toBe("error");
  const ok = screen.getByText(/Unsubscribe|unsubscribe|2/, {
    selector: "[data-variant=success] div" });
  expect(ok).toBeTruthy();
  act(() => { vi.advanceTimersByTime(30_000); });
  expect(screen.queryByText("AI error: boom")).not.toBeNull();
  expect(document.querySelector("[data-variant=success]")).toBeNull();
});

test("an empty filter reads '0 of N' and Clear filter brings the list back",
  async () => {
    const { container } = await mount({ ...baseState });
    fireEvent.change(screen.getByPlaceholderText("filter groups…"),
      { target: { value: "zzz-nothing" } });
    expect(await screen.findByText("0 of 1 groups match")).toBeTruthy();
    expect(screen.getByText("No groups match this filter")).toBeTruthy();
    expect(container.textContent).not.toContain("No scan yet");
    fireEvent.click(screen.getByText("Clear filter"));
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length)
      .toBe(1));
    expect((screen.getByPlaceholderText("filter groups…") as HTMLInputElement)
      .value).toBe("");
  });

test("'No scan yet' only shows when nothing was ever scanned", async () => {
  const empty = { sender: {}, domain: {}, subject: {}, thread: {} };
  const { container } = await mount({ ...baseState, scanned_ts: null,
    groups: empty });
  expect(container.textContent).toContain("No scan yet");
  cleanup();
  FakeEventSource.instances.length = 0;
  const again = await mount({ ...baseState, scanned_ts: 1, groups: empty });
  expect(again.container.textContent).not.toContain("No scan yet");
});

test("a running job shows its progress strip, determinate when structured",
  async () => {
    await mount({ ...baseState });
    tick({ delete: job("running", { progress: "3/12" }) as any });
    const bar = await screen.findByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("3");
    expect(bar.getAttribute("aria-valuemax")).toBe("12");
    tick({ delete: job("running", { progress: "queued…" }) as any });
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow"))
      .toBeNull();
  });
