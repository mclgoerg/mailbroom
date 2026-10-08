// @vitest-environment jsdom
/* Destructive flows that confirm through in-app dialogs: Empty Trash from
 * both entry points (profile menu + Trash panel), AI consent, restore. */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const stateCalls = { n: 0 };
let state: any;
let versions = ["v1"];        // api.version() walks through this in order
let versionCalls = 0;

let trashTotal = 5;            // what the live Trash listing reports
let trashFails = false;
const emptyTrash = vi.fn().mockResolvedValue({ ok: true });
const aiReview = vi.fn().mockResolvedValue({ ok: true });
const undoApi = vi.fn().mockResolvedValue({ ok: true });

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => { stateCalls.n++; return Promise.resolve(state); },
    emptyTrash: (...a: unknown[]) => emptyTrash(...a),
    undo: (...a: unknown[]) => undoApi(...a),
    trash: () => trashFails
      ? Promise.reject(new Error("imap down"))
      : Promise.resolve({ folder: "Trash", uv: 1, total: trashTotal, mails: [] }),
    logout: () => Promise.resolve(),
    exportUrl: (mode: string, keys?: string[]) =>
      `/api/export?grouping=${mode}`
      + (keys?.length ? `&keys=${keys.join(",")}` : ""),
    version: () => Promise.resolve(
      { build: versions[Math.min(versionCalls++, versions.length - 1)] }),
    group: () => Promise.resolve([]),
    aiReview: (...args: unknown[]) => aiReview(...args),
  },
  setAccount: () => {},
  withAccount: (p: string) => p,
  fmtSize: (b: number) => `${b} B`,
  fmtUsd: (c: number) => `$${c}`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
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

let cfg: Config = singleCfg;

const baseState: AppState = {
  account: "proton", status: "idle", scanned_ts: null, groups_rev: 0,
  progress: "", error: "", folders: [],
  groups: { sender: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: [],
  presets: [],
};

const groupFixture = {
  key: "noreply@dhl.example", label: "DHL Paket", sub: "noreply@dhl.example",
  count: 3, size: 1000, unread: 0, first: "2024-01-01", last: "2024-06-01",
  tags: [], samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  emptyTrash.mockClear();
  trashTotal = 5;
  trashFails = false;
  aiReview.mockClear();
  undoApi.mockClear();
});

const mount = async (over: Partial<AppState> = {},
                     config: Config = singleCfg) => {
  cfg = config;
  localStorage.setItem("pmc_account", "proton");
  state = { ...baseState, status: "done", trash_count: 5,
    groups: { sender: { [groupFixture.key]: groupFixture },
              domain: {}, subject: {}, thread: {} }, ...over };
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(screen.getAllByText("DHL Paket").length)
    .toBeGreaterThan(0));
};

const openProfile = () =>
  fireEvent.click(screen.getByLabelText("Profile & settings"));

test("profile menu: Empty Trash sits last, set apart and danger-styled",
  async () => {
  await mount();
  openProfile();
  const item = await screen.findByRole("menuitem", { name: /Empty Trash/ });
  expect(item.textContent).toContain("Empty Trash (5)…");
  expect(item.className).toContain("text-danger-fg");
  const menu = item.parentElement!;
  const items = [...menu.children];
  expect(items[items.indexOf(item) - 1].getAttribute("role"))
    .toBe("separator");
  const settings = screen.getByRole("menuitem", { name: /Settings/ });
  expect(items.indexOf(item)).toBeGreaterThan(items.indexOf(settings));
});

test("Empty Trash from the profile menu states N + irreversibility, then " +
  "deletes on confirm", async () => {
  await mount();
  openProfile();
  fireEvent.click(await screen.findByRole("menuitem", { name: /Empty Trash/ }));
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("5 mails in Trash");
  expect(dlg.textContent).toContain("This cannot be undone.");
  expect(emptyTrash).not.toHaveBeenCalled();
  await pressDialog("Delete permanently (5)");
  await waitFor(() => expect(emptyTrash).toHaveBeenCalledOnce());
});

