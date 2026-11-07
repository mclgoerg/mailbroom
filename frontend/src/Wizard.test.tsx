// @vitest-environment jsdom
/* The first-run / "Add account" wizard, against the real api layer with a
 * stubbed fetch (so error codes are translated the way the app does). */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Wizard, type WizardScan } from "./components/Wizard";
import { DialogProvider, ToastProvider } from "./components/ui";
import { setLang } from "./i18n";
import type { Config } from "./types";

const emptyAcct = {
  excluded_folders: [] as string[], host: "127.0.0.1", port: 1143,
  security: "ssl" as const, smtp_host: "", smtp_port: 1025,
  smtp_security: "auto" as const, user: "", password: "",
  password_set: false, cafile: "", preset: "proton" as const, oauth: null,
  digest: { schedule: "off" as const, recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours" as const, value: 6,
    align_minute: 0 },
};
const mkCfg = (over: Partial<Config> = {}, auth: object = {}): Config => ({
  default_account: "default", accounts: { default: emptyAcct },
  setup_needed: true, oauth_providers: ["google", "microsoft"],
  oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: true, ...auth },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "m", foundry_endpoint: "", price_in: 0,
    price_out: 0, budget_usd: 0, month_cost: 0, prices_effective: [2, 10],
    api_key: "", api_key_set: false, available: false, source: null,
    shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
  ...over,
} as Config);

type Call = { method: string; url: string; body: any };
let calls: Call[];
let routes: Record<string, (body: any) => [number, unknown]>;
let gate: Promise<void> | null;      // holds /api/test_connection back

beforeEach(() => {
  calls = [];
  gate = null;
  routes = {
    "/api/config": () => [200, mkCfg()],
    "/api/test_connection": () => [200, { ok: true, folders: 7 }],
    "/api/folders": () => [200, { wildcards: ["Labels/*"], folders: [
      { raw: "INBOX", name: "INBOX", role: null, excluded: false,
        delim: "/" },
      { raw: "Trash", name: "Trash", role: "trash", excluded: true,
        delim: "/" }] }],
    "/api/login": () => [200, { ok: true }],
    "/api/scan": () => [200, { ok: true }],
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (gate && url.includes("/api/test_connection")) {
      // a slow server: the request ends when the page aborts it
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(
          new DOMException("aborted", "AbortError"));
        if (init?.signal?.aborted) abort();
        init?.signal?.addEventListener("abort", abort);
        gate!.then(resolve);
      });
    }
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", url, body });
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    const [status, out] = hit ? hit[1](body) : [404, { detail: "nope" }];
    return { ok: status < 400, status,
      text: () => Promise.resolve(JSON.stringify(
        status < 400 ? out : { detail: out })),
      json: () => Promise.resolve(out) };
  }));
});
afterEach(() => {
  cleanup();
  setLang("en");
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const idle: WizardScan = { account: "default", status: "idle", progress: "", error: "",
  scannedTs: null };
const onConfig = vi.fn();
const onClose = vi.fn();
const open = (cfg = mkCfg(), mode: "first" | "add" = "first",
  scan: WizardScan = idle, extra: object = {}) => {
  onConfig.mockClear();
  onClose.mockClear();
  return render(<ToastProvider><DialogProvider>
    <Wizard cfg={cfg} mode={mode} scan={scan} onConfig={onConfig}
      onClose={onClose} {...extra} />
  </DialogProvider></ToastProvider>);
};
const saves = () => calls.filter((c) => c.url.includes("/api/config")
  && c.method === "POST");
const pick = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));
const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
/** The step the stepper marks as current. */
const current = () => document.querySelector("[aria-current=step]")!
  .textContent;
const signIn = async (user = "me@mail.example", pw = "secret") => {
  type(/Email address/, user);
  fireEvent.change(document.querySelector("input[type=password]")!,
    { target: { value: pw } });
  pick("Test connection");
};

