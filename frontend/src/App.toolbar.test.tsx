// @vitest-environment jsdom
/* Toolbar: labelled Tools menu, grouping segments, merged Inactive chip,
 * phone sort menu. */

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
import { ToastProvider } from "./components/ui";
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
  groups: { sender: {}, domain: {}, subject: {}, thread: {} },
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
  cfg.ai.available = true;
  localStorage.clear();
  vi.unstubAllGlobals();
});

const group = {
  key: "a@x.example", label: "Acme", sub: "a@x.example", count: 3,
  size: 6000, unread: 1, first: "2020-03-01", last: "2020-03-03", tags: [],
  samples: ["a@x.example"], bulk: false, unsub: false, ai: null,
  ratings: null, protected: false, replied: false, att_size: 0,
  unsubscribed: null, new: false, pinned: 0, engagement: 50,
};

const open = async () => {
  state = { ...baseState, groups: { ...baseState.groups,
    sender: { [group.key]: group } } };
  render(<ToastProvider><App /></ToastProvider>);
  await screen.findByPlaceholderText("filter groups…");
  await waitFor(() => expect(screen.getAllByText("Acme").length)
    .toBeGreaterThan(0));
};

test("the Tools menu lists every tool with a label; no loose tool icons",
  async () => {
    await open();
    for (const n of ["Rules", "Attachments", "Duplicates", "Statistics",
      "Audit Log"]) expect(screen.queryByLabelText(n)).toBeNull();
    expect(screen.queryByLabelText("More")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    for (const n of ["Rules", "Attachments", "Duplicates", "Statistics",
      "Audit Log", "AI review", "Export CSV"])
      expect(screen.getByRole("menuitem", { name: new RegExp(`^${n}`) }))
        .toBeTruthy();
    expect(screen.getByLabelText("Search all mails")).toBeTruthy();
  });

test("a Tools entry opens its panel", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Tools" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /^Rules/ }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
});

test("the grouping segments mark the current one with aria-selected",
  async () => {
    await open();
    const sel = () => screen.getAllByRole("tab")
      .filter((b) => b.getAttribute("aria-selected") === "true")
      .map((b) => b.textContent);
    expect(screen.getAllByRole("tab").map((b) => b.textContent))
      .toEqual(["Sender", "Domain", "Subject", "Thread", "All mails"]);
    expect(sel()).toEqual(["Sender"]);
    fireEvent.click(screen.getByRole("tab", { name: "Domain" }));
    expect(sel()).toEqual(["Domain"]);
    fireEvent.click(screen.getByRole("tab", { name: "All mails" }));
    expect(sel()).toEqual(["All mails"]);
  });

test("each Inactive segment applies its own preset", async () => {
  await open();
  const box = () => (screen.getByPlaceholderText("filter groups…") as
    HTMLInputElement).value;
  expect(screen.getByRole("group", { name: "Inactive:" })).toBeTruthy();
  for (const [name, q] of [["6 mo", "age:>6m"], ["1 yr", "age:>1y"],
    ["2 yr", "age:>2y"]]) {
    fireEvent.click(screen.getByRole("button", { name }));
    expect(box()).toBe(q);
    expect(screen.getByRole("button", { name })
      .getAttribute("aria-pressed")).toBe("true");
  }
});

test("on a phone the sort control is a menu for key and direction",
  async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: true, media: q, addEventListener: () => {},
      removeEventListener: () => {},
    }));
    await open();
    expect(screen.queryByDisplayValue("Sort: mails")).toBeNull();
    const trigger = () => screen.getByRole("button", { name: /^Sort: / });
    expect(trigger().getAttribute("aria-label")).toBe("Sort: mails, descending");
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Sort: size" }));
    expect(localStorage.getItem("pmc_sort_k")).toBe("size");
    fireEvent.click(trigger());
    expect(screen.getByRole("menuitemradio", { name: /^Sort: size/ })
      .getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: /^Descending/ })
      .getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Ascending" }));
    expect(localStorage.getItem("pmc_sort_dir")).toBe("1");
  });

test("All mails keeps its filter and sort in the toolbar row", async () => {
  await open();
  const rowA = screen.getByRole("tablist").parentElement!.parentElement!;
  expect(rowA.nextElementSibling?.contains(
    screen.getByPlaceholderText("filter groups…"))).toBe(true);
  fireEvent.click(screen.getByRole("tab", { name: "All mails" }));
  const input = await screen.findByPlaceholderText("filter mails…");
  expect(screen.getByDisplayValue("Date")).toBeTruthy();
  // Same slot as the group filter: directly under row A (Scan + tabs).
  expect(rowA.nextElementSibling?.contains(input)).toBe(true);
});

test("while scanning with AI unavailable: Duplicates disabled, no AI review",
  async () => {
    cfg.ai.available = false;
    state = { ...baseState, status: "scanning", groups: { ...baseState.groups,
      sender: { [group.key]: group } } };
    render(<ToastProvider><App /></ToastProvider>);
    await waitFor(() => expect(screen.getAllByText("Acme").length)
      .toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect((screen.getByRole("menuitem", { name: /^Duplicates/ }) as
      HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("menuitem", { name: /^AI review/ })).toBeNull();
  });

test("Enter on a focused grouping tab doesn't trigger the list's Enter-opens-" +
  "detail shortcut", async () => {
  await open();
  Element.prototype.scrollIntoView = () => {};              // jsdom lacks it
  fireEvent.keyDown(document.body, { key: "j" });          // focus row 0
  fireEvent.keyDown(screen.getByRole("tab", { name: "Domain" }),
    { key: "Enter" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("after clicking a grouping tab, j still moves the row focus", async () => {
  await open();
  Element.prototype.scrollIntoView = () => {};              // jsdom lacks it
  const tab = screen.getByRole("tab", { name: "Sender" });
  fireEvent.click(tab);
  tab.focus();
  fireEvent.keyDown(tab, { key: "j" });
  await waitFor(() => expect(document.querySelector('[data-gidx="0"]'))
    .toBeTruthy());
  expect(document.querySelector('[data-gidx="0"]')?.className)
    .toMatch(/outline-accent|bg-panel/);
});
