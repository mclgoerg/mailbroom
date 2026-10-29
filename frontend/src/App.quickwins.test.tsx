// @vitest-environment jsdom
/* Quick wins strip (F5): visibility rules, Review, Clean up (always via the
 * confirm), "Not now" per account, phone layout, German. */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

let state: any;
const deleteGroups = vi.fn()
  .mockResolvedValue({ ok: true, queued: 1, skipped: 0 });

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
    deleteGroups: (...a: unknown[]) => deleteGroups(...a),
    group: () => Promise.resolve([]),
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
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from
  "./dialogTestUtils";
import { setLang } from "./i18n";
import { saveDismissed } from "./quickwins";
import type { AppState, Config, Group } from "./types";

const MB = 1048576;
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
const cfg: Config = {
  default_account: "proton",
  accounts: { proton: { ...acct, user: "me@proton.example" },
    other: { ...acct, user: "me@other.example" } },
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
const mk = (key: string, over: Partial<Group> = {}): Group => ({
  key, label: `Label ${key.split("@")[0]}`, sub: key, count: 5, size: 1000,
  unread: 0, first: "2020-01-01", last: "2099-01-01", tags: [],
  samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
  new: false, pinned: 0, engagement: 80, ...over,
});
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
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: [],
  presets: [],
};
// Card 1 (old newsletters): news = 20 mails. Card 2 (quiet): quiet = 30
// mails; the protected sender matches it too but is skipped.
const news = mk("news@x.example", { tags: ["newsletter"], count: 20,
  unread: 19, size: 6 * MB, last: "2024-01-01" });
const quiet = mk("quiet@x.example", { count: 30, size: 10 * MB,
  engagement: 10, last: "2024-01-01" });
const prot = mk("prot@x.example", { count: 40, size: 20 * MB,
  engagement: 10, last: "2024-01-01", protected: true });
const fresh = mk("fresh@x.example");

const setup = (over: Partial<AppState> = {},
               groups = [news, quiet, prot, fresh]) => {
  localStorage.setItem("pmc_account", "proton");
  state = { ...baseState, ...over, groups: { sender: Object.fromEntries(
    groups.map((g) => [g.key, g])), smart: {}, domain: {}, subject: {},
    thread: {} } };
  render(<ToastProvider><DialogProvider><App /></DialogProvider>
    </ToastProvider>);
};
const strip = () => screen.queryByRole("region", { name: "Quick wins" });
const ready = () => waitFor(() => expect(
  screen.getAllByText("Label fresh").length).toBeGreaterThan(0));

const ready0 = () => waitFor(() => expect(
  screen.getAllByText("Label g1").length).toBeGreaterThan(0));

afterEach(() => {
  cleanup();
  localStorage.clear();
  deleteGroups.mockClear();
  setLang("en");
});

test("the strip lists the cards, with the union size in the header",
  async () => {
  setup();
  await ready();
  const cards = screen.getAllByTestId("qw-card");
  expect(cards).toHaveLength(2);
  expect(cards[0].textContent).toContain("Quiet senders");   // 10 MB first
  expect(cards[0].textContent).toContain("30 mails - 10.0 MB");
  expect(cards[1].textContent).toContain("20 mails - 6.0 MB");
  expect(cards[0].textContent).toContain("1 protected skipped");
  expect(strip()!.textContent).toContain("free up to 16.0 MB");
});

test("hidden without a scan, on another tab, with a filter, with a " +
  "selection", async () => {
  setup({ scanned_ts: null });
  await ready();
  expect(strip()).toBeNull();
  cleanup();

  setup();
  await ready();
  expect(strip()).not.toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Smart" }));
  expect(strip()).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Sender" }));
  expect(strip()).not.toBeNull();

  fireEvent.change(screen.getByPlaceholderText("filter groups…"),
    { target: { value: "fresh" } });
  expect(strip()).toBeNull();
  fireEvent.change(screen.getByPlaceholderText("filter groups…"),
    { target: { value: "" } });
  expect(strip()).not.toBeNull();

  fireEvent.click(screen.getAllByRole("checkbox")[1]);
  expect(strip()).toBeNull();
});

test("Review sets the filter and selects exactly the card's groups",
  async () => {
  setup();
  await ready();
  fireEvent.click(screen.getAllByRole("button", { name: "Review" })[0]);
  expect((screen.getByPlaceholderText("filter groups…") as HTMLInputElement)
    .value).toBe("eng:low age:>1y");
  // exactly the one non-protected match is selected (bar: groups + mails)
  await waitFor(() => expect(screen.getByText("1 group · 30 mails"))
    .toBeTruthy());
  expect(strip()).toBeNull();                 // list no longer untouched
  expect(deleteGroups).not.toHaveBeenCalled();
});