test("each provider shows only its own sign-in fields", () => {
  open();
  pick("Proton Mail Bridge");
  expect(screen.getByLabelText(/Bridge password/)).toBeTruthy();
  expect(screen.getByText(/self-signed certificate/)).toBeTruthy();
  cleanup();
  open();
  pick("Outlook / Microsoft 365");
  expect(screen.queryByLabelText(/password/i, { selector: "input" }))
    .toBeNull();
  expect(screen.getByText("Connect account")).toBeTruthy();
  cleanup();
  open();
  pick("Gmail");
  const appPw = () => screen.queryByLabelText(/App password/,
    { selector: "input" });
  expect(appPw()).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "OAuth" }));
  expect(appPw()).toBeNull();
  expect(screen.getByText("Connect account")).toBeTruthy();
  cleanup();
  open();
  pick(/Another IMAP/);
  expect(screen.getByLabelText("Host")).toBeTruthy();
  expect((screen.getByLabelText("Host") as HTMLInputElement).value).toBe("");
});

test("step 1 writes nothing", () => {
  open();
  pick("iCloud Mail");
  expect(saves()).toEqual([]);
});

test("a failed test stays on the sign-in step with the translated error",
  async () => {
    routes["/api/test_connection"] = () => [502, "auth_failed"];
    open();
    pick("iCloud Mail");
    await signIn();
    expect(await screen.findByText(/refused the sign-in/)).toBeTruthy();
    expect(screen.queryByText(/The ticked folders/)).toBeNull();
    expect(current()).toContain("Sign in");
  });

test("the error reads German in German", async () => {
  setLang("de");
  routes["/api/test_connection"] = () => [502, "host_unreachable"];
  open();
  fireEvent.click(screen.getByRole("button", { name: "iCloud Mail" }));
  fireEvent.change(screen.getByLabelText(/E-Mail-Adresse/),
    { target: { value: "me@mail.example" } });
  fireEvent.change(screen.getByLabelText(/App-Passwort/),
    { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: "Verbindung testen" }));
  expect(await screen.findByText(/nicht erreichbar/)).toBeTruthy();
});

test("first run edits the default account in place and pins the test to it",
  async () => {
    open();
    pick("iCloud Mail");
    await signIn();
    expect(await screen.findByText("Connected - 7 folders found."))
      .toBeTruthy();
    const body = saves()[0].body;
    expect(body.add_account).toBeUndefined();
    expect(body.account).toBe("default");
    expect(body.imap).toMatchObject({ host: "imap.mail.me.com",
      user: "me@mail.example", password: "secret", preset: "icloud",
      auth: "password", cafile: "" });
    expect(calls.find((c) => c.url.includes("/api/test_connection"))!.url)
      .toContain("account=default");
  });

test("Gmail app passwords lose their spaces", async () => {
  open();
  pick("Gmail");
  await signIn("me@gmail.example", "abcd efgh ijkl mnop");
  await screen.findByText(/Connected - 7/);
  expect(saves()[0].body.imap.password).toBe("abcdefghijklmnop");
});

const toConnected = async () => {
  open();
  pick("iCloud Mail");
  await signIn();
  await screen.findByText("Connected - 7 folders found.");
};
const toFolders = async () => {
  await toConnected();
  pick(/Choose folders/);
  await screen.findByText(/The ticked folders/);
  await screen.findByText("INBOX");
};
const toProtect = async () => {
  await toConnected();
  pick("Continue");
  await screen.findByText(/Protect this page/);
};
const folderCalls = () => calls.filter((c) => c.url.includes("/api/folders"));

test("folders are off the main path: Continue skips them, saves nothing " +
  "and never lists them", async () => {
  await toConnected();
  expect(screen.queryByText(/The ticked folders/)).toBeNull();
  const before = saves().length;
  pick("Continue");
  expect(saves().length).toBe(before);
  expect(await screen.findByText(/Protect this page/)).toBeTruthy();
  expect(folderCalls()).toEqual([]);
});

test("skipping the folders leaves the same exclusions that accepting the " +
  "listed defaults saves", async () => {
  await toFolders();
  pick("Continue");
  await screen.findByText(/Protect this page/);
  // accepting saves the wildcard rules plus every folder listed as excluded.
  // Skipping saves nothing and keeps the backend's DEFAULT_EXCLUDED; that it
  // scans the same folders is proven in tests/test_folder_skip_equivalence.py
  const listed = await (await fetch("/api/folders")).json();
  const defaults = [...listed.wildcards, ...listed.folders
    .filter((x: any) => x.excluded).map((x: any) => x.raw)];
  expect(saves().pop()!.body).toEqual({ account: "default",
    excluded_folders: defaults });
});

