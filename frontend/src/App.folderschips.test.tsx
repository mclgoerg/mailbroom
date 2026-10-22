// @vitest-environment jsdom
/* Entry points of the Folders panel: the Junk count chip beside the Trash
 * chip (icon + number, translated aria-labels), the Trash chip opens Trash,
 * the Junk chip and the Tools entry open Junk; the phone header with both
 * chips, the multi-account avatar and German labels. */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

let state: any;
let stateLoaded = false;
const foldersPanel = vi.fn();

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => { stateLoaded = true; return Promise.resolve(state); },
    logout: () => Promise.resolve(),
    exportUrl: () => "",
    version: () => Promise.resolve({ build: "v1" }),
    group: () => Promise.resolve([]),
    foldersPanel: (role: string) => foldersPanel(role),
  },
  setAccount: () => {},
  withAccount: (p: string) => p,
  fmtSize: (b: number) => `${b} B`,
  fmtUsd: (c: number) => `$${c}`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
}));

import { DialogProvider, ToastProvider } from "./components/ui";
import type { AppState, Config } from "./types";

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

const cfgBase: Omit<Config, "accounts" | "default_account"> = {
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


import App from "./App";
import { setLang } from "./i18n";

let cfg: Config = singleCfg;

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
  trash_count: 12, junk_count: 3, notice: null, undo: [], folders_raw: [],
  rules: [], presets: [],
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  foldersPanel.mockReset();
  setLang("en");
});

const mount = async (over: Partial<AppState> = {},
                     config: Config = singleCfg) => {
  cfg = config;
  stateLoaded = false;
  localStorage.setItem("pmc_account", "proton");
  state = { ...baseState, ...over };
  foldersPanel.mockImplementation((role: string) => Promise.resolve({
    folder: role === "junk" ? "Spam" : "Trash", uv: 1, total: 0, max_uid: 0,
    mails: [], senders: [] }));
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await screen.findByRole("button", { name: /Tools|Werkzeuge/ });
  await waitFor(() => expect(stateLoaded).toBe(true));
};

test("Junk chip beside the Trash chip: icon + number, translated aria-labels",
  async () => {
    await mount();
    const junk = await screen.findByLabelText("Junk (3 mails)");
    const trash = screen.getByLabelText("Trash (12 mails)");
    expect(junk.textContent?.trim()).toBe("3");           // icon + number only
    expect(trash.textContent?.trim()).toBe("12");
    expect(junk.querySelector("svg")).toBeTruthy();
    // Junk first, then Trash, in the same header cluster
    expect(junk.compareDocumentPosition(trash)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(junk.parentElement).toBe(trash.parentElement);
  });

test("singular label and German labels", async () => {
  await mount({ junk_count: 1, trash_count: 1 });
  expect(await screen.findByLabelText("Junk (1 mail)")).toBeTruthy();
  cleanup();
  setLang("de");
  await mount({ junk_count: 4 }, multiCfg);
  expect((await screen.findByLabelText("Spam (4 Mails)")).textContent?.trim())
    .toBe("4");
  expect(screen.getByLabelText("Papierkorb (12 Mails)").textContent?.trim())
    .toBe("12");
});

test("no Junk chip while Junk is empty or the count is unknown", async () => {
  await mount({ junk_count: 0 });
  expect(screen.queryByLabelText(/^Junk \(/)).toBeNull();
  cleanup();
  await mount({ junk_count: null });
  expect(screen.queryByLabelText(/^Junk \(/)).toBeNull();
  cleanup();
  await mount({ junk_count: undefined });
  expect(screen.queryByLabelText(/^Junk \(/)).toBeNull();
  expect(screen.getByLabelText("Trash (12 mails)")).toBeTruthy();
});

test("the Trash chip opens the panel on Trash, the Junk chip on Junk",
  async () => {
    await mount();
    fireEvent.click(await screen.findByLabelText("Trash (12 mails)"));
    await waitFor(() => expect(foldersPanel).toHaveBeenLastCalledWith("trash"));
    expect(screen.getByRole("tab", { name: "Trash" })
      .getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByLabelText("Junk (3 mails)"));
    await waitFor(() => expect(foldersPanel).toHaveBeenLastCalledWith("junk"));
    expect(screen.getByRole("tab", { name: "Junk" })
      .getAttribute("aria-selected")).toBe("true");
  });

test("the Tools menu has a Junk & Trash entry that opens Junk", async () => {
  await mount({ junk_count: 0, trash_count: 0 });     // works without chips
  fireEvent.click(screen.getByRole("button", { name: /Tools/ }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Junk & Trash/ }));
  await waitFor(() => expect(foldersPanel).toHaveBeenLastCalledWith("junk"));
});

test("phone header: chips stay icon + number (no text label wider than the count)",
  async () => {
    await mount({ junk_count: 120, trash_count: 4500 }, multiCfg);
    const junk = await screen.findByLabelText("Junk (120 mails)");
    expect(junk.textContent?.trim()).toBe("120");
    expect(junk.className).toContain("whitespace-nowrap");
    // the header cluster does not wrap on phones
    expect(junk.parentElement!.className).toContain("flex");
    expect(screen.getByLabelText("Trash (4500 mails)").textContent?.trim())
      .toBe("4500");
  });
