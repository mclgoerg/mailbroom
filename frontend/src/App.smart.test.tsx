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
const protectMany = vi.fn().mockResolvedValue({ protected: [] });
const aiSortEstimate = vi.fn();
const aiSort = vi.fn().mockResolvedValue({ units: 3, senders: 5 });
const aiSortClear = vi.fn().mockResolvedValue({ cleared: 2 });
const unsubscribeBulk = vi.fn().mockResolvedValue({ queued: 1,
  skipped_protected: 0, skipped_done: 0, capped: 0 });
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
    protectMany: (...a: unknown[]) => protectMany(...a),
    unsubscribeBulk: (...a: unknown[]) => unsubscribeBulk(...a),
    aiSortEstimate: (...a: unknown[]) => aiSortEstimate(...a),
    aiSort: (...a: unknown[]) => aiSort(...a),
    aiSortClear: (...a: unknown[]) => aiSortClear(...a),
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
import { expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
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
const company = mk({ key: "o:payco.example", label: "payco.example", count: 10,
  kind: "company", n_senders: 3, domain: "payco.example",
  purposes: { orders: 6, accounts: 3, unclassified: 1 },
  members: ["a@payco.example", "b@payco.example", "c@payco.example"] });
const mixedCompany = mk({ key: "o:hub.example", label: "hub.example",
  count: 12, kind: "company", n_senders: 2, domain: "",
  members: ["a@shop.hub.example", "b@mail.hub.example"] });
const newsletters = mk({ key: "k:newsletter", label: "Newsletters",
  count: 20, kind: "newsletter", n_senders: 12,
  members: ["promo@lone.example", "hello@zine.example"] });
const accounts = mk({ key: "k:accounts", label: "Accounts & security",
  count: 9, kind: "accounts", n_senders: 1, members: ["auth@svc.example"] });
const shipping = mk({ key: "k:cat:shipping", label: "shipping", count: 8,
  kind: "category", category: "shipping", n_senders: 4,
  members: ["noreply@dhl.example"] });

const orders = mk({ key: "k:orders", label: "Orders & deliveries", count: 14,
  kind: "orders", n_senders: 6, members: ["order@shop-a.example"] });
const appointments = mk({ key: "k:appointments", label: "x", count: 5,
  kind: "appointments", n_senders: 3, members: ["termin@clinic.example"] });
const jobs = mk({ key: "k:jobs", label: "x", count: 4, kind: "jobs",
  n_senders: 2, members: ["hr@corp.example"] });
const support = mk({ key: "k:support", label: "x", count: 6, kind: "support",
  n_senders: 4, members: ["help@desk.example"] });

const SMART = [own, company, mixedCompany, newsletters, accounts, shipping,
  orders, appointments, jobs, support];

// The state ships every SENDER record with the key of the Smart row it landed
// in; the pooled rows' own `members` is a capped sample the UI must not use.
const senderRec = (addr: string, smart_key: string,
    over: Partial<Group> = {}): Group =>
  mk({ key: addr, label: addr, sub: "", smart_key,
    smart_why: { r: "none" }, ...over });
const stamped = (row: Group): Group[] => row.key === own.key
  ? [senderRec("big@shop.example", row.key)]
  : (row.members ?? []).map((a) => senderRec(a, row.key));
const senderGroup = (rows: Group[]) => Object.fromEntries(
  rows.flatMap(stamped).map((r) => [r.key, r]));

const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: ["INBOX"],
  groups: { sender: { "dhl@x.example": mk({ key: "dhl@x.example",
      label: "DHL", sub: "dhl@x.example" }), ...senderGroup(SMART) },
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
  protectMany.mockClear();
  unsubscribeBulk.mockClear();
  aiSortEstimate.mockReset();
  aiSort.mockClear();
  aiSortClear.mockClear();
  cfg.ai.available = false;
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
      "1 sender", "Category: shipping", "payco.example", "3 senders"]) {
      expect(screen.getAllByText(text).length, text).toBeGreaterThan(0);
    }
    // own rows look like Sender-tab rows: name + the address as sub-line
    expect(screen.getAllByText("big@shop.example").length).toBeGreaterThan(0);
  });