test("Choose folders opens the list inline on the sign-in step; Continue " +
  "saves the ticks", async () => {
  await toFolders();
  expect(current()).toContain("Sign in");
  fireEvent.click(screen.getByLabelText("INBOX"));          // untick INBOX
  pick("Continue");
  await screen.findByText(/Protect this page/);
  expect(saves().pop()!.body.excluded_folders).toEqual(
    ["Labels/*", "INBOX", "Trash"]);
});

test("folder ticks survive collapsing the block: Continue still saves them",
  async () => {
    await toFolders();
    fireEvent.click(screen.getByLabelText("INBOX"));
    pick(/Choose folders/);                       // collapse again
    expect(screen.queryByText("INBOX")).toBeNull();
    pick("Continue");
    await screen.findByText(/Protect this page/);
    expect(saves().pop()!.body.excluded_folders).toEqual(
      ["Labels/*", "INBOX", "Trash"]);
  });

test("editing the sign-in after a passed test asks for a new test", async () => {
  await toConnected();
  type(/Email address/, "other@mail.example");
  expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  expect(screen.queryByText("Connected - 7 folders found.")).toBeNull();
});

test("the password step only shows with no login set, for the admin",
  async () => {
    for (const [auth, shown] of [[{ mode: "password" }, false],
      [{ is_admin: false }, false], [{}, true]] as const) {
      cleanup();
      open(mkCfg({}, auth));
      pick("iCloud Mail");
      await signIn();
      await screen.findByText("Connected - 7 folders found.");
      pick("Continue");
      if (shown) await screen.findByText(/Protect this page/);
      else await screen.findByText(/Reading your mailbox/);
    }
  });

test("setting the password saves it, signs in, then scans", async () => {
  await toProtect();
  type(/New password/, "short");
  expect(screen.getByText(/at least 8/)).toBeTruthy();
  type(/New password/, "long enough pw");
  type(/Repeat the password/, "different one 1");
  expect(screen.getByText(/two passwords differ/)).toBeTruthy();
  type(/Repeat the password/, "long enough pw");
  pick("Set password");
  await screen.findByText(/Reading your mailbox/);
  const order = calls.map((c) => c.url.replace(/\?.*/, ""));
  expect(saves().pop()!.body).toEqual({ auth: { mode: "password",
    password: "long enough pw" } });
  expect(calls.find((c) => c.url.includes("/api/login"))!.body)
    .toEqual({ password: "long enough pw" });
  expect(order.indexOf("/api/login")).toBeGreaterThan(-1);
  const scan = calls.find((c) => c.url.includes("/api/scan"))!;
  expect(scan.url).toContain("account=default");
  expect(order.indexOf("/api/scan")).toBeGreaterThan(
    order.indexOf("/api/login"));
});

test("Skip on the password step sets nothing and starts the scan", async () => {
  await toProtect();
  pick("Skip");
  await screen.findByText(/Reading your mailbox/);
  expect(saves().some((c) => c.body.auth)).toBe(false);
  await waitFor(() => expect(
    calls.some((c) => c.url.includes("/api/scan"))).toBe(true));
});

test("the scan step shows the progress, the result and a failure", async () => {
  const cfg = mkCfg({}, { mode: "password" });
  const { rerender } = open(cfg, "first", idle, { initialStep: "scan",
    initialAccount: "default" });
  const again = (scan: WizardScan) => rerender(<ToastProvider>
    <DialogProvider><Wizard cfg={cfg} mode="first" scan={scan}
      initialStep="scan" initialAccount="default" onConfig={onConfig}
      onClose={onClose} /></DialogProvider></ToastProvider>);
  again({ ...idle, status: "scanning", progress: "connecting…" });
  expect(await screen.findByRole("progressbar")).toBeTruthy();
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow"))
    .toBeNull();                                  // indeterminate
  expect(screen.getByText("Grouping senders…")).toBeTruthy();
  expect(screen.getByText(/the scan keeps running/)).toBeTruthy();
  again({ ...idle, status: "scanning", progress: "INBOX: 5/20" });
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow"))
    .toBe("25");
  expect(screen.getByText("25%")).toBeTruthy();
  expect(screen.getByText("5 of 20")).toBeTruthy();
  again({ ...idle, status: "error", error: "no_account" });
  expect(await screen.findByText(/No mail account is set up yet/))
    .toBeTruthy();
  again({ ...idle, status: "done", scannedTs: 1700000000 });
  fireEvent.click(await screen.findByRole("button",
    { name: "Show my mailbox" }));
  expect(onClose).toHaveBeenCalled();
});