test("Clean up opens the trash confirm with the card's counts and does " +
  "nothing on Cancel", async () => {
  setup();
  await ready();
  fireEvent.click(screen.getAllByRole("button", { name: "Clean up" })[0]);
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("30 mails");
  expect(dlg.textContent).not.toContain("40");       // protected skipped
  expect(deleteGroups).not.toHaveBeenCalled();
  await cancelDialog();
  await expectNoDialog();
  expect(deleteGroups).not.toHaveBeenCalled();
});

test("confirming Clean up trashes exactly the card's non-protected keys",
  async () => {
  setup();
  await ready();
  fireEvent.click(screen.getAllByRole("button", { name: "Clean up" })[0]);
  await pressDialog(/Move to Trash/);
  await waitFor(() => expect(deleteGroups).toHaveBeenCalledWith(
    "sender", ["quiet@x.example"], "trash", "", false, null, null));
});

test("Not now hides the card for this account only, and it returns after " +
  "25 % more mails", async () => {
  setup();
  await ready();
  fireEvent.click(screen.getAllByRole("button", { name: "Not now" })[0]);
  expect(screen.getAllByTestId("qw-card")).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem("pmc_qw_dismissed:proton")!))
    .toEqual({ quiet_low: 30 });
  expect(localStorage.getItem("pmc_qw_dismissed:other")).toBeNull();
  cleanup();

  // a later scan: 37 mails is below +25 % (37.5), 38 is above
  saveDismissed("proton", { quiet_low: 30 });
  quiet.count = 37;
  setup();
  await ready();
  expect(screen.getAllByTestId("qw-card")).toHaveLength(1);
  cleanup();
  quiet.count = 38;
  setup();
  await ready();
  expect(screen.getAllByTestId("qw-card")).toHaveLength(2);
  quiet.count = 30;
});

test("a dismissal of another account does not hide the card", async () => {
  saveDismissed("other", { quiet_low: 30, old_newsletters: 20 });
  setup();
  await ready();
  expect(screen.getAllByTestId("qw-card")).toHaveLength(2);
});

test("collapsing is remembered", async () => {
  setup();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Hide quick wins" }));
  expect(screen.queryAllByTestId("qw-card")).toHaveLength(0);
  expect(localStorage.getItem("pmc_qw_collapsed")).toBe("1");
  cleanup();
  setup();
  await ready();
  expect(screen.queryAllByTestId("qw-card")).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Show quick wins" })).toBeTruthy();
});

test("only the top 3 cards show; More reveals the rest and the union " +
  "total follows", async () => {
  const old = { last: "2020-01-01", count: 20 };
  const done = { n: 1, of: 1, status: "done" as const, link: "", addr: "" };
  const ai = { verdict: "delete_safe", reason: "" } as Group["ai"];
  setup({}, [
    mk("g1@x.example", { ...old, tags: ["newsletter"], unread: 20,
      size: 60 * MB }),
    mk("g2@x.example", { ...old, engagement: 5, size: 50 * MB }),
    mk("g3@x.example", { ...old, unsubscribed: done, size: 40 * MB }),
    mk("g4@x.example", { ...old, att_size: 30 * MB, size: 30 * MB }),
    mk("g5@x.example", { ...old, ai, size: 20 * MB }),
  ]);
  await ready0();
  expect(screen.getAllByTestId("qw-card")).toHaveLength(3);
  expect(strip()!.textContent).toContain("free up to 150.0 MB");
  fireEvent.click(screen.getByRole("button", { name: "2 more" }));
  expect(screen.getAllByTestId("qw-card")).toHaveLength(5);
  expect(strip()!.textContent).toContain("free up to 200.0 MB");
});

test("phone layout: the cards sit in a scroll-snap row", async () => {
  setup();
  await ready();
  const list = screen.getAllByTestId("qw-card")[0].parentElement!;
  expect(list.className).toContain("snap-x");
  expect(list.className).toContain("overflow-x-auto");
});

test("German strings", async () => {
  setLang("de");
  setup();
  await waitFor(() => expect(
    screen.getByRole("region", { name: "Schnelle Erfolge" })).toBeTruthy());
  expect(screen.getAllByRole("button", { name: "Aufräumen" })).toHaveLength(2);
  expect(screen.getAllByRole("button", { name: "Nicht jetzt" })).toHaveLength(2);
  expect(screen.getAllByRole("button", { name: "Ansehen" })).toHaveLength(2);
});
