// @vitest-environment jsdom
/* View switcher: "All mails" sits beside the grouping tabs, swaps the
 * group chrome (filter, chips, sort) for the flat list, and is remembered. */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

let state: any;
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
    available: false, source: null, shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
} as unknown as Config;

const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: ["INBOX"],
  groups: { sender: {}, domain: {}, subject: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: ["INBOX"], rules: [],
  presets: [],
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  mails.mockClear();
});

test("All mails swaps the group chrome for the flat list and back",
  async () => {
    state = { ...baseState };
    render(<App />);
    await screen.findByPlaceholderText("filter groups…");
    expect(screen.queryByPlaceholderText("filter mails…")).toBeNull();

    fireEvent.click(screen.getByText("All mails"));
    await screen.findByText("Flat mail");
    expect(screen.getByPlaceholderText("filter mails…")).toBeTruthy();
    expect(screen.queryByPlaceholderText("filter groups…")).toBeNull();
    expect(screen.queryByText("Inactive > 6 months")).toBeNull();  // chips
    expect(localStorage.getItem("pmc_view")).toBe("mails");

    fireEvent.click(screen.getByRole("button", { name: "Sender" }));
    await screen.findByPlaceholderText("filter groups…");
    expect(screen.queryByText("Flat mail")).toBeNull();
    expect(localStorage.getItem("pmc_view")).toBe("groups");
  });

test("the chosen view is restored on reload", async () => {
  localStorage.setItem("pmc_view", "mails");
  state = { ...baseState };
  render(<App />);
  await screen.findByText("Flat mail");
  await waitFor(() => expect(mails).toHaveBeenCalled());
});