// --------------------------------------------------------- add account

const withNew = (): Config => mkCfg({ setup_needed: false,
  accounts: { default: { ...emptyAcct, user: "a@mail.example",
    password_set: true }, "b@mail.example": { ...emptyAcct,
    user: "b@mail.example" } } as any });

test("add mode creates the account only when the sign-in is tested",
  async () => {
    routes["/api/config"] = () => [200, withNew()];
    open(mkCfg({ setup_needed: false }), "add");
    pick("Fastmail");
    expect(saves()).toEqual([]);
    await signIn("b@mail.example");
    await screen.findByText(/Connected - 7/);
    const body = saves()[0].body;
    expect(body.add_account).toBe("b@mail.example");
    expect(body.account).toBe("b@mail.example");
    expect(onConfig.mock.calls[0][1]).toBe("b@mail.example");
    // no protect step in add mode: three steps
    expect(screen.getAllByRole("listitem").map((l) => l.textContent!.replace(/^\d/, "")))
      .toEqual(["Choose provider", "Sign in", "First scan"]);
  });

test("closing before the account exists changes nothing", () => {
  open(mkCfg({ setup_needed: false }), "add");
  fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
  expect(saves()).toEqual([]);
  expect(onClose).toHaveBeenCalled();
});

test("closing after a failed first test removes only the account this " +
  "session created", async () => {
  routes["/api/config"] = (b) => [200, b?.delete_account ? mkCfg()
    : withNew()];
  routes["/api/test_connection"] = () => [502, "auth_failed"];
  open(mkCfg({ setup_needed: false }), "add");
  pick("Fastmail");
  await signIn("b@mail.example");
  await screen.findByText(/refused the sign-in/);
  fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  const del = saves().filter((c) => c.body.delete_account);
  expect(del.map((c) => c.body.delete_account)).toEqual(["b@mail.example"]);
});

test("closing after a good test keeps the account", async () => {
  routes["/api/config"] = () => [200, withNew()];
  open(mkCfg({ setup_needed: false }), "add");
  pick("Fastmail");
  await signIn("b@mail.example");
  await screen.findByText(/Connected - 7/);
  fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(saves().some((c) => c.body.delete_account)).toBe(false);
});

test("an email that already names an account gets a number", async () => {
  const cfg = mkCfg({ setup_needed: false,
    accounts: { default: { ...emptyAcct, user: "a@mail.example" },
      "b@mail.example": emptyAcct } as any });
  routes["/api/config"] = () => [200, cfg];
  open(cfg, "add");
  pick("Fastmail");
  await signIn("b@mail.example");
  await screen.findByText(/Connected - 7/);
  expect(saves()[0].body.add_account).toBe("b@mail.example 2");
});

test("Set up later (first run) just closes", () => {
  open();
  fireEvent.click(screen.getAllByRole("button", { name: "Set up later" })[0]);
  expect(onClose).toHaveBeenCalled();
  expect(saves()).toEqual([]);
});

test("the step count does not change when the password gets set mid-way",
  () => {
    const el = (cfg: Config) => <ToastProvider><DialogProvider>
      <Wizard cfg={cfg} mode="first" scan={idle} initialStep="protect"
        initialAccount="default" onConfig={onConfig} onClose={onClose} />
    </DialogProvider></ToastProvider>;
    const { rerender } = render(el(mkCfg()));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(current()).toContain("Password");
    rerender(el(mkCfg({}, { mode: "password" })));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(current()).toContain("Password");
  });