test("the purpose kinds are worded in English from their kind alone",
  async () => {
    await openSmart();
    for (const text of ["Orders & deliveries", "Appointments & bookings",
      "Job applications", "Support & inquiries"]) {
      expect(screen.getAllByText(text).length, text).toBeGreaterThan(0);
    }
    // the English fallback label sent by the server ("x") is never shown
    expect(screen.queryAllByText("x")).toHaveLength(0);
  });

test("a company row names what its mails are about, in both languages",
  async () => {
    await openSmart();
    expect(screen.getAllByText("3 senders \u00b7 Orders 6 \u00b7 Accounts 3")
      .length).toBeGreaterThan(0);
    openRow("payco.example");
    expect(await screen.findByText(
      "What the mails are about: Orders 6 \u00b7 Accounts 3 \u00b7 Unclassified 1"))
      .toBeTruthy();
    cleanup();
    setLang("de");
    render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
    fireEvent.click(await screen.findByRole("tab", { name: "Smart" }));
    await waitFor(() => expect(screen.getAllByText("Bestellungen & Lieferungen")
      .length).toBeGreaterThan(0));
    for (const text of ["Termine & Buchungen", "Bewerbungen",
      "Support & Anfragen", "3 Absender \u00b7 Bestellungen 6 \u00b7 Konten 3"]) {
      expect(screen.getAllByText(text).length, text).toBeGreaterThan(0);
    }
    expect(screen.queryByText("Orders & deliveries")).toBeNull();
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
  fireEvent.change(box, { target: { value: "from:a@payco.example" } });
  await waitFor(() => expect(screen.getAllByText("payco.example").length)
    .toBeGreaterThan(0));
  expect(screen.queryAllByText("Newsletters")).toHaveLength(0);
  // `domain:` is the exact mail domain, so it reaches subdomain senders too
  fireEvent.change(box, { target: { value: "domain:mail.hub.example" } });
  await waitFor(() => expect(screen.getAllByText("hub.example").length)
    .toBeGreaterThan(0));
  expect(screen.queryAllByText("payco.example")).toHaveLength(0);
});

test("the filter reaches EVERY member of a big pool, not the capped list",
  async () => {
    // N=2: the lowest own-row threshold leaves singletons by the hundreds in
    // one bucket; the backend ships only the first 300 addresses per row.
    const N = 650;
    const addrs = Array.from({ length: N }, (_, i) => `s${i}@rnd${i}.example`);
    const bucket = { ...newsletters, n_senders: N, members: addrs.slice(0, 300) };
    const smart = { ...baseState.groups.smart, [bucket.key]: bucket };
    state = { ...baseState, groups: { ...baseState.groups, smart,
      sender: { ...baseState.groups.sender,
        ...senderGroup([{ ...bucket, members: addrs }]) } } };
    acct.smart_min = 2;
    try {
      await openSmart();
      expect(screen.getAllByText("650 senders").length).toBeGreaterThan(0);
      const box = await screen.findByPlaceholderText("filter groups…");
      for (const q of ["s649@rnd649", "s301@", "from:s500@rnd500.example",
        "domain:rnd450.example"]) {
        fireEvent.change(box, { target: { value: q } });
        await waitFor(() => expect(screen.queryAllByText("Big Shop"))
          .toHaveLength(0));
        expect(screen.getAllByText("Newsletters").length, q).toBeGreaterThan(0);
        expect(screen.queryAllByText("Accounts & security"), q).toHaveLength(0);
      }
      // a sender nobody has matches no row
      fireEvent.change(box, { target: { value: "s650@rnd650" } });
      await waitFor(() => expect(screen.queryAllByText("Newsletters"))
        .toHaveLength(0));
    } finally { acct.smart_min = 7; }
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
    openRow("payco.example");
    fireEvent.click(await screen.findByRole("button", { name: /Protect/ }));
    await waitFor(() => expect(protect).toHaveBeenCalledWith(
      "@payco.example", true));
    // its mails now sit in the protected bucket: say so
    expect(await screen.findByText(/moved to “Protected senders”/))
      .toBeTruthy();
  });

