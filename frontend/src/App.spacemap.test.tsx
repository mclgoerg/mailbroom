// @vitest-environment jsdom
/* Space map through the app: Tools -> Space map -> tick -> Done lands on the
 * Sender tab with exactly those senders selected; the bulk bar's Trash then
 * confirms with their counts (and Cancel leaves everything alone). */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

let state: any;
const deleteGroups = vi.fn().mockResolvedValue({ ok: true });
const mails = vi.fn().mockResolvedValue({
  total: 1, offset: 0, ignored: [],
  mails: [{ uid: 7, folder: "INBOX", date: "2026-01-02", ts: 1,
    subject: "Flat mail", addr: "a@x.example", size: 10, seen: true,
    ai: null, pinned: false }],
});

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
    mails: (...a: unknown[]) => mails(...a),
    group: () => Promise.resolve([]),
    deleteGroups: (...a: unknown[]) => deleteGroups(...a),
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
import { cancelDialog, expectNoDialog, findDialog } from "./dialogTestUtils";
import type { AppState, Config } from "./types";

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
    available: true, source: null, shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
} as unknown as Config;

const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: ["INBOX"],
  groups: { sender: {}, smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: ["INBOX"], rules: [],
  presets: [],
};




const mk = (key: string, size: number, count: number, over = {}) => ({
  key, label: key, sub: key, count, size, unread: 0, first: "2020-03-01",
  last: "2020-03-03", tags: [], samples: [key], bulk: false, unsub: false,
  ai: null, ratings: null, protected: false, replied: false, att_size: 0,
  unsubscribed: null, new: false, pinned: 0, engagement: 50, ...over,
});


const SENDERS = Object.fromEntries([
  mk("a@big.example", 6e8, 30), mk("b@big.example", 2e8, 12),
  mk("p@big.example", 1e8, 7, { protected: true }),
  mk("c@other.example", 9e8, 99),
].map((g) => [g.key, g]));

const boot = async () => {
  state = { ...baseState, groups: { ...baseState.groups, sender: SENDERS } };
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await screen.findByPlaceholderText("filter groups…");
  await waitFor(() => expect(screen.getAllByText("a@big.example").length)
    .toBeGreaterThan(0), { timeout: 5000 });
};
const openMap = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Tools" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /^Space map/ }));
  return screen.findByTestId("space-map");
};
const tickDomain = (map: HTMLElement, re: RegExp) => {
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  fireEvent.click(within(map).getByRole("button", { name: re }));
};

afterEach(() => {
  cleanup();
  deleteGroups.mockClear();
  localStorage.clear();
});

test("Done: Sender tab, exactly the non-protected senders selected, Trash "
  + "confirms their counts", async () => {
  const senders = Object.fromEntries([
    mk("a@big.example", 6e8, 30), mk("b@big.example", 2e8, 12),
    mk("p@big.example", 1e8, 7, { protected: true }),
    mk("c@other.example", 9e8, 99),
  ].map((g) => [g.key, g]));
  state = { ...baseState, groups: { ...baseState.groups, sender: senders } };
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await screen.findByPlaceholderText("filter groups…");
  await waitFor(() => expect(screen.getAllByText("a@big.example").length)
    .toBeGreaterThan(0));
  // start on another grouping: Done must bring the list back to Sender
  fireEvent.click(screen.getByRole("tab", { name: "Subject" }));
  fireEvent.click(screen.getByRole("button", { name: "Tools" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /^Space map/ }));
  const map = await screen.findByTestId("space-map");
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  fireEvent.click(within(map).getByRole("button", { name: /^big\.example/ }));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));

  await waitFor(() => expect(screen.queryByTestId("space-map")).toBeNull());
  expect(screen.getByRole("tab", { name: "Sender" })
    .getAttribute("aria-selected")).toBe("true");
  await waitFor(() => expect(screen.getByText("2 groups · 42 mails"))
    .toBeTruthy());
  fireEvent.click(screen.getByText("Trash 42"));
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("42 mails from 2 groups");
  await cancelDialog();
  await expectNoDialog();
  expect(deleteGroups).not.toHaveBeenCalled();
});

test("Done replaces a selection made in another tab", async () => {
  await boot();
  fireEvent.click(screen.getByRole("tab", { name: "Subject" }));
  fireEvent.click(screen.getByRole("tab", { name: "Sender" }));
  fireEvent.click(screen.getAllByRole("checkbox")[1]);        // a row ticked first
  const map = await openMap();
  tickDomain(map, /^other\.example/);
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.getByText("1 group · 99 mails")).toBeTruthy());
});

test("Done clears an active filter and says so", async () => {
  await boot();
  fireEvent.change(screen.getByPlaceholderText("filter groups…"),
    { target: { value: "big" } });
  const map = await openMap();
  tickDomain(map, /^other\.example/);
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(await screen.findByText("Filter cleared to show your selection."))
    .toBeTruthy();
  expect((screen.getByPlaceholderText("filter groups…") as HTMLInputElement)
    .value).toBe("");
});

test("Done without a filter shows no such notice", async () => {
  await boot();
  const map = await openMap();
  tickDomain(map, /^other\.example/);
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByTestId("space-map")).toBeNull());
  expect(screen.queryByText("Filter cleared to show your selection.")).toBeNull();
});

test("switching account closes the map (it must not reopen on the other one)",
  async () => {
    (cfg.accounts as any).second = { ...(cfg.accounts as any).proton,
      user: "two@x.example" };
    try {
      await boot();
      await openMap();
      fireEvent.click(screen.getByRole("button", { name: "Profile & settings" }));
      fireEvent.click(await screen.findByRole("menuitemradio", { name: /second/ }));
      await waitFor(() => expect(screen.queryByTestId("space-map")).toBeNull());
      await waitFor(() => expect(screen.getAllByText("a@big.example").length)
        .toBeGreaterThan(0), { timeout: 5000 });
      expect(screen.queryByTestId("space-map")).toBeNull();
    } finally { delete (cfg.accounts as any).second; }
  });