const startSlowTest = async () => {
  let release!: () => void;
  gate = new Promise((r) => { release = r; });
  routes["/api/config"] = () => [200, withNew()];
  open(mkCfg({ setup_needed: false }), "add");
  pick("Fastmail");
  await signIn("b@mail.example");
  await screen.findByText("Testing the connection…");
  return release;
};

test("Cancel test ends a running test and stays on the sign-in step",
  async () => {
    await startSlowTest();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel test" }));
    await waitFor(() => expect(screen.queryByText("Testing the connection…"))
      .toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(current()).toContain("Sign in");
    expect(screen.queryByText(/Could not|refused/)).toBeNull();
    expect(screen.getByRole("button", { name: "Test connection" })
      .hasAttribute("disabled")).toBe(false);
  });

test("Cancel test shows no error for the request it aborted", async () => {
  await startSlowTest();
  fireEvent.click(await screen.findByRole("button", { name: "Cancel test" }));
  await waitFor(() => expect(screen.queryByText("Testing the connection…"))
    .toBeNull());
  // an aborted fetch rejects with "aborted": never shown as an error
  expect(screen.queryByText(/abort/i)).toBeNull();
  expect(document.querySelector("[role=alert], .text-danger-fg")).toBeNull();
});

test("a test that finishes after Cancel test changes nothing", async () => {
  const release = await startSlowTest();
  fireEvent.click(await screen.findByRole("button", { name: "Cancel test" }));
  await waitFor(() => expect(screen.queryByText("Testing the connection…"))
    .toBeNull());
  release();
  await sleepMs(50);
  expect(current()).toContain("Sign in");
  expect(screen.queryByText(/The ticked folders/)).toBeNull();
});

test("X closes the wizard during a test and a late result stays silent",
  async () => {
    const release = await startSlowTest();
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // the account this session created is removed again, like any cancel
    expect(saves().some((c) => c.body.delete_account)).toBe(true);
    const configs = onConfig.mock.calls.length;
    release();
    await sleepMs(50);
    expect(onConfig.mock.calls.length).toBe(configs);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

test("X right after a successful test, while the config reloads, leaves " +
  "nothing behind", async () => {
  routes["/api/config"] = () => [200, withNew()];
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    // the GET of the config after the test is slow
    if (url.includes("/api/config") && (init?.method ?? "GET") === "GET"
      && calls.some((c) => c.url.includes("/api/test_connection")))
      await held;
    return real(url, init);
  }));
  open(mkCfg({ setup_needed: false }), "add");
  pick("Fastmail");
  await signIn("b@mail.example");
  await waitFor(() => expect(calls.some((c) =>
    c.url.includes("/api/test_connection"))).toBe(true));
  await sleepMs(20);
  fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  const configs = onConfig.mock.calls.length;
  release();
  await sleepMs(50);
  expect(onConfig.mock.calls.length).toBe(configs);
});