test("blocking a company row trashes only the pool, not the whole domain",
  async () => {
    await openSmart();
    openRow("payco.example");
    fireEvent.click(await screen.findByRole("button", { name: "Block sender" }));
    await findDialog();
    await pressDialog("Block");
    await findDialog();
    await pressDialog("Move to Trash (10)");
    await waitFor(() => expect(block).toHaveBeenCalledWith(
      "domain", "payco.example", "payco.example", false));
    expect(deleteGroups).toHaveBeenCalledWith("smart", ["o:payco.example"]);
  });

test("a company pool spanning several domains has no shortcuts", async () => {
  await openSmart();
  openRow("hub.example");
  await screen.findByText(/Several senders of hub.example/);
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
    fireEvent.click(screen.getByRole("tab", { name: /^Mails \(/ }));
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
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
  // the senders are the point; the pool's mails load only on request
  expect(groupMails).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("tab", { name: /^Mails \(/ }));
  await waitFor(() => expect(groupMails)
    .toHaveBeenCalledWith("smart", "k:accounts"));
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
    "Absender mit weniger als 7 Mails, die einen Abmeldelink anbieten oder Werbung schicken."))
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
    // company x2, newsletter, accounts, category, orders, appointments, jobs,
    // support
    expect(icons.length).toBe(9);
    expect(discs.some((d) => d.textContent === "B")).toBe(true);
    // the card's title is a button that opens the detail
    fireEvent.click(within(cards).getByRole("button", { name: "Newsletters" }));
    expect(await screen.findByText(/Senders with fewer than 7 mails/))
      .toBeTruthy();
  });


// ---------------------------------------------------- the sender list (S3)

const tick = (addr: string) =>
  fireEvent.click(screen.getByLabelText(`Select ${addr}`));
const pickAction = (value: string) => fireEvent.change(
  screen.getAllByRole("combobox").find((c) =>
    [...(c as HTMLSelectElement).options].some((o) => o.value === value))!,
  { target: { value } });