test("Empty Trash uses the LIVE Trash total, not the stale state count",
  async () => {
  trashTotal = 9;                       // state.trash_count still says 5
  await mount();
  openProfile();
  fireEvent.click(await screen.findByRole("menuitem", { name: /Empty Trash/ }));
  expect((await findDialog()).textContent).toContain("9 mails in Trash");
  await pressDialog("Delete permanently (9)");
  await waitFor(() => expect(emptyTrash).toHaveBeenCalledOnce());
});

test("a single mail reads 'The 1 mail', not '1 mails'", async () => {
  trashTotal = 1;
  await mount();
  openProfile();
  fireEvent.click(await screen.findByRole("menuitem", { name: /Empty Trash/ }));
  const text = (await findDialog()).textContent!;
  expect(text).toContain("The 1 mail in Trash");
  expect(text).not.toContain("1 mails");
  await cancelDialog();
});

test("if the live count can't be fetched the button carries no number",
  async () => {
  trashFails = true;
  await mount();
  openProfile();
  fireEvent.click(await screen.findByRole("menuitem", { name: /Empty Trash/ }));
  const dlg = await findDialog();
  expect(dlg.textContent).not.toMatch(/\d+ mails/);
  expect(dlg.textContent).toContain("All mails in Trash");
  await pressDialog("Delete permanently");
  await waitFor(() => expect(emptyTrash).toHaveBeenCalledOnce());
});

test("cancelling Empty Trash from the profile menu deletes nothing",
  async () => {
  await mount();
  openProfile();
  fireEvent.click(await screen.findByRole("menuitem", { name: /Empty Trash/ }));
  await cancelDialog();
  await expectNoDialog();
  expect(emptyTrash).not.toHaveBeenCalled();
});

const openTrashPanel = async () => {
  fireEvent.click(screen.getByTitle("Browse Trash"));
  return screen.findByRole("button", { name: /Empty Trash \(5\)/ });
};

test("the Trash panel footer offers the same Empty Trash confirm",
  async () => {
  await mount();
  fireEvent.click(await openTrashPanel());
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("5 mails in Trash");
  expect(dlg.textContent).toContain("cannot be undone");
  await pressDialog("Delete permanently (5)");
  await waitFor(() => expect(emptyTrash).toHaveBeenCalledOnce());
});

test("cancelling Empty Trash in the Trash panel deletes nothing",
  async () => {
  await mount();
  fireEvent.click(await openTrashPanel());
  await cancelDialog();
  await expectNoDialog();
  expect(emptyTrash).not.toHaveBeenCalled();
});

test("no Empty Trash entry (and no Trash panel footer) while Trash is empty",
  async () => {
  await mount({ trash_count: 0 });
  openProfile();
  await screen.findByRole("menuitem", { name: /Settings/ });
  expect(screen.queryByRole("menuitem", { name: /Empty Trash/ })).toBeNull();
});

const selectAndRateWithAi = async () => {
  await mount({ trash_count: 0 },
    { ...singleCfg, ai: { ...singleCfg.ai, available: true } });
  await waitFor(() => expect(screen.getAllByRole("checkbox").length)
    .toBeGreaterThan(1));
  fireEvent.click(screen.getAllByRole("checkbox")[1]);
  fireEvent.change(await screen.findByDisplayValue("Action…"),
    { target: { value: "ai_review" } });
};

test("AI consent: declining sends nothing and is asked again next time",
  async () => {
  await selectAndRateWithAi();
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("NEVER sent");
  await cancelDialog();
  await expectNoDialog();
  expect(aiReview).not.toHaveBeenCalled();
  expect(localStorage.getItem("pmc_ai_ack")).toBeNull();
});

test("AI consent: continuing remembers the choice and runs the review",
  async () => {
  await selectAndRateWithAi();
  await pressDialog("Continue");
  await waitFor(() => expect(aiReview).toHaveBeenCalledWith(
    "sender", [groupFixture.key]));
  expect(localStorage.getItem("pmc_ai_ack")).toBe("1");
});