test("Esc closes the wizard during a test", async () => {
  await startSlowTest();
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

test("the Cancel test button only shows while testing", () => {
  open();
  pick("iCloud Mail");
  expect(screen.queryByRole("button", { name: "Cancel test" })).toBeNull();
});

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("Cancel after a failed add returns to the account the user was on",
  async () => {
    routes["/api/config"] = (b) => [200, b?.delete_account ? mkCfg()
      : withNew()];
    routes["/api/test_connection"] = () => [502, "auth_failed"];
    open(mkCfg({ setup_needed: false }), "add", idle,
      { previousAccount: "work" });
    pick("Fastmail");
    await signIn("b@mail.example");
    await screen.findByText(/refused the sign-in/);
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onConfig.mock.calls.pop()![1]).toBe("work");
  });

test("the folders step is the simple view: no rule chips, no special " +
  "folders, and the saved result still keeps the rules", async () => {
  await toFolders();
  expect(screen.queryByText(/Excluded by rule/)).toBeNull();
  expect(screen.queryByText(/Special folders/i)).toBeNull();
  pick("Continue");
  await screen.findByText(/Protect this page/);
  expect(saves().pop()!.body.excluded_folders).toContain("Labels/*");
});

test("network failures in the folders and scan steps read as words, with " +
  "the host", async () => {
  routes["/api/folders"] = () => [500, "host_unreachable:host=mail.example"];
  open();
  pick("iCloud Mail");
  await signIn();
  await screen.findByText(/Connected - /);
  pick(/Choose folders/);
  expect(await screen.findByText(/Could not reach mail\.example/))
    .toBeTruthy();
  expect(screen.queryByText(/OSError/)).toBeNull();
  cleanup();
  open(mkCfg({}, { mode: "password" }), "first",
    { ...idle, status: "error", error: "host_unreachable:host=mail.example" },
    { initialStep: "scan", initialAccount: "default" });
  expect(await screen.findByText(/Could not reach mail\.example/))
    .toBeTruthy();
});

test("the CA placeholder is Proton's path only on Proton", () => {
  open();
  pick("Proton Mail Bridge");
  expect(screen.getByLabelText(/Custom CA file/)
    .getAttribute("placeholder")).toBe("/certs/bridge-cert.pem");
  cleanup();
  open();
  pick(/Another IMAP/);
  expect(screen.getByLabelText(/Custom CA file/)
    .getAttribute("placeholder")).toBe("");
  expect(screen.queryByText(/advanced settings below/)).toBeNull();
});

test("provider tiles: app-password hint where we know it, a monogram, and " +
  "the other-server row", () => {
  open();
  expect(screen.getByRole("button", { name: "Gmail" })
    .getAttribute("aria-describedby")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Proton Mail Bridge" })
    .getAttribute("aria-describedby")).toBeNull();
  expect(screen.getAllByText("App password")).toHaveLength(4);
  expect(screen.getByRole("button", { name: "Another IMAP server" })
    .getAttribute("aria-describedby")).toBeTruthy();
  expect(current()).toContain("Choose provider");
});

test("German: the Custom tile is translated, 'Postfach' throughout, and the " +
  "scan heading changes when done", () => {
  setLang("de");
  const cfg = mkCfg({}, { mode: "password" });
  open();
  expect(screen.getByRole("button", { name: "Anderer IMAP-Server" }))
    .toBeTruthy();
  expect(screen.getByText("Postfach einrichten")).toBeTruthy();
  cleanup();
  setLang("en");
  open(cfg, "first", { ...idle, status: "scanning" },
    { initialStep: "scan", initialAccount: "default" });
  expect(screen.getByText("Reading your mailbox")).toBeTruthy();
  cleanup();
  open(cfg, "first", { ...idle, status: "done", scannedTs: 1 },
    { initialStep: "scan", initialAccount: "default" });
  expect(screen.queryByText("Reading your mailbox")).toBeNull();
  expect(screen.getByText("Scan finished")).toBeTruthy();
});

test("an unexpected scan failure reads as words, not as an exception", () => {
  open(mkCfg({}, { mode: "password" }), "first",
    { ...idle, status: "error", error: "scan_failed" },
    { initialStep: "scan", initialAccount: "default" });
  expect(screen.getByText(/The scan failed unexpectedly/)).toBeTruthy();
  expect(screen.queryByText(/scan_failed/)).toBeNull();
});

test("after a successful test the config is re-read so the account " +
  "counts as verified without a reload", async () => {
  const withFlag = (v: boolean) => {
    const c = mkCfg();
    c.accounts = { default: { ...c.accounts.default, verified: v } };
    return c;
  };
  // the save (a POST with a body) says unverified; only the re-read GET,
  // made after the test succeeded, says verified
  routes["/api/config"] = (b) => [200, withFlag(!!b ? false : true)];
  open();
  pick("iCloud Mail");
  await signIn();
  await screen.findByText("Connected - 7 folders found.");
  const last = onConfig.mock.calls.at(-1)![0] as Config;
  expect(last.accounts.default.verified).toBe(true);
});

test("the client-secret placeholder says optional for Microsoft, required " +
  "for Google", () => {
  const secret = (label = "Client secret") => screen.getByLabelText(label)
    .getAttribute("placeholder");
  open();
  pick("Outlook / Microsoft 365");
  expect(secret()).toBe("optional");
  cleanup();
  open();
  pick("Gmail");
  fireEvent.click(screen.getByRole("tab", { name: "OAuth" }));
  expect(secret()).toBe("required");
  cleanup();
  setLang("de");
  open();
  pick("Outlook / Microsoft 365");
  expect(secret("Client-Secret")).toBe("optional");
});
