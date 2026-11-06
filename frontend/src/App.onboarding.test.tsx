// @vitest-environment jsdom
/* First-run onboarding card: Test connection and Scan need credentials
 * under the account's own sign-in method - an OAuth-connected account has
 * no password and must still be able to use them. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

let state: any;
let cfg: Config;

vi.mock("./api", async (orig) => ({
  // the real errorText: the coded error must reach the toast translated
  errorText: (await orig<typeof import("./api")>()).errorText,
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
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

const mkCfg = (a: object): Config => ({
  default_account: "proton",
  accounts: { proton: { ...acct, user: "me@mail.example", ...a } as any },
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "claude-sonnet-5",
    foundry_endpoint: "", price_in: 0, price_out: 0, budget_usd: 0,
    month_cost: 0, prices_effective: [2, 10], api_key: "",
    api_key_set: false, available: false, source: null,
    shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
});


const baseState: AppState = {
  account: "proton", status: "idle", scanned_ts: 0, groups_rev: 0,
  progress: "", error: "", folders: [],
  groups: { sender: {}, smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: [],
  presets: [],
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const open = async (a: object) => {
  localStorage.setItem("pmc_account", "proton");
  cfg = mkCfg(a);
  state = baseState;
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await screen.findByText(/Ready for the first scan/);
};
// The toolbar has its own Scan button - look inside the welcome card.
const card = () =>
  within(screen.getByText(/Ready for the first scan/).parentElement!);
const scanBtn = () =>
  card().getByRole("button", { name: "Scan" }) as HTMLButtonElement;
const testBtn = () => card().queryByRole("button",
  { name: /Test connection/i });

const oauthOnly = { password_set: false, auth: "oauth",
  oauth: { provider: "google", client_id: "c", client_secret_set: true,
    connected: true } };

test("an OAuth-connected account without a password can Test and Scan",
  async () => {
    await open(oauthOnly);
    await waitFor(() => expect(scanBtn().disabled).toBe(false));
    expect(testBtn()).toBeTruthy();
  });

test("a password account can Test and Scan; no credential disables both",
  async () => {
    await open({ password_set: true });
    await waitFor(() => expect(scanBtn().disabled).toBe(false));
    expect(testBtn()).toBeTruthy();
    cleanup();
    await open({ password_set: false });
    await waitFor(() => expect(scanBtn().disabled).toBe(true));
    expect(testBtn()).toBeNull();
  });

test("the stored method decides: auth=oauth with only a password set (and " +
  "no token) is not ready; auth=password with only a token is not ready",
  async () => {
    await open({ password_set: true, auth: "oauth",
      oauth: { ...oauthOnly.oauth, connected: false } });
    await waitFor(() => expect(scanBtn().disabled).toBe(true));
    cleanup();
    await open({ ...oauthOnly, auth: "password" });
    await waitFor(() => expect(scanBtn().disabled).toBe(true));
  });

test("a failed first scan keeps the welcome card and words the coded error",
  async () => {
    localStorage.setItem("pmc_account", "proton");
    cfg = mkCfg({ password_set: true });
    state = { ...baseState, status: "error", error: "no_account" };
    render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
    await screen.findByText(/Ready for the first scan/);
    expect(await screen.findByText(/No mail account is set up yet/))
      .toBeTruthy();
    expect(screen.queryByText(/no_account/)).toBeNull();
  });

const openRaw = async (c: Config) => {
  localStorage.setItem("pmc_account", "proton");
  cfg = c;
  state = baseState;
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
};

test("with no account set up the wizard opens by itself; Set up later " +
  "leaves a card that reopens it", async () => {
  sessionStorage.clear();
  await openRaw({ ...mkCfg({ user: "", password_set: false }),
    setup_needed: true });
  expect(await screen.findByText("Where does your mail live?", { exact:
    false })).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Set up later" })[0]);
  await waitFor(() => expect(screen.queryByText(/Where does your mail live/))
    .toBeNull());
  const setup = (await screen.findAllByRole("button",
    { name: "Set up your mailbox" }))[0];
  // it stays closed after a reload within the session
  cleanup();
  await openRaw({ ...mkCfg({ user: "", password_set: false }),
    setup_needed: true });
  await screen.findAllByRole("button", { name: "Set up your mailbox" });
  expect(screen.queryByText(/Where does your mail live/)).toBeNull();
  fireEvent.click(screen.getAllByRole("button",
    { name: "Set up your mailbox" })[0]);
  expect(await screen.findByText(/Where does your mail live/)).toBeTruthy();
  expect(setup).toBeTruthy();
  sessionStorage.clear();
});

test("with no account the toolbar offers setup, not Scan, and the status " +
  "line does not mention Scan", async () => {
  sessionStorage.setItem("pmc_wizard_later", "1");
  await openRaw({ ...mkCfg({ user: "", password_set: false }),
    setup_needed: true });
  const btns = await screen.findAllByRole("button",
    { name: "Set up your mailbox" });
  expect(btns).toHaveLength(2);                    // toolbar + card
  expect(screen.queryByRole("button", { name: "Scan" })).toBeNull();
  expect(screen.queryByText(/hit “Scan”/)).toBeNull();
  fireEvent.click(btns[0]);                        // the toolbar's
  expect(await screen.findByText(/Where does your mail live/)).toBeTruthy();
  sessionStorage.clear();
});

test("a configured install never opens the wizard by itself", async () => {
  sessionStorage.clear();
  await open({ password_set: true });
  expect(screen.queryByText(/Where does your mail live/)).toBeNull();
});

test("the profile menu's Add account opens the wizard, even with a single " +
  "account", async () => {
  sessionStorage.clear();
  await open({ password_set: true });
  fireEvent.click(screen.getByRole("button", { name: "Profile & settings" }));
  fireEvent.click(await screen.findByText(/Add account/));
  expect(await screen.findByText(/Where does your mail live/)).toBeTruthy();
});

test("an account whose connection was never confirmed shows a setup card, " +
  "not 'Ready for the first scan'; Continue setup reopens the sign-in step",
  async () => {
    sessionStorage.clear();
    await openRaw(mkCfg({ password_set: true, verified: false }));
    expect(await screen.findByText("Finish setting up me@mail.example"))
      .toBeTruthy();
    expect(screen.queryByText(/Ready for the first scan/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Test connection" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue setup" }));
    expect(await screen.findByRole("button", { name: "Test connection" }))
      .toBeTruthy();
    expect(screen.queryByText(/Where does your mail live/)).toBeNull();
  });

test("the setup card falls back to the account name without an address",
  async () => {
    sessionStorage.clear();
    await openRaw(mkCfg({ password_set: true, verified: false, user: "" }));
    expect(await screen.findByText("Finish setting up proton")).toBeTruthy();
  });

test("a verified account (or an older backend without the flag) gets the " +
  "normal first-scan card", async () => {
  await open({ password_set: true, verified: true });
  expect(screen.queryByText(/Finish setting up/)).toBeNull();
  cleanup();
  await open({ password_set: true });
  expect(screen.queryByText(/Finish setting up/)).toBeNull();
});
