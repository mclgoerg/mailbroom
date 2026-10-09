// @vitest-environment jsdom
/* Smart grouping in the app: the tab takes the Domain tab's slot, pooled rows
 * are worded in EN / DE from fields (never from server text), the free-text
 * filter reaches the members, shortcuts exist only where a row stands for one
 * exact sender / domain, and the phone layout renders the same rows as cards. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let state: any;
const protect = vi.fn().mockResolvedValue({ protected: [] });
const block = vi.fn().mockResolvedValue({ rule: { id: "r1" } });
const deleteGroups = vi.fn()
  .mockResolvedValue({ ok: true, queued: 1, skipped: 0 });
const groupMails = vi.fn().mockResolvedValue([]);

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
    protect: (...a: unknown[]) => protect(...a),
    block: (...a: unknown[]) => block(...a),
    deleteGroups: (...a: unknown[]) => deleteGroups(...a),
    group: (...a: unknown[]) => groupMails(...a),
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
import { findDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { AppState, Config, Group } from "./types";

const acct = {
  excluded_folders: [] as string[], host: "h", port: 993,
  security: "ssl" as const, smtp_host: "", smtp_port: 587,
  smtp_security: "auto" as const, user: "", password: "",
  password_set: true, cafile: "", preset: "custom" as const, oauth: null,
  digest: { schedule: "off" as const, recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours" as const, value: 6,
    align_minute: 0 },
  smart_min: 7,
};
let cfg: Config = {
  accounts: { proton: acct }, default_account: "proton",
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "m", foundry_endpoint: "",
    price_in: 0, price_out: 0, budget_usd: 0, month_cost: 0,
    prices_effective: [2, 10], api_key: "", api_key_set: false,
    available: false, source: null, shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
} as unknown as Config;

const mk = (over: Partial<Group>): Group => ({
  key: "x", label: "X", sub: "", count: 3, size: 3000, unread: 1,
  first: "2024-01-01", last: "2024-06-01", tags: [], samples: [],
  bulk: false, unsub: false, ai: null, ratings: null, protected: false,
  replied: false, att_size: 0, unsubscribed: null, new: false, pinned: 0,
  engagement: 50, ...over,
});

const own = mk({ key: "s:big@shop.example", label: "Big Shop",
  sub: "big@shop.example", count: 40, kind: "sender",
  addr: "big@shop.example", n_senders: 1, members: [] });
const company = mk({ key: "o:paypal.de", label: "paypal.de", count: 10,
  kind: "company", n_senders: 3, domain: "paypal.de",
  members: ["a@paypal.de", "b@paypal.de", "c@paypal.de"] });
const mixedCompany = mk({ key: "o:example.co.uk", label: "example.co.uk",
  count: 12, kind: "company", n_senders: 2, domain: "",
  members: ["a@shop.example.co.uk", "b@mail.example.co.uk"] });
const newsletters = mk({ key: "k:newsletter", label: "Newsletters",
  count: 20, kind: "newsletter", n_senders: 12,
  members: ["promo@lone.example", "hello@zine.example"] });
const accounts = mk({ key: "k:accounts", label: "Accounts & security",
  count: 9, kind: "accounts", n_senders: 1, members: ["auth@svc.example"] });
const shipping = mk({ key: "k:cat:shipping", label: "shipping", count: 8,
  kind: "category", category: "shipping", n_senders: 4,
  members: ["noreply@dhl.example"] });

const SMART = [own, company, mixedCompany, newsletters, accounts, shipping];

const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: ["INBOX"],
  groups: { sender: { "dhl@x.example": mk({ key: "dhl@x.example",
      label: "DHL", sub: "dhl@x.example" }) },
    smart: Object.fromEntries(SMART.map((g) => [g.key, g])),
    domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: ["INBOX"], rules: [],
  presets: [],
};

beforeEach(() => {
  setLang("en");
  localStorage.setItem("pmc_account", "proton");
  state = baseState;
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  protect.mockClear();
  block.mockClear();
  deleteGroups.mockClear();
  groupMails.mockClear();
  setLang("en");
});

const mount = async () => {
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await screen.findByRole("tab", { name: "Smart" });
};
const openSmart = async () => {
  await mount();
  fireEvent.click(screen.getByRole("tab", { name: "Smart" }));
  await waitFor(() => expect(screen.getAllByText("Big Shop").length)
    .toBeGreaterThan(0));
};
const openRow = (label: string) =>
  fireEvent.click(screen.getAllByText(label)[0]);

test("the switcher shows Smart in the Domain tab's slot; Sender stays default",
  async () => {
    await mount();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((b) => b.textContent))
      .toEqual(["Sender", "Smart", "Subject", "Thread", "All mails"]);
    expect(screen.queryByRole("tab", { name: "Domain" })).toBeNull();
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(screen.getAllByText("DHL").length)
      .toBeGreaterThan(0));
  });

test("bucket rows are worded in English from kind / n_senders fields",
  async () => {
    await openSmart();
    for (const text of ["Newsletters", "12 senders", "Accounts & security",
      "1 sender", "Category: shipping", "paypal.de", "3 senders"]) {
      expect(screen.getAllByText(text).length, text).toBeGreaterThan(0);
    }
    // own rows look like Sender-tab rows: name + the address as sub-line
    expect(screen.getAllByText("big@shop.example").length).toBeGreaterThan(0);
  });

test("a server-side English label never shows in the German UI", async () => {
  setLang("de");
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  fireEvent.click(await screen.findByRole("tab", { name: "Smart" }));
  await waitFor(() => expect(screen.getAllByText("Big Shop").length)
    .toBeGreaterThan(0));
  for (const text of ["Newsletter", "12 Absender", "Konten & Sicherheit",
    "1 Absender", "Kategorie: shipping", "3 Absender"]) {
    expect(screen.getAllByText(text).length, text).toBeGreaterThan(0);
  }
  expect(screen.queryByText("Newsletters")).toBeNull();
  expect(screen.queryByText("Accounts & security")).toBeNull();
});

test("the free-text filter matches a bucket's member addresses", async () => {
  await openSmart();
  const box = await screen.findByPlaceholderText("filter groups…");
  fireEvent.change(box, { target: { value: "zine" } });
  await waitFor(() => expect(screen.queryAllByText("Big Shop")).toHaveLength(0));
  expect(screen.getAllByText("Newsletters").length).toBeGreaterThan(0);
  expect(screen.queryAllByText("Accounts & security")).toHaveLength(0);
  // the filter also finds a row by its translated name
  fireEvent.change(box, { target: { value: "security" } });
  await waitFor(() => expect(screen.queryAllByText("Newsletters")).toHaveLength(0));
  expect(screen.getAllByText("Accounts & security").length).toBeGreaterThan(0);
  // and `from:` / `domain:` reach pooled senders too
  fireEvent.change(box, { target: { value: "from:a@paypal.de" } });
  await waitFor(() => expect(screen.getAllByText("paypal.de").length)
    .toBeGreaterThan(0));
  expect(screen.queryAllByText("Newsletters")).toHaveLength(0);
  // `domain:` is the exact mail domain, so it reaches subdomain senders too
  fireEvent.change(box, { target: { value: "domain:mail.example.co.uk" } });
  await waitFor(() => expect(screen.getAllByText("example.co.uk").length)
    .toBeGreaterThan(0));
  expect(screen.queryAllByText("paypal.de")).toHaveLength(0);
});

test("an own row keeps protect, block and Sieve for its address", async () => {
  await openSmart();
  openRow("Big Shop");
  fireEvent.click(await screen.findByRole("button", { name: "Block sender" }));
  await findDialog();
  await pressDialog("Block");
  await findDialog();
  await pressDialog("Move to Trash (40)");
  await waitFor(() => expect(block).toHaveBeenCalledWith(
    "sender", "big@shop.example", "Big Shop", true));
  expect(deleteGroups).not.toHaveBeenCalled();   // the endpoint trashes it
});

test("protecting an own row protects the exact address", async () => {
  await openSmart();
  openRow("Big Shop");
  fireEvent.click(await screen.findByRole("button", { name: /Protect/ }));
  await waitFor(() => expect(protect).toHaveBeenCalledWith(
    "big@shop.example", true));
});

test("a company row with one exact domain protects @domain and closes",
  async () => {
    await openSmart();
    openRow("paypal.de");
    fireEvent.click(await screen.findByRole("button", { name: /Protect/ }));
    await waitFor(() => expect(protect).toHaveBeenCalledWith(
      "@paypal.de", true));
    // its mails now sit in the protected bucket: say so
    expect(await screen.findByText(/moved to “Protected senders”/))
      .toBeTruthy();
  });

test("blocking a company row trashes only the pool, not the whole domain",
  async () => {
    await openSmart();
    openRow("paypal.de");
    fireEvent.click(await screen.findByRole("button", { name: "Block sender" }));
    await findDialog();
    await pressDialog("Block");
    await findDialog();
    await pressDialog("Move to Trash (10)");
    await waitFor(() => expect(block).toHaveBeenCalledWith(
      "domain", "paypal.de", "paypal.de", false));
    expect(deleteGroups).toHaveBeenCalledWith("smart", ["o:paypal.de"]);
  });

test("a company pool spanning several domains has no shortcuts", async () => {
  await openSmart();
  openRow("example.co.uk");
  await screen.findByText(/Several senders of example.co.uk/);
  expect(screen.queryByRole("button", { name: /Protect/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Block sender" })).toBeNull();
});

test("bucket rows have no protect, block or Sieve", async () => {
  await openSmart();
  for (const label of ["Newsletters", "Accounts & security",
    "Category: shipping"]) {
    openRow(label);
    await screen.findByText(/Senders with fewer than/);
    expect(screen.queryByRole("button", { name: /Protect/ }), label).toBeNull();
    expect(screen.queryByRole("button", { name: "Block sender" }), label)
      .toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByRole("menuitem", { name: /Sieve/ }), label).toBeNull();
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  }
});

test("the detail view says in one line why the mails are here", async () => {
  await openSmart();
  openRow("Accounts & security");
  expect(await screen.findByText(
    "Senders with fewer than 7 mails, mostly sign-ups and security codes."))
    .toBeTruthy();                       // threshold comes from the account
  expect(groupMails).toHaveBeenCalledWith("smart", "k:accounts");
});

test("an own row's detail has no pooled explanation", async () => {
  await openSmart();
  openRow("Big Shop");
  await screen.findByRole("button", { name: "Block sender" });
  expect(screen.queryByText(/Senders with fewer than/)).toBeNull();
});

test("the explanation is translated too", async () => {
  setLang("de");
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  fireEvent.click(await screen.findByRole("tab", { name: "Smart" }));
  await waitFor(() => expect(screen.getAllByText("Newsletter").length)
    .toBeGreaterThan(0));
  openRow("Newsletter");
  expect(await screen.findByText(
    "Absender mit weniger als 7 Mails, die einen Abmeldelink anbieten."))
    .toBeTruthy();
});

test("on a 390 px phone the same rows render as cards with kind icons",
  async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: /max-width/.test(q) || !/min-width/.test(q), media: q,
      addEventListener: () => {}, removeEventListener: () => {},
    }));
    await openSmart();
    // jsdom lays out both the table and the phone cards: look at the cards
    const cards = document.querySelector(".md\\:hidden") as HTMLElement;
    expect(within(cards).getByText("Newsletters")).toBeTruthy();
    expect(within(cards).getByText("12 senders")).toBeTruthy();
    // pooled rows: an icon disc instead of a letter; own rows: the letter
    const discs = [...cards.querySelectorAll("span.rounded-full")];
    const icons = discs.filter((d) => d.querySelector("svg") && !d.textContent);
    expect(icons.length).toBe(5);        // company x2, newsletter, accounts, category
    expect(discs.some((d) => d.textContent === "B")).toBe(true);
    // the card's title is a button that opens the detail
    fireEvent.click(within(cards).getByRole("button", { name: "Newsletters" }));
    expect(await screen.findByText(/Senders with fewer than 7 mails/))
      .toBeTruthy();
  });
