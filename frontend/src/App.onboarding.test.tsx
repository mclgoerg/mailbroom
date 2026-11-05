// @vitest-environment jsdom
/* First-run onboarding card: Test connection and Scan need credentials
 * under the account's own sign-in method - an OAuth-connected account has
 * no password and must still be able to use them. */

import { cleanup, render, screen, waitFor, within } from
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
  await screen.findByText(/three steps to a tidy mailbox/);
};
// The toolbar has its own Scan button - look inside the welcome card.
const card = () =>
  within(screen.getByText(/three steps to a tidy mailbox/).parentElement!);
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
    await screen.findByText(/three steps to a tidy mailbox/);
    expect(await screen.findByText(/No mail account is set up yet/))
      .toBeTruthy();
    expect(screen.queryByText(/no_account/)).toBeNull();
  });