test("a pooled row opens on its senders - with the reason - and the mails "
  + "are one tab away; an own row has no such tabs", async () => {
  await openSmart();
  openRow("Newsletters");
  const senders = await screen.findByRole("tab", { name: "Senders (2)" });
  expect(senders.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tab", { name: "Mails (20)" })).toBeTruthy();
  expect(screen.getByText("promo@lone.example")).toBeTruthy();
  expect(screen.getByText("hello@zine.example")).toBeTruthy();
  expect(screen.getAllByText("Nothing in its mails says what it is about.")
    .length).toBe(2);
  cleanup();
  await openSmart();
  openRow("Big Shop");
  await screen.findByRole("button", { name: "Block sender" });
  expect(screen.queryByRole("tab", { name: /^Senders/ })).toBeNull();
});

test("trashing ticked senders acts on exactly those addresses", async () => {
  await openSmart();
  openRow("Newsletters");
  await screen.findByRole("tab", { name: "Senders (2)" });
  tick("promo@lone.example");
  expect(screen.getByText("1 of 2 senders selected (3 mails)")).toBeTruthy();
  // one red scope at a time: the whole-pool "Trash all" steps aside
  expect(screen.queryByRole("button", { name: /^Trash all/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Trash selected (1)" }));
  const dlg = await findDialog();
  expect(within(dlg).getByText("3 mails from 1 sender will be affected"))
    .toBeTruthy();
  await pressDialog("Move to Trash (3)");
  await waitFor(() => expect(deleteGroups).toHaveBeenCalledWith(
    "sender", ["promo@lone.example"], "trash", "", false, null, null));
  // never the pool itself, never a domain
  expect(deleteGroups.mock.calls.some((c) => c[0] === "smart")).toBe(false);
});

test("protecting ticked senders is ONE call with their exact addresses",
  async () => {
    await openSmart();
    openRow("Newsletters");
    await screen.findByRole("tab", { name: "Senders (2)" });
    tick("promo@lone.example");
    tick("hello@zine.example");
    pickAction("protect");
    await waitFor(() => expect(protectMany).toHaveBeenCalledTimes(1));
    expect(new Set(protectMany.mock.calls[0][0])).toEqual(
      new Set(["promo@lone.example", "hello@zine.example"]));
    expect(protectMany.mock.calls[0][1]).toBe(true);
    expect(protect).not.toHaveBeenCalled();
    expect(await screen.findByText(
      "2 senders protected \u2013 their mails moved to \u201cProtected senders\u201d."))
      .toBeTruthy();
  });

test("one sender opens in place with its own actions - the explicit "
  + "single-sender Unsubscribe lives there - and Back keeps the ticks",
  async () => {
    const withUnsub = {
      ...baseState, groups: { ...baseState.groups, sender: {
        ...baseState.groups.sender,
        "promo@lone.example": senderRec("promo@lone.example", "k:newsletter",
          { unsub: true, label: "Promo Lone" }) } } };
    state = withUnsub;
    await openSmart();
    openRow("Newsletters");
    await screen.findByRole("tab", { name: "Senders (2)" });
    // the POOL has no unsubscribe, however many senders it holds
    expect(screen.queryByRole("button", { name: "Unsubscribe" })).toBeNull();
    tick("hello@zine.example");
    fireEvent.click(screen.getByRole("button", { name: "Promo Lone" }));
    expect(await screen.findByRole("button", { name: "Unsubscribe" }))
      .toBeTruthy();
    await waitFor(() => expect(groupMails)
      .toHaveBeenCalledWith("sender", "promo@lone.example"));
    expect(screen.getByRole("button", { name: /Protect/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to the senders" }));
    expect(await screen.findByRole("tab", { name: "Senders (2)" })).toBeTruthy();
    expect(screen.getByText("1 of 2 senders selected (3 mails)")).toBeTruthy();
  });

test("protecting the inspected sender protects that exact address",
  async () => {
    await openSmart();
    openRow("Newsletters");
    await screen.findByRole("tab", { name: "Senders (2)" });
    fireEvent.click(screen.getByRole("button", { name: "hello@zine.example" }));
    fireEvent.click(await screen.findByRole("button", { name: /Protect/ }));
    await waitFor(() => expect(protect).toHaveBeenCalledWith(
      "hello@zine.example", true));
  });

test("a pool of hundreds of senders at N=2: search, tick all matches, act on "
  + "exactly those", async () => {
  const N = 650;
  const addrs = Array.from({ length: N }, (_, i) => `s${i}@rnd${i}.example`);
  const bucket = { ...newsletters, n_senders: N, members: addrs.slice(0, 300) };
  state = { ...baseState, groups: { ...baseState.groups,
    smart: { ...baseState.groups.smart, [bucket.key]: bucket },
    sender: { ...baseState.groups.sender,
      ...senderGroup([{ ...bucket, members: addrs }]) } } };
  acct.smart_min = 2;
  try {
    await openSmart();
    openRow("Newsletters");
    // (the two fixture senders of the bucket are still in it)
    await screen.findByRole("tab", { name: `Senders (${N + 2})` });
    fireEvent.change(screen.getByPlaceholderText("Search senders…"),
      { target: { value: "rnd64" } });         // rnd64, rnd640..649
    const hits = addrs.filter((a) => a.includes("rnd64")).length;
    expect(hits).toBe(11);
    fireEvent.click(screen.getByRole("button", { name: `Select all ${hits} shown` }));
    fireEvent.click(screen.getByRole("button", { name: `Trash selected (${hits})` }));
    const dlg = await findDialog();
    expect(within(dlg).getByText(`${hits * 3} mails from ${hits} senders will be affected`))
      .toBeTruthy();
    await pressDialog(`Move to Trash (${hits * 3})`);
    await waitFor(() => expect(deleteGroups).toHaveBeenCalled());
    const [grouping, keys] = deleteGroups.mock.calls[0];
    expect(grouping).toBe("sender");
    expect(new Set(keys)).toEqual(new Set(addrs.filter((a) => a.includes("rnd64"))));
  } finally { acct.smart_min = 7; }
});

test("the sender list is German in the German UI", async () => {
  setLang("de");
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  fireEvent.click(await screen.findByRole("tab", { name: "Smart" }));
  await waitFor(() => expect(screen.getAllByText("Big Shop").length)
    .toBeGreaterThan(0));
  openRow("Newsletter");
  expect(await screen.findByRole("tab", { name: "Absender (2)" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Mails (20)" })).toBeTruthy();
  expect(screen.getAllByText("In seinen Mails steht nichts, worum es geht.")
    .length).toBe(2);
  fireEvent.click(screen.getByLabelText("promo@lone.example auswählen"));
  expect(screen.getByText("1 von 2 Absendern ausgewählt (3 Mails)")).toBeTruthy();
  expect(screen.getByPlaceholderText("Absender suchen…")).toBeTruthy();
});


test("protecting every sender of a pool closes its panel instead of leaving "
  + "it pointing at a row that is gone", async () => {
  const gone = { ...baseState, groups_rev: 2, groups: { ...baseState.groups,
    smart: Object.fromEntries(Object.entries(baseState.groups.smart)
      .filter(([k]) => k !== "k:newsletter")),
    sender: Object.fromEntries(Object.entries(baseState.groups.sender)
      .filter(([, g]) => g.smart_key !== "k:newsletter")) } };
  protectMany.mockImplementationOnce(async () => {
    state = gone;                                   // what the refresh returns
    return { protected: [] };
  });
  await openSmart();
  openRow("Newsletters");
  await screen.findByRole("tab", { name: "Senders (2)" });
  fireEvent.click(screen.getByRole("button", { name: "Select all 2 shown" }));
  pickAction("protect");
  await waitFor(() => expect(screen.queryByRole("tab", { name: /^Senders/ }))
    .toBeNull(), { timeout: 5000 });
  expect(groupMails).not.toHaveBeenCalledWith("smart", "k:newsletter");
  expect(screen.queryByText(/Senders with fewer than/)).toBeNull();
});


// ------------------------------------ Unsubscribe stays a per-sender action

const tickRow = (label: string) =>
  fireEvent.click(screen.getAllByLabelText(`Select ${label}`)[0]);
const unsubOption = () => screen.getAllByRole("combobox").flatMap((c) =>
  [...(c as HTMLSelectElement).options]).find((o) => o.value === "unsubscribe")!;

test("a selection unsubscribes only from own rows - pooled rows are skipped, "
  + "and the confirmation says so", async () => {
  await openSmart();
  tickRow("Big Shop");
  tickRow("Newsletters");
  tickRow("payco.example");
  expect(unsubOption().disabled).toBe(false);
  pickAction("unsubscribe");
  const dlg = await findDialog();
  expect(within(dlg).getByText("Unsubscribe from the senders of the selected group?"))
    .toBeTruthy();
  expect(within(dlg).getByText(
    "2 pooled rows are skipped: open one to unsubscribe from a single sender."))
    .toBeTruthy();
  await pressDialog("Unsubscribe");
  await waitFor(() => expect(unsubscribeBulk).toHaveBeenCalledTimes(1));
  // exactly the own row's key - never a pool's
  expect(unsubscribeBulk).toHaveBeenCalledWith("smart", ["s:big@shop.example"]);
});

test("with only pooled rows selected, Unsubscribe is not offered", async () => {
  await openSmart();
  tickRow("Newsletters");
  tickRow("Accounts & security");
  expect(unsubOption().disabled).toBe(true);
  pickAction("unsubscribe");               // even forced: nothing is sent
  await new Promise((r) => setTimeout(r, 50));
  expect(unsubscribeBulk).not.toHaveBeenCalled();
});

test("the pool itself offers no Unsubscribe, its senders' own detail does",
  async () => {
    await openSmart();
    openRow("Newsletters");
    await screen.findByRole("tab", { name: "Senders (2)" });
    expect(screen.queryByRole("button", { name: "Unsubscribe" })).toBeNull();
    expect(screen.queryAllByRole("option", { name: "Unsubscribe" }).filter(
      (o) => !(o as HTMLOptionElement).disabled)).toHaveLength(0);
  });


// ------------------------------------------------ AI sorting of "Other" (S4)

const otherRow = mk({ key: "k:other", label: "Other senders", count: 7,
  kind: "other", n_senders: 3, members: ["mystery@one.example"] });
const sortedOrders = senderRec("shop@mystery.example", "k:orders", {
  smart_why: { r: "ai", k: "orders" } });
const sortedOther = senderRec("unsure@mystery.example", "k:other", {
  smart_why: { r: "ai", k: "other" } });
const sureOther = senderRec("bill@mystery.example", "k:other", {
  smart_why: { r: "ai", k: "other", sure: true } });

const withOther = (extra: Group[] = []) => {
  state = { ...baseState, groups: { ...baseState.groups,
    smart: { ...baseState.groups.smart, [otherRow.key]: otherRow },
    sender: { ...baseState.groups.sender, ...senderGroup([otherRow]),
      ...Object.fromEntries(extra.map((g) => [g.key, g])) } } };
};
const sortButton = () => screen.queryByRole("button", { name: "Sort with AI" });
const estimate = (over: object = {}) => ({ units: 3, senders: 5,
  tokens_in: 12000, tokens_out: 84, cost: 0.0368, sorted: 0, checked: 0,
  blocked: "", available: true, has_instructions: false, ...over });

test("without an AI configured there is no AI sorting button at all", async () => {
  withOther();
  await openSmart();
  openRow("Other senders");
  await screen.findByRole("tab", { name: /^Senders/ });
  expect(sortButton()).toBeNull();
});

test("the sorting button appears only on the Other row, with an AI configured",
  async () => {
    cfg.ai.available = true;
    withOther();
    await openSmart();
    openRow("Other senders");
    expect(await screen.findByRole("button", { name: "Sort with AI" })).toBeTruthy();
    cleanup();
    await openSmart();
    openRow("Newsletters");
    await screen.findByRole("tab", { name: /^Senders/ });
    expect(sortButton()).toBeNull();
  });

test("it names scope, cost and what is sent before anything is sent",
  async () => {
    cfg.ai.available = true;
    localStorage.setItem("pmc_ai_ack", "1");
    aiSortEstimate.mockResolvedValue(estimate({ has_instructions: true }));
    withOther();
    await openSmart();
    openRow("Other senders");
    fireEvent.click(await screen.findByRole("button", { name: "Sort with AI" }));
    const dlg = await findDialog();
    expect(within(dlg).getByText("Sort the senders left in Other with AI?")).toBeTruthy();
    expect(within(dlg).getByText("5 senders (3 groups) the rules could not place"))
      .toBeTruthy();
    expect(within(dlg).getByText("About 12,000 tokens in, 84 out - roughly $0.0368"))
      .toBeTruthy();
    expect(within(dlg).getByText("Your own instructions from Settings are included"))
      .toBeTruthy();
    expect(within(dlg).getByText(/No mail is moved or deleted/)).toBeTruthy();
    expect(within(dlg).getByText(/never mail bodies or attachments/)).toBeTruthy();
    expect(aiSort).not.toHaveBeenCalled();                  // nothing yet
    await pressDialog("Cancel");
    expect(aiSort).not.toHaveBeenCalled();
  });

test("confirming starts the sorting once", async () => {
  cfg.ai.available = true;
  localStorage.setItem("pmc_ai_ack", "1");
  aiSortEstimate.mockResolvedValue(estimate());
  withOther();
  await openSmart();
  openRow("Other senders");
  fireEvent.click(await screen.findByRole("button", { name: "Sort with AI" }));
  await findDialog();
  await pressDialog("Sort 5 senders");
  await waitFor(() => expect(aiSort).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("AI sorting started.")).toBeTruthy();
});

test("the first AI use still asks for consent", async () => {
  cfg.ai.available = true;                                  // no pmc_ai_ack
  withOther();
  await openSmart();
  openRow("Other senders");
  fireEvent.click(await screen.findByRole("button", { name: "Sort with AI" }));
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("AI sorting of the Other row sends");
  await pressDialog("Cancel");
  expect(aiSortEstimate).not.toHaveBeenCalled();
});

test("nothing to sort says so instead of asking", async () => {
  cfg.ai.available = true;
  localStorage.setItem("pmc_ai_ack", "1");
  aiSortEstimate.mockResolvedValue(estimate({ units: 0, senders: 0 }));
  withOther();
  await openSmart();
  openRow("Other senders");
  fireEvent.click(await screen.findByRole("button", { name: "Sort with AI" }));
  expect(await screen.findByText(/Nothing left to sort/)).toBeTruthy();
  expect(aiSort).not.toHaveBeenCalled();
});

test("what the AI sorted says so, and can be removed again", async () => {
  cfg.ai.available = true;
  state = { ...baseState, groups: { ...baseState.groups,
    smart: { ...baseState.groups.smart, [otherRow.key]: { ...otherRow,
      members: ["unsure@mystery.example", "bill@mystery.example"] } },
    sender: { ...baseState.groups.sender, ...senderGroup([otherRow]),
      [sortedOrders.key]: sortedOrders, [sortedOther.key]: sortedOther,
      [sureOther.key]: sureOther } } };
  await openSmart();
  openRow("Other senders");
  await screen.findByRole("tab", { name: /^Senders/ });
  expect(screen.getByText("Checked by AI: the subjects do not make it clear.")).toBeTruthy();
  expect(screen.getByText("Checked by AI: belongs in Other.")).toBeTruthy();
  // one placed (orders), one looked at and left in Other
  expect(screen.getByText(/1 senders were sorted by AI\./)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove AI sorting" }));
  const dlg = await findDialog();
  expect(within(dlg).getByText("Remove the AI sorting of 3 senders?")).toBeTruthy();
  await pressDialog("Remove AI sorting");
  await waitFor(() => expect(aiSortClear).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(
    "AI sorting removed: 1 senders are back where the rules put them.")).toBeTruthy();
});

test("after the AI sorting is removed the open Other row offers the button again",
  async () => {
    cfg.ai.available = true;
    state = { ...baseState, groups: { ...baseState.groups,
      smart: { ...baseState.groups.smart, [otherRow.key]: { ...otherRow,
        members: ["unsure@mystery.example"] } },
      sender: { ...baseState.groups.sender, ...senderGroup([otherRow]),
        [sortedOrders.key]: sortedOrders, [sortedOther.key]: sortedOther } } };
    await openSmart();
    openRow("Other senders");
    await screen.findByRole("tab", { name: /^Senders/ });
    expect(sortButton()).toBeTruthy();
    aiSortClear.mockImplementationOnce(async () => {
      withOther([senderRec("shop@mystery.example", "k:other"),
        senderRec("unsure@mystery.example", "k:other")]);   // the rules' answer again
      state.groups.smart[otherRow.key] = { ...otherRow, count: 12 };   // it grew back
      return { cleared: 2 };
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove AI sorting" }));
    await findDialog();
    await pressDialog("Remove AI sorting");
    await waitFor(() => expect(aiSortClear).toHaveBeenCalledTimes(1));
    await screen.findByText(/AI sorting removed/);
    expect(await screen.findByRole("button", { name: "Sort with AI" })).toBeTruthy();
    // the open panel follows the live row (its header said 7 mails before)
    expect((await screen.findAllByText(/12 mails/)).length).toBeGreaterThan(1);
  });

test("removing the AI sorting from a placed row follows the senders back to Other",
  async () => {
    cfg.ai.available = true;
    const ordersRow = { ...orders, members: ["order@shop-a.example",
      sortedOrders.key] };
    state = { ...baseState, groups: { ...baseState.groups,
      smart: { ...baseState.groups.smart, [orders.key]: ordersRow,
        [otherRow.key]: { ...otherRow, members: ["unsure@mystery.example"] } },
      sender: { ...baseState.groups.sender, ...senderGroup([ordersRow]),
        ...senderGroup([otherRow]), [sortedOrders.key]: sortedOrders } } };
    await openSmart();
    openRow("Orders & deliveries");
    await screen.findByRole("tab", { name: /^Senders/ });
    expect(sortButton()).toBeNull();                 // the button lives in Other
    aiSortClear.mockImplementationOnce(async () => {
      state = { ...state, groups: { ...state.groups,
        smart: { ...state.groups.smart, [orders.key]: orders,
          [otherRow.key]: { ...otherRow, members: ["unsure@mystery.example",
            sortedOrders.key] } },
        sender: { ...state.groups.sender,
          [sortedOrders.key]: senderRec(sortedOrders.key, "k:other") } } };
      return { cleared: 1 };
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove AI sorting" }));
    await findDialog();
    await pressDialog("Remove AI sorting");
    await waitFor(() => expect(aiSortClear).toHaveBeenCalledTimes(1));
    // the panel moved on to where the senders went, with the button ready
    expect(await screen.findByRole("button", { name: "Sort with AI" })).toBeTruthy();
  });

test("when the AI could place nobody it says so, and the answers can be reset",
  async () => {
    cfg.ai.available = true;
    state = { ...baseState, groups: { ...baseState.groups,
      smart: { ...baseState.groups.smart, [otherRow.key]: { ...otherRow,
        members: ["unsure@mystery.example"] } },
      sender: { ...baseState.groups.sender, ...senderGroup([otherRow]),
        [sortedOther.key]: sortedOther } } };
    await openSmart();
    openRow("Other senders");
    await screen.findByRole("tab", { name: /^Senders/ });
    expect(screen.getByText(/The AI looked at 1 senders and left them in Other\./))
      .toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove AI sorting" }));
    await findDialog();
    await pressDialog("Remove AI sorting");
    expect(await screen.findByText("AI sorting removed.")).toBeTruthy();
  });

test("an exhausted monthly budget is reported instead of asking to confirm",
  async () => {
    cfg.ai.available = true;
    localStorage.setItem("pmc_ai_ack", "1");
    aiSortEstimate.mockResolvedValue(estimate({ blocked: "monthly AI budget reached" }));
    withOther();
    await openSmart();
    openRow("Other senders");
    fireEvent.click(await screen.findByRole("button", { name: "Sort with AI" }));
    expect(await screen.findByText(/monthly AI budget reached/)).toBeTruthy();
    await expectNoDialog();
    expect(aiSort).not.toHaveBeenCalled();
  });

test("a sender the AI placed says so on its card, in both languages", async () => {
  cfg.ai.available = true;
  const orders = mk({ key: "k:orders", label: "x", count: 3, kind: "orders",
    n_senders: 1, members: [] });
  state = { ...baseState, groups: { ...baseState.groups,
    smart: { ...baseState.groups.smart, [orders.key]: orders },
    sender: { ...baseState.groups.sender, [sortedOrders.key]: sortedOrders } } };
  await openSmart();
  openRow("Orders & deliveries");
  expect(await screen.findByText("Sorted by AI as orders and deliveries.")).toBeTruthy();
  cleanup();
  setLang("de");
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  fireEvent.click(await screen.findByRole("tab", { name: "Smart" }));
  await waitFor(() => expect(screen.getAllByText("Bestellungen & Lieferungen").length)
    .toBeGreaterThan(0));
  openRow("Bestellungen & Lieferungen");
  expect(await screen.findByText("Von der KI einsortiert als Bestellungen und Lieferungen."))
    .toBeTruthy();
});

test("the sorting button is German in the German UI", async () => {
  cfg.ai.available = true;
  setLang("de");
  withOther();
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  fireEvent.click(await screen.findByRole("tab", { name: "Smart" }));
  await waitFor(() => expect(screen.getAllByText("Sonstige Absender").length)
    .toBeGreaterThan(0));
  openRow("Sonstige Absender");
  expect(await screen.findByRole("button", { name: "Mit KI sortieren" })).toBeTruthy();
});
