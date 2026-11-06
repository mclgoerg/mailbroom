// @vitest-environment jsdom
/* Demo mode: controls whose only outcome would be the backend's "Not
 * available in the demo." refusal are disabled up front, with the reason
 * visible. Outside demo mode nothing is rendered differently. */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("./api", () => ({
  api: {
    folders: () => new Promise(() => {}),
    getConfig: () => new Promise(() => {}),
    adminStats: () => Promise.resolve({ tenants: [] }),
    knowledge: () => new Promise(() => {}),
  },
  fmtUsd: (n: number) => `$${n.toFixed(2)}`,
}));

import { SettingsModal } from "./components/SettingsModal";
import { Wizard } from "./components/Wizard";
import { DialogProvider, ToastProvider } from "./components/ui";
import { setDemo } from "./demoMode";
import { setLang } from "./i18n";
import type { Config } from "./types";

const acct = {
  excluded_folders: [] as string[], host: "127.0.0.1", port: 1143,
  security: "ssl" as const, smtp_host: "", smtp_port: 1025,
  smtp_security: "auto" as const, user: "me@mail.example", password: "",
  password_set: true, cafile: "", preset: "custom" as const, oauth: null,
  digest: { schedule: "off" as const, recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours" as const, value: 6,
    align_minute: 0 },
};
const cfg = {
  accounts: { default: acct }, default_account: "default",
  oauth_providers: ["google", "microsoft"], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: true, password_set: false },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "m", foundry_endpoint: "", price_in: 0,
    price_out: 0, budget_usd: 0, month_cost: 0, prices_effective: [2, 10],
    api_key: "", api_key_set: false, available: false, source: null,
    shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
} as unknown as Config;

afterEach(() => { cleanup(); setDemo(false); setLang("en"); });

const settings = () => render(<ToastProvider><DialogProvider>
  <SettingsModal cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />
</DialogProvider></ToastProvider>);
const HINT = "Not available in the demo.";
const btn = (name: string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;

test("settings: add account, digest and AI key are disabled with the hint", () => {
  setDemo(true);
  settings();
  expect(btn("Add account").disabled).toBe(true);
  expect(btn("Send test digest").disabled).toBe(true);
  expect(screen.getAllByText(HINT).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("tab", { name: "AI" }));
  expect(screen.getByLabelText("API key").matches(":disabled"))
    .toBe(true);
  expect(screen.getByLabelText("Model").matches(":disabled"))
    .toBe(true);
  expect(screen.getByText(HINT)).toBeTruthy();
});

test("settings: shared AI key and SSO login are disabled in the demo", () => {
  setDemo(true);
  settings();
  fireEvent.click(screen.getByRole("tab", { name: /Server/ }));
  const sso = screen.getByRole("option", { name: /SSO/ }) as HTMLOptionElement;
  expect(sso.disabled).toBe(true);
  expect(sso.textContent).toContain(HINT);
  expect(screen.getByRole("checkbox", { name: "Share this key with all users" })
    .matches(":disabled")).toBe(true);
  cleanup();
  setDemo(false);
  settings();
  fireEvent.click(screen.getByRole("tab", { name: /Server/ }));
  expect((screen.getByRole("option", { name: /SSO/ }) as HTMLOptionElement)
    .disabled).toBe(false);
  expect(document.querySelector("fieldset")).toBeNull();
});

test("settings: the hint is translated", () => {
  setDemo(true);
  setLang("de");
  settings();
  expect(screen.getAllByText("In der Demo nicht verfügbar.").length)
    .toBeGreaterThan(0);
});

test("settings: identical render when the demo flag is off", () => {
  const off = settings().container.innerHTML;
  // no wrapper elements of any kind are added outside the demo
  expect(document.querySelector("fieldset")).toBeNull();
  cleanup();
  setDemo(true);
  const on = settings().container.innerHTML;
  expect(on).not.toBe(off);
  cleanup();
  setDemo(false);
  expect(settings().container.innerHTML).toBe(off);
  expect(document.querySelector("fieldset")).toBeNull();
  expect(screen.queryByText(HINT)).toBeNull();
  expect(btn("Add account").disabled).toBe(false);
  expect(btn("Send test digest").disabled).toBe(false);
  fireEvent.click(screen.getByRole("tab", { name: "AI" }));
  expect(screen.getByLabelText("API key").matches(":disabled"))
    .toBe(false);
  expect(screen.queryByText(HINT)).toBeNull();
});

const wizard = (step: "provider" | "signin") => render(<ToastProvider>
  <DialogProvider>
    <Wizard cfg={cfg} mode="add" initialStep={step}
      scan={{ account: "default", status: "idle", progress: "", error: "",
        scannedTs: null }}
      onConfig={() => {}} onClose={() => {}} />
  </DialogProvider></ToastProvider>);

test("wizard: Test connection is disabled in the demo", () => {
  setDemo(true);
  wizard("signin");
  fireEvent.change(screen.getByLabelText(/Email address/),
    { target: { value: "me@mail.example" } });
  fireEvent.change(document.querySelector("input[type=password]")!,
    { target: { value: "secret" } });
  expect(btn("Test connection").disabled).toBe(true);
});

test("wizard: Test connection is enabled again outside the demo", () => {
  wizard("signin");
  fireEvent.change(screen.getByLabelText(/Email address/),
    { target: { value: "me@mail.example" } });
  fireEvent.change(document.querySelector("input[type=password]")!,
    { target: { value: "secret" } });
  expect(btn("Test connection").disabled).toBe(false);
});

const oauthAcct = { ...acct, preset: "outlook" as const, password_set: false,
  oauth: { provider: "microsoft" as const, client_id: "cid",
    client_secret_set: true, connected: false } };
const oauthCfg = (over: object = {}, connected = false) => ({
  ...cfg, oauth_ms_device_available: true,
  accounts: { default: { ...oauthAcct,
    oauth: { ...oauthAcct.oauth, connected }, auth: "oauth", ...over } },
}) as unknown as Config;
const settingsWith = (c: Config) => render(<ToastProvider><DialogProvider>
  <SettingsModal cfg={c} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />
</DialogProvider></ToastProvider>);

test("settings: OAuth connect (device and redirect) and disconnect are disabled",
  () => {
  setDemo(true);
  settingsWith(oauthCfg());
  expect(btn("Connect with a device code").disabled).toBe(true);
  cleanup();
  settingsWith({ ...oauthCfg(), oauth_ms_device_available: false } as Config);
  expect(btn("Connect account").disabled).toBe(true);
  cleanup();
  settingsWith(oauthCfg({}, true));
  expect(btn("Disconnect").disabled).toBe(true);
  expect(screen.getAllByText(HINT).length).toBeGreaterThan(0);
});

test("settings: OAuth connect is enabled outside the demo", () => {
  settingsWith(oauthCfg());
  expect(btn("Connect with a device code").disabled).toBe(false);
});
