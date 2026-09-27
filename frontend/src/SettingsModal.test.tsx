// @vitest-environment jsdom
/* Provider presets: selecting one prefills the connection fields but
 * keeps everything editable; "custom" changes nothing. */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const foldersCalls: (string | undefined)[] = [];
const saveCalls: any[] = [];
vi.mock("./api", () => ({
  api: {
    folders: (account?: string) => {
      foldersCalls.push(account);
      return new Promise(() => {});              // picker stays loading
    },
    saveConfig: (body: any) => {
      saveCalls.push(body);
      return new Promise(() => {});              // response irrelevant here
    },
  },
  fmtUsd: (n: number) => `$${n.toFixed(2)}`,
}));

import { SettingsModal } from "./components/SettingsModal";
import type { Config } from "./types";

const acct = {
  excluded_folders: [] as string[],
  host: "127.0.0.1", port: 1143, security: "ssl" as const,
  smtp_host: "", smtp_port: 1025, smtp_security: "auto" as const,
  user: "me@proton.example", password: "", password_set: true,
  cafile: "/certs/bridge-cert.pem", preset: "proton" as const,
};
const cfg: Config = {
  accounts: {
    default: acct,
    icloud: { ...acct, host: "imap.mail.me.com", preset: "custom",
      user: "me@icloud.example" },
  },
  default_account: "default",
  auth: {
    mode: "none", is_admin: true, password_set: false,
    oidc: { issuer: "", client_id: "", client_secret_set: false,
      redirect_base: "", allowed: [] },
  },
  protected: [],
  categories: {},
  ai: {
    provider: "anthropic", model: "claude-sonnet-5", foundry_endpoint: "",
    price_in: 0, price_out: 0, budget_usd: 0, month_cost: 0,
    prices_effective: [2, 10], api_key: "", api_key_set: false,
    available: false, source: null, shared_budget_usd: 0,
  },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
};

afterEach(cleanup);

const presetSelect = () =>
  screen.getByLabelText(/Provider preset/) as HTMLSelectElement;
const hostInput = () => screen.getByLabelText("Host") as HTMLInputElement;

test("gmail preset prefills IMAP + SMTP fields", () => {
  render(<SettingsModal cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  expect(hostInput().value).toBe("127.0.0.1");
  fireEvent.change(presetSelect(), { target: { value: "gmail" } });
  expect(hostInput().value).toBe("imap.gmail.com");
  expect((screen.getByLabelText(/IMAP port/) as HTMLInputElement).value)
    .toBe("993");
  expect((screen.getByLabelText(/SMTP host/) as HTMLInputElement).value)
    .toBe("smtp.gmail.com");
  // Bridge cert must not leak into a non-Proton account
  expect((screen.getByLabelText(/CA file/) as HTMLInputElement).value)
    .toBe("");
  // app-password hint shown
  expect(screen.getByText(/app-specific password/)).toBeTruthy();
});

test("custom preset keeps the current fields", () => {
  render(<SettingsModal cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  fireEvent.change(presetSelect(), { target: { value: "custom" } });
  expect(hostInput().value).toBe("127.0.0.1");
  expect(presetSelect().value).toBe("custom");
});

test("prefilled fields stay editable", () => {
  render(<SettingsModal cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  fireEvent.change(presetSelect(), { target: { value: "fastmail" } });
  fireEvent.change(hostInput(), { target: { value: "imap.mine.example" } });
  expect(hostInput().value).toBe("imap.mine.example");
});

test("folder discovery follows the account being edited", () => {
  foldersCalls.length = 0;
  render(<SettingsModal cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  expect(foldersCalls).toEqual(["default"]);
  fireEvent.change(
    screen.getByLabelText(/Account to edit/) as HTMLSelectElement,
    { target: { value: "icloud" } });
  expect(foldersCalls).toEqual(["default", "icloud"]);
  expect(hostInput().value).toBe("imap.mail.me.com");
  // manual re-discover button
  fireEvent.click(screen.getByText(/Discover/));
  expect(foldersCalls).toEqual(["default", "icloud", "icloud"]);
});

test("rename sends rename_account for the edited account", () => {
  saveCalls.length = 0;
  vi.stubGlobal("prompt", () => "bridge");
  render(<SettingsModal cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  fireEvent.click(screen.getByText("Rename…"));
  expect(saveCalls).toEqual(
    [{ rename_account: { from: "default", to: "bridge" } }]);
  vi.unstubAllGlobals();
});

test("server settings (login + shared AI) are admin-only", () => {
  saveCalls.length = 0;
  const asUser: Config = {
    ...cfg,
    auth: { mode: "oidc", is_admin: false },
    ai: { ...cfg.ai, available: true, source: "shared",
      shared_budget_usd: 5 },
  };
  render(<SettingsModal cfg={asUser} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  // no Login section, no shared-AI admin section …
  expect(screen.queryByText(/Login \(optional\)/)).toBeNull();
  expect(screen.queryByText(/Shared AI key/)).toBeNull();
  // … but the shared-key state is visible in the tenant's AI section
  expect(screen.getByText(/shared key/)).toBeTruthy();
  // saving must not send server-level sections (the API would 403)
  fireEvent.click(screen.getByText("Save"));
  expect(saveCalls.length).toBe(1);
  expect(saveCalls[0].auth).toBeUndefined();
  expect(saveCalls[0].shared_ai).toBeUndefined();
});

test("the admin sees and saves the shared AI section", () => {
  saveCalls.length = 0;
  const asAdmin: Config = {
    ...cfg,
    auth: { ...cfg.auth, mode: "oidc", is_admin: true, admin: "me@x" },
    shared_ai: { enabled: true, provider: "anthropic",
      model: "claude-sonnet-5", foundry_endpoint: "", price_in: 0,
      price_out: 0, default_tenant_budget_usd: 5, api_key: "",
      api_key_set: true },
  };
  render(<SettingsModal cfg={asAdmin} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  expect(screen.getByText(/Shared AI key/)).toBeTruthy();
  fireEvent.click(screen.getByText("Save"));
  expect(saveCalls[0].auth.mode).toBe("oidc");
  expect(saveCalls[0].auth.admin).toBe("me@x");
  expect(saveCalls[0].shared_ai.enabled).toBe(true);
  expect(saveCalls[0].shared_ai.default_tenant_budget_usd).toBe(5);
});
