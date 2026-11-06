// @vitest-environment jsdom
/* Demo mode in the App shell: entry points that would only end in the
 * backend's "Not available in the demo." are shown disabled with the hint;
 * with the flag off they are exactly as before (AI ones hidden without a
 * key, Add account enabled). */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let probeDemo = false;     // what /api/auth says
let state: any;
let cfg: any;


vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true,
      demo: probeDemo }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
    rules: () => Promise.resolve({ cap: 500, rules: [] }),
  },
  downloadFile: () => Promise.resolve(),
  setAccount: () => {},
  withAccount: (p: string) => p,
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { setDemo } from "./demoMode";
import { setLang } from "./i18n";
import type { AppState, Config, Group } from "./types";

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

const mkCfg = (available: boolean): Config => ({
  default_account: "proton",
  accounts: { proton: { ...acct, user: "me@proton.example" } },
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "claude-sonnet-5",
    foundry_endpoint: "", price_in: 0, price_out: 0, budget_usd: 0,
    month_cost: 0, prices_effective: [2, 10], api_key: "",
    api_key_set: available, available, source: available ? "own" : null,
    shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
});

const mkGroup = (over: Partial<Group> = {}): Group => ({
  key: "a@x.example", label: "Sender A", sub: "a@x.example", count: 5,
  size: 1000, unread: 0, first: "2020-01-01", last: "2020-06-01",
  tags: [], samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
  new: false, pinned: 0, engagement: 50, ...over,
});

// Old, never-read newsletters (two, one protected) and one fresh sender.
const GROUPS = [
  mkGroup({ key: "n1@one.example", label: "Weekly One", count: 40, size: 4_000_000,
    unread: 40, tags: ["newsletter"], bulk: true }),
  mkGroup({ key: "n2@two.example", label: "Weekly Two", count: 10, size: 1_000_000,
    unread: 10, tags: ["newsletter"], bulk: true, protected: true }),
  mkGroup({ key: "f@fresh.example", label: "Fresh Friend", count: 3, size: 3000,
    unread: 0, last: new Date().toISOString().slice(0, 10) }),
];

const baseState = (): AppState => ({
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: [],
  groups: { sender: Object.fromEntries(GROUPS.map((g) => [g.key, g])),
    smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: [],
  presets: [],
});


const HINT = "Not available in the demo.";

beforeEach(() => {
  localStorage.setItem("pmc_account", "proton");
  cfg = mkCfg(false);
  state = baseState();
});
afterEach(() => {
  cleanup();
  probeDemo = false;
  setDemo(false);
  localStorage.clear();
  setLang("en");
});

const mount = async () => {
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(screen.getAllByText("Weekly One").length)
    .toBeGreaterThan(0));
};

test("demo: AI filter, AI review and Add account are disabled with the hint",
  async () => {
  probeDemo = true;
  await mount();
  expect((screen.getByRole("button", { name: /Describe a filter/ }) as
    HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("button", { name: /Describe a filter/ })
    .getAttribute("aria-label")).toContain(HINT);

  fireEvent.click(screen.getByRole("button", { name: "Tools" }));
  const review = screen.getByRole("menuitem", { name: /AI review/ });
  expect((review as HTMLButtonElement).disabled).toBe(true);
  expect(review.textContent).toContain(HINT);
  fireEvent.click(screen.getByRole("button", { name: "Tools" }));

  fireEvent.click(screen.getByLabelText("Profile & settings"));
  const add = screen.getByRole("menuitem", { name: /Add account/ });
  expect((add as HTMLButtonElement).disabled).toBe(true);
  expect(add.textContent).toContain(HINT);
});

test("demo: the bulk bar's AI review option is disabled with the hint",
  async () => {
  probeDemo = true;
  await mount();
  fireEvent.click(document.querySelectorAll('input[type="checkbox"]')[1]);
  await screen.findByDisplayValue("Action…");
  const opt = screen.getByRole("option", { name: /AI review/ }) as
    HTMLOptionElement;
  expect(opt.disabled).toBe(true);
  expect(opt.textContent).toContain(HINT);
});

test("no demo flag: AI entry points stay hidden without a key, Add account " +
  "is enabled", async () => {
  await mount();
  expect(screen.queryByLabelText("Describe a filter")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Tools" }));
  expect(screen.queryByRole("menuitem", { name: /AI review/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Tools" }));
  fireEvent.click(screen.getByLabelText("Profile & settings"));
  expect((screen.getByRole("menuitem", { name: /Add account/ }) as
    HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByText(HINT)).toBeNull();
});
