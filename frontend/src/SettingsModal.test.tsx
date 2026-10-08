// @vitest-environment jsdom
/* Provider presets: selecting one prefills the connection fields but
 * keeps everything editable; "custom" changes nothing. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const foldersCalls: (string | undefined)[] = [];
const saveCalls: any[] = [];
const testDigestCalls: string[] = [];
const oauthDisconnectCalls: string[] = [];
let testDigestResult: { sent: boolean; demo: boolean } =
  { sent: true, demo: false };
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
    testDigest: (account: string) => {
      testDigestCalls.push(account);
      return Promise.resolve(testDigestResult);
    },
    getConfig: () => Promise.resolve(cfg),
    oauthDisconnect: (a: string) => { oauthDisconnectCalls.push(a);
      return Promise.resolve({}); },
    adminStats: () => Promise.resolve({ tenants: [{
      id: "alice_x.example_ab12cd34", label: "", is_admin_workspace: false,
      accounts: 1, mails: 42, size: 1048576, scans: 3,
      last_scan_ts: Date.now() / 1000 - 3600, rules: 0, verdicts: 5,
      actions_month: { trash: 7, archive: 0, move: 0, mark_read: 0,
        freed: 2048 },
      ai: { source: "shared" as const, runs: 2, input_tokens: 100,
        output_tokens: 10, cost: 0.5, month_cost: 0.5, budget_usd: 5 },
      disk_bytes: 4096,
    }] }),
  },
  fmtUsd: (n: number) => `$${n.toFixed(2)}`,
}));

import { SettingsModal } from "./components/SettingsModal";
import { DialogProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog }
  from "./dialogTestUtils";
import type { Config } from "./types";

const acct = {
  excluded_folders: [] as string[],
  host: "127.0.0.1", port: 1143, security: "ssl" as const,
  smtp_host: "", smtp_port: 1025, smtp_security: "auto" as const,
  user: "me@proton.example", password: "", password_set: true,
  cafile: "/certs/bridge-cert.pem", preset: "proton" as const,
  oauth: null,
  digest: { schedule: "off" as const, recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours" as const, value: 6,
    align_minute: 0 },
};
const cfg: Config = {
  accounts: {
    default: acct,
    icloud: { ...acct, host: "imap.mail.me.com", preset: "custom",
      user: "me@icloud.example" },
  },
  default_account: "default",
  oauth_providers: ["google", "microsoft"],
  oauth_ms_device_available: false,
  auth: {
    mode: "none", is_admin: true, password_set: false,
    oidc: { issuer: "", client_id: "", client_secret_set: false,
      redirect_base: "", allowed: [] },
  },
  protected: [],
  categories: {}, new_sender_window_days: 7,
  ai: {
    provider: "anthropic", model: "claude-sonnet-5", foundry_endpoint: "",
    price_in: 0, price_out: 0, budget_usd: 0, month_cost: 0,
    prices_effective: [2, 10], api_key: "", api_key_set: false,
    available: false, source: null, shared_budget_usd: 0,
  },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
};

afterEach(() => {
  cleanup();
  testDigestCalls.length = 0;
  testDigestResult = { sent: true, demo: false };
});

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
  // Gmail connects via OAuth only - no password field, OAuth-only hint
  expect(screen.getByText(/connects via OAuth only/)).toBeTruthy();
  expect(screen.queryByLabelText("Password")).toBeNull();
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

const renderWithDialogs = (over: Partial<Parameters<typeof SettingsModal>[0]>
  = {}) => render(<DialogProvider><SettingsModal cfg={cfg} account="default"
  onClose={() => {}} onSaved={() => {}} onAccountsChanged={() => {}}
  {...over} /></DialogProvider>);

test("rename sends rename_account for the edited account", async () => {
  saveCalls.length = 0;
  renderWithDialogs();
  fireEvent.click(screen.getByText("Rename…"));
  const dlg = await findDialog();
  fireEvent.change(within(dlg).getByRole("textbox"),
    { target: { value: "bridge" } });
  await pressDialog("Rename");
  await waitFor(() => expect(saveCalls).toEqual(
    [{ rename_account: { from: "default", to: "bridge" } }]));
});

test("rename validates: empty and duplicate names are refused", async () => {
  saveCalls.length = 0;
  renderWithDialogs();
  fireEvent.click(screen.getByText("Rename…"));
  const dlg = await findDialog();
  const box = within(dlg).getByRole("textbox");
  fireEvent.change(box, { target: { value: "  " } });
  expect(within(dlg).getByRole("alert").textContent).toBe("Enter a name.");
  fireEvent.change(box, { target: { value: "icloud" } });
  expect(within(dlg).getByRole("alert").textContent)
    .toContain('"icloud" already exists');
  await pressDialog("Rename");               // refused: dialog stays open
  expect(await findDialog()).toBe(dlg);
  expect(saveCalls).toEqual([]);
  await cancelDialog();
  await expectNoDialog();
  expect(saveCalls).toEqual([]);
});

test("a new account is named in a prompt and sent as add_account",
  async () => {
    saveCalls.length = 0;
    renderWithDialogs();
    fireEvent.click(screen.getByText("Add account"));
    const dlg = await findDialog();
    fireEvent.change(within(dlg).getByRole("textbox"),
      { target: { value: " gmail " } });
    await pressDialog("Add account");
    await waitFor(() => expect(saveCalls).toEqual([{ add_account: "gmail" }]));
  });

test("deleting an account names it in a danger dialog; Cancel keeps it",
  async () => {
    saveCalls.length = 0;
    renderWithDialogs();
    fireEvent.click(screen.getByText('Delete account "default"…'));
    const dlg = await findDialog();
    expect(dlg.textContent).toContain('Delete account "default"');
    expect(dlg.textContent).toContain("Mails on the server are untouched.");
    await cancelDialog();
    await expectNoDialog();
    expect(saveCalls).toEqual([]);
    fireEvent.click(screen.getByText('Delete account "default"…'));
    await pressDialog("Delete account");
    await waitFor(() => expect(saveCalls).toEqual(
      [{ delete_account: "default" }]));
  });

test("a single account cannot be deleted (no Remove section)", () => {
  renderWithDialogs({ cfg: { ...cfg, accounts: { default: acct } } });
  expect(screen.queryByText("Remove account")).toBeNull();
});

test("tabs switch the visible section", () => {
  renderWithDialogs();
  expect(screen.getByRole("tab", { name: "Mail account" })
    .getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("tab", { name: "General" }));
  expect(screen.getByText("Backup & restore")).toBeTruthy();
  expect(screen.queryByLabelText("Host")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "AI" }));
  expect(screen.getByText("Usage")).toBeTruthy();
  expect(screen.queryByText("Backup & restore")).toBeNull();
});

test("the active tab controls one labelled tabpanel", () => {
  renderWithDialogs();
  for (const name of ["Mail account", "General", "AI"]) {
    const tab = screen.getByRole("tab", { name });
    fireEvent.click(tab);
    const panel = screen.getByRole("tabpanel");
    expect(tab.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    expect(screen.getByRole("tabpanel", { name })).toBe(panel);
    // Only the selected tab points at the panel.
    expect(screen.getAllByRole("tab").filter((x) =>
      x.getAttribute("aria-controls") === panel.id)).toEqual([tab]);
  }
});

test("Cancel closes without saving; Save saves and stays open", () => {
  saveCalls.length = 0;
  const onClose = vi.fn();
  renderWithDialogs({ onClose });
  fireEvent.change(hostInput(), { target: { value: "imap.edited.example" } });
  fireEvent.click(screen.getByText("Cancel"));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(saveCalls).toEqual([]);
  fireEvent.click(screen.getByText("Save"));
  expect(saveCalls).toHaveLength(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("Export and Import live in General > Backup & restore", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(
    { ok: true, json: () => Promise.resolve({ rules: 2, verdicts: 3 }) })));
  const onSaved = vi.fn();
  const { container } = renderWithDialogs({ onSaved });
  expect(screen.queryByText("Export")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "General" }));
  expect(screen.getByText("Export")).toBeTruthy();
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const pick = () => fireEvent.change(input, { target: { files: [
    new File(['{"rules":[]}'], "backup.json", { type: "application/json" })] } });
  // declining the import confirm sends nothing
  pick();
  await cancelDialog();
  await expectNoDialog();
  expect(fetch).not.toHaveBeenCalled();
  // confirming imports and refreshes the config
  pick();
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("Settings are overwritten.");
  await pressDialog("Import backup");
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(fetch).toHaveBeenCalledWith("/api/import_config",
    expect.objectContaining({ method: "POST" }));
  await screen.findByText("Imported: 2 rules, 3 verdicts.");
  vi.unstubAllGlobals();
});

test("resetting AI spend and clearing verdicts need a confirmation",
  async () => {
    saveCalls.length = 0;
    renderWithDialogs();
    fireEvent.click(screen.getByRole("tab", { name: "AI" }));
    fireEvent.click(screen.getByText("Reset spend…"));
    await cancelDialog();
    fireEvent.click(screen.getByText("Clear AI verdict cache…"));
    await cancelDialog();
    await expectNoDialog();
    expect(saveCalls).toEqual([]);
    fireEvent.click(screen.getByText("Reset spend…"));
    await pressDialog("Reset spend");
    await waitFor(() => expect(saveCalls).toEqual(
      [{ reset_ai_stats: true }]));
    fireEvent.click(screen.getByText("Clear AI verdict cache…"));
    await pressDialog("Clear cache");
    await waitFor(() => expect(saveCalls.at(-1)).toEqual(
      { clear_ai_verdicts: true }));
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
  // no Server tab at all for non-admins …
  expect(screen.queryByRole("tab", { name: /Server/ })).toBeNull();
  expect(screen.queryByText(/Login \(optional\)/)).toBeNull();
  expect(screen.queryByText(/Shared AI key/)).toBeNull();
  // … but the shared-key state is visible in the tenant's AI tab
  fireEvent.click(screen.getByRole("tab", { name: "AI" }));
  expect(screen.getByText(/shared key/)).toBeTruthy();
  // saving must not send server-level sections (the API would 403)
  fireEvent.click(screen.getByText("Save"));
  expect(saveCalls.length).toBe(1);
  expect(saveCalls[0].auth).toBeUndefined();
  expect(saveCalls[0].shared_ai).toBeUndefined();
});

test("the admin sees and saves the shared AI section", async () => {
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
  fireEvent.click(screen.getByRole("tab", { name: /Server/ }));
  expect(screen.getByText(/Shared AI key/)).toBeTruthy();
  // the per-user usage table loads (id + shared-key spend/cap visible)
  expect(await screen.findByText(/alice_x.example/)).toBeTruthy();
  expect(screen.getByText(/\$0.50/)).toBeTruthy();
  fireEvent.click(screen.getByText("Save"));
  expect(saveCalls[0].auth.mode).toBe("oidc");
  expect(saveCalls[0].auth.admin).toBe("me@x");
  expect(saveCalls[0].shared_ai.enabled).toBe(true);
  expect(saveCalls[0].shared_ai.default_tenant_budget_usd).toBe(5);
});

test("tab switches keep unsaved edits and Save persists every tab", () => {
  saveCalls.length = 0;
  render(<SettingsModal cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  // edit on the account tab …
  fireEvent.change(hostInput(), { target: { value: "imap.new.example" } });
  // … wander off and back - the edit must survive
  fireEvent.click(screen.getByRole("tab", { name: "AI" }));
  fireEvent.change(screen.getByLabelText(/Model/),
    { target: { value: "claude-opus-5" } });
  fireEvent.click(screen.getByRole("tab", { name: "Mail account" }));
  expect(hostInput().value).toBe("imap.new.example");
  // Save (from any tab) sends the fields of ALL tabs
  fireEvent.click(screen.getByText("Save"));
  expect(saveCalls[0].imap.host).toBe("imap.new.example");
  expect(saveCalls[0].ai.model).toBe("claude-opus-5");
});

test("digest schedule + recipient + time are included in Save", () => {
  saveCalls.length = 0;
  render(<SettingsModal cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  fireEvent.change(screen.getByLabelText("Schedule"),
    { target: { value: "weekly" } });
  fireEvent.change(screen.getByLabelText("Recipient"),
    { target: { value: "me@elsewhere.example" } });
  fireEvent.change(screen.getByLabelText(/^Time/),
    { target: { value: "20:30" } });
  fireEvent.click(screen.getByText("Save"));
  expect(saveCalls[0].imap.digest).toEqual(
    { schedule: "weekly", recipient: "me@elsewhere.example",
      hour: 20, minute: 30 });
});

test("the time field only appears once a schedule is picked", () => {
  render(<SettingsModal cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  expect(screen.queryByLabelText(/^Time/)).toBeNull();
  fireEvent.change(screen.getByLabelText("Schedule"),
    { target: { value: "daily" } });
  expect(screen.getByLabelText(/^Time/)).toBeTruthy();
});

test("the new-sender window defaults from config and is included in Save",
  () => {
    saveCalls.length = 0;
    render(<SettingsModal cfg={cfg} account="default" onClose={() => {}}
      onSaved={() => {}} onAccountsChanged={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    const field = screen.getByLabelText(/"New" sender window/) as
      HTMLInputElement;
    expect(field.value).toBe("7");
    fireEvent.change(field, { target: { value: "3" } });
    fireEvent.click(screen.getByText("Save"));
    expect(saveCalls[0].new_sender_window_days).toBe(3);
  });

test("switching the edited account reloads its own digest settings", () => {
  render(<SettingsModal cfg={{
    ...cfg,
    accounts: { ...cfg.accounts,
      icloud: { ...cfg.accounts.icloud,
        digest: { schedule: "daily", recipient: "icloud@elsewhere.example",
          hour: 20, minute: 15 } },
    },
  }} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  expect((screen.getByLabelText("Schedule") as HTMLSelectElement).value)
    .toBe("off");
  fireEvent.change(
    screen.getByLabelText(/Account to edit/) as HTMLSelectElement,
    { target: { value: "icloud" } });
  expect((screen.getByLabelText("Schedule") as HTMLSelectElement).value)
    .toBe("daily");
  expect((screen.getByLabelText("Recipient") as HTMLInputElement).value)
    .toBe("icloud@elsewhere.example");
  expect((screen.getByLabelText(/^Time/) as HTMLInputElement).value)
    .toBe("20:15");
});

test("auto-scan fields only show cadence/alignment once enabled, and " +
    "save in the shape the backend expects", () => {
  render(<SettingsModal cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  expect(screen.queryByLabelText(/Every/)).toBeNull();
  expect(screen.queryByLabelText(/Start at minute/)).toBeNull();

  fireEvent.change(screen.getByLabelText("Enabled") as HTMLSelectElement,
    { target: { value: "on" } });
  const every = screen.getByLabelText(/Every/) as HTMLInputElement;
  const align = screen.getByLabelText(/Start at minute/) as HTMLInputElement;
  expect(every.value).toBe("6");
  expect(align.value).toBe("0");

  fireEvent.change(every, { target: { value: "15" } });
  fireEvent.change(align, { target: { value: "10" } });
  saveCalls.length = 0;
  fireEvent.click(screen.getByText("Save"));
  expect(saveCalls[0].imap.auto_scan).toEqual(
    { enabled: true, unit: "hours", value: 15, align_minute: 10 });
});

test("send test digest reports success", async () => {
  render(<SettingsModal cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  fireEvent.click(screen.getByText("Send test digest"));
  expect(testDigestCalls).toEqual(["default"]);
  expect(await screen.findByText("Sent!")).toBeTruthy();
});

test("send test digest reports a demo send distinctly from a real one",
  async () => {
    testDigestResult = { sent: true, demo: true };
    render(<SettingsModal cfg={cfg} account="default" onClose={() => {}}
      onSaved={() => {}} onAccountsChanged={() => {}} />);
    fireEvent.click(screen.getByText("Send test digest"));
    expect(await screen.findByText(/preview with example data/)).toBeTruthy();
  });

test("mail-text search mode defaults to server and saves the chosen mode",
  () => {
    render(<SettingsModal cfg={cfg} account="default" onClose={() => {}}
      onSaved={() => {}} onAccountsChanged={() => {}} />);
    const mode = screen.getByLabelText("Search inside mail text") as
      HTMLSelectElement;
    expect(mode.value).toBe("server");
    fireEvent.change(mode, { target: { value: "disabled" } });
    saveCalls.length = 0;
    fireEvent.click(screen.getByText("Save"));
    expect(saveCalls[0].imap.body_search).toBe("disabled");
  });

test("mail-text search mode is read from the account being edited", () => {
  const off: Config = { ...cfg, accounts: { ...cfg.accounts,
    default: { ...acct, body_search: "disabled" } } };
  render(<SettingsModal cfg={off} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  expect((screen.getByLabelText("Search inside mail text") as
    HTMLSelectElement).value).toBe("disabled");
});

test("the local index option needs MAILBROOM_SECRET_KEY on the server", () => {
  render(<SettingsModal cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  const local = screen.getByText(/Local word index/) as HTMLOptionElement;
  expect(local.disabled).toBe(true);
});

test("picking the local index saves it and points to the index panel",
  () => {
    const withKey: Config = { ...cfg, secret_key_set: true };
    render(<SettingsModal cfg={withKey} account="default" onClose={() => {}}
      onSaved={() => {}} onAccountsChanged={() => {}} />);
    const mode = screen.getByLabelText("Search inside mail text") as
      HTMLSelectElement;
    expect((screen.getByText(/Local word index/) as HTMLOptionElement)
      .disabled).toBe(false);
    fireEvent.change(mode, { target: { value: "local" } });
    expect(screen.getByText(/stores NO readable mail text/)).toBeTruthy();
    // not saved as "local" yet: the build controls wait for the save
    expect(screen.getByText(/Save the settings first/)).toBeTruthy();
    saveCalls.length = 0;
    fireEvent.click(screen.getByText("Save"));
    expect(saveCalls[0].imap.body_search).toBe("local");
  });

test("deleting sends delete_account for the account selected, not the active one",
  async () => {
    saveCalls.length = 0;
    renderWithDialogs();
    fireEvent.change(screen.getByLabelText(/Account to edit/),
      { target: { value: "icloud" } });
    fireEvent.click(screen.getByText('Delete account "icloud"…'));
    await pressDialog("Delete account");
    await waitFor(() => expect(saveCalls).toEqual(
      [{ delete_account: "icloud" }]));
  });

test("the delete dialog lists the data that goes with the account",
  async () => {
    renderWithDialogs();
    fireEvent.click(screen.getByText('Delete account "default"…'));
    const dlg = await findDialog();
    for (const part of ["sign-in and connection settings", "scan results",
      "local search index", "saved filters", "pins", "unsubscribe records",
      "known senders", "digest and auto-scan"]) {
      expect(dlg.textContent).toContain(part);
    }
    await cancelDialog();
  });

test("account names like 'constructor' are valid, real duplicates are not",
  async () => {
    saveCalls.length = 0;
    renderWithDialogs();
    fireEvent.click(screen.getByText("Add account"));
    const dlg = await findDialog();
    fireEvent.change(within(dlg).getByRole("textbox"),
      { target: { value: "constructor" } });
    expect(within(dlg).queryByRole("alert")).toBeNull();
    await pressDialog("Add account");
    await waitFor(() => expect(saveCalls).toEqual(
      [{ add_account: "constructor" }]));
  });

test("OAuth disconnect asks first; Cancel disconnects nothing", async () => {
  oauthDisconnectCalls.length = 0;
  const oauthCfg: Config = { ...cfg, accounts: { ...cfg.accounts,
    default: { ...acct, preset: "gmail", oauth: { provider: "google",
      client_id: "id", client_secret_set: true, connected: true } as any } } };
  renderWithDialogs({ cfg: oauthCfg });
  fireEvent.click(screen.getByText("Disconnect"));
  await cancelDialog();
  await expectNoDialog();
  expect(oauthDisconnectCalls).toEqual([]);
  fireEvent.click(screen.getByText("Disconnect"));
  await pressDialog("Disconnect");
  await waitFor(() => expect(oauthDisconnectCalls).toEqual(["default"]));
});

test("resetting spend names the amounts it clears", async () => {
  renderWithDialogs();
  fireEvent.click(screen.getByRole("tab", { name: "AI" }));
  fireEvent.click(screen.getByText("Reset spend…"));
  expect((await findDialog()).textContent).toContain("this month's spend");
  await cancelDialog();
});
