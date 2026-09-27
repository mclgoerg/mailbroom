// @vitest-environment jsdom
/* Provider presets: selecting one prefills the connection fields but
 * keeps everything editable; "custom" changes nothing. */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("./api", () => ({
  api: { folders: () => new Promise(() => {}) },   // picker stays loading
  fmtUsd: (n: number) => `$${n.toFixed(2)}`,
}));

import { SettingsModal } from "./components/SettingsModal";
import type { Config } from "./types";

const cfg: Config = {
  accounts: {
    default: {
      host: "127.0.0.1", port: 1143, security: "ssl",
      smtp_host: "", smtp_port: 1025, smtp_security: "auto",
      user: "me@proton.example", password: "", password_set: true,
      cafile: "/certs/bridge-cert.pem", preset: "proton",
    },
  },
  default_account: "default",
  excluded_folders: [],
  protected: [],
  categories: {},
  ai: {
    provider: "anthropic", model: "claude-sonnet-5", foundry_endpoint: "",
    price_in: 0, price_out: 0, budget_usd: 0, month_cost: 0,
    prices_effective: [2, 10], api_key: "", api_key_set: false,
    available: false,
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
