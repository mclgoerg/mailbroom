// @vitest-environment jsdom
/* Plain words -> filter (components/AiFilterPanel.tsx): the button needs an
 * AI provider, consent comes first, the result is an editable query with a
 * live preview computed by the list's own filter code, and Apply only sets
 * the filter - nothing is selected or acted on. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let state: any;
let cfg: any;

const aiFilter = vi.fn();
const createPreset = vi.fn().mockResolvedValue(
  { id: "p1", name: "Quiet shops", query: "", account: "proton" });

vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
    rules: () => Promise.resolve({ cap: 500, rules: [] }),
    aiFilter: (...a: unknown[]) => aiFilter(...a),
    createPreset: (...a: unknown[]) => createPreset(...a),
  },
  downloadFile: () => Promise.resolve(),
  setAccount: () => {},
  withAccount: (p: string) => p,
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
import { matchGroup, parseFilter } from "./lib";
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

const answer = (over: object = {}) => ({
  query: "tag:newsletter unread:>90 age:>1y", unsupported: [],
  explanation: "Old newsletters you never read.", cost: 0.0012, ...over,
});

beforeEach(() => {
  localStorage.setItem("pmc_account", "proton");
  cfg = mkCfg(true);
  state = baseState();
  aiFilter.mockReset();
  aiFilter.mockResolvedValue(answer());
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  setLang("en");
});

const mount = async () => {
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(screen.getAllByText("Weekly One").length)
    .toBeGreaterThan(0));
};

const openPanel = async () => {
  fireEvent.click(screen.getByLabelText("Describe a filter"));
  return screen.findByRole("dialog", { name: "Describe a filter" });
};

const sendSentence = async (text = "newsletters I never read") => {
  const dlg = await openPanel();
  fireEvent.change(within(dlg).getByLabelText(
    "Describe what you are looking for"), { target: { value: text } });
  fireEvent.click(within(dlg).getByRole("button", { name: "Send" }));
  return dlg;
};

test("the button is hidden without an AI provider", async () => {
  cfg = mkCfg(false);
  await mount();
  expect(screen.queryByLabelText("Describe a filter")).toBeNull();
});

test("the first send asks for consent; declining sends nothing", async () => {
  await mount();
  await sendSentence();
  await findDialog();
  await cancelDialog();
  await expectNoDialog();
  expect(aiFilter).not.toHaveBeenCalled();
  expect(localStorage.getItem("pmc_ai_ack")).toBeNull();
});

test("after consent: send, result, live preview that matches the list's " +
  "filter, Apply sets the filter and selects nothing", async () => {
  await mount();
  await sendSentence("newsletters I never read, older than a year");
  await pressDialog("Continue");
  const dlg = await screen.findByRole("dialog", { name: "Describe a filter" });
  await waitFor(() => expect(aiFilter).toHaveBeenCalledWith(
    "newsletters I never read, older than a year", "en"));
  const input = await within(dlg).findByDisplayValue(
    "tag:newsletter unread:>90 age:>1y") as HTMLInputElement;
  expect(within(dlg).getByText("Old newsletters you never read.")).toBeTruthy();

  // The preview is what matchGroup says over the loaded groups (protected
  // ones included, and counted separately).
  const f = parseFilter(input.value);
  const hits = GROUPS.filter((g) => matchGroup(g, f));
  expect(hits.map((g) => g.key)).toEqual(["n1@one.example", "n2@two.example"]);
  expect(within(dlg).getByText(/2 groups · 50 mails · 4\.8 MB/)).toBeTruthy();
  expect(within(dlg).getByText(/incl\. 1 protected/)).toBeTruthy();
  expect(within(dlg).getByText(/AI cost: \$0\.0012/)).toBeTruthy();

  // Editing the query updates the preview.
  fireEvent.change(input, { target: { value: "tag:newsletter age:>1y eng:high" } });
  expect(within(dlg).getByText("Nothing matches this filter.")).toBeTruthy();
  fireEvent.change(input, { target: { value: "tag:newsletter unread:>90 age:>1y" } });

  fireEvent.click(within(dlg).getByRole("button", { name: "Apply" }));
  const main = screen.getByPlaceholderText("filter groups…") as HTMLInputElement;
  expect(main.value).toBe("tag:newsletter unread:>90 age:>1y");
  expect(screen.queryByRole("dialog", { name: "Describe a filter" })).toBeNull();
  expect(screen.queryAllByText("Fresh Friend")).toHaveLength(0);   // list filtered
  expect(screen.queryAllByText("Weekly One").length).toBeGreaterThan(0);
  // nothing selected: no bulk bar
  expect(screen.queryByText(/^Trash \d+$/)).toBeNull();
  expect(screen.queryByText(/groups · .* mails$/)).toBeNull();
});

test("Apply uses the query as edited, not the AI's first answer", async () => {
  localStorage.setItem("pmc_ai_ack", "1");
  await mount();
  const dlg = await sendSentence();
  const input = await within(dlg).findByDisplayValue(
    "tag:newsletter unread:>90 age:>1y");
  fireEvent.change(input, { target: { value: "tag:newsletter age:>2y" } });
  fireEvent.click(within(dlg).getByRole("button", { name: "Apply" }));
  expect((screen.getByPlaceholderText("filter groups…") as HTMLInputElement)
    .value).toBe("tag:newsletter age:>2y");
});

test("a second send skips the consent once it was given", async () => {
  localStorage.setItem("pmc_ai_ack", "1");
  await mount();
  const dlg = await sendSentence();
  await within(dlg).findByDisplayValue("tag:newsletter unread:>90 age:>1y");
  await expectNoDialog();
});

test("unsupported parts are shown as a notice", async () => {
  localStorage.setItem("pmc_ai_ack", "1");
  aiFilter.mockResolvedValue(answer({ query: "tag:newsletter",
    unsupported: ["mails over 5 MB", "from last Tuesday"] }));
  await mount();
  const dlg = await sendSentence();
  expect(await within(dlg).findByText(
    "Not expressible: mails over 5 MB, from last Tuesday")).toBeTruthy();
});

test("Back returns to the sentence, which is kept", async () => {
  localStorage.setItem("pmc_ai_ack", "1");
  await mount();
  const dlg = await sendSentence("my sentence");
  await within(dlg).findByDisplayValue("tag:newsletter unread:>90 age:>1y");
  fireEvent.click(within(dlg).getByRole("button", { name: "Back" }));
  expect((within(dlg).getByLabelText("Describe what you are looking for") as
    HTMLTextAreaElement).value).toBe("my sentence");
});

test("the disclosure line and the 300-character cap are on the form", async () => {
  await mount();
  const dlg = await openPanel();
  expect(within(dlg).getByText(
    "Only this sentence and the filter syntax are sent to your AI provider - " +
    "no mail data.")).toBeTruthy();
  const ta = within(dlg).getByLabelText(
    "Describe what you are looking for") as HTMLTextAreaElement;
  expect(ta.maxLength).toBe(300);
  expect((within(dlg).getByRole("button", { name: "Send" }) as
    HTMLButtonElement).disabled).toBe(true);          // empty sentence
});

test("a coded backend error is shown in the user's words", async () => {
  localStorage.setItem("pmc_ai_ack", "1");
  aiFilter.mockRejectedValue(new Error("The monthly AI budget is used up."));
  await mount();
  const dlg = await sendSentence();
  expect(await within(dlg).findByText(/budget is used up/)).toBeTruthy();
  // still on the form, nothing applied
  expect((screen.getByPlaceholderText("filter groups…") as HTMLInputElement)
    .value).toBe("");
});

test("Save as preset names the preset and stores exactly this query",
  async () => {
    localStorage.setItem("pmc_ai_ack", "1");
    await mount();
    const dlg = await sendSentence();
    await within(dlg).findByDisplayValue("tag:newsletter unread:>90 age:>1y");
    fireEvent.click(within(dlg).getByRole("button", { name: "Save as preset" }));
    const prompt = await findDialog();
    fireEvent.change(within(prompt).getByRole("textbox"),
      { target: { value: "Quiet shops" } });
    await pressDialog("Save");
    await waitFor(() => expect(createPreset).toHaveBeenCalledWith(
      "Quiet shops", "tag:newsletter unread:>90 age:>1y"));
  });

test("Save as rule opens the rules form with the query filled in",
  async () => {
    localStorage.setItem("pmc_ai_ack", "1");
    await mount();
    const dlg = await sendSentence();
    await within(dlg).findByDisplayValue("tag:newsletter unread:>90 age:>1y");
    fireEvent.click(within(dlg).getByRole("button", { name: "Save as rule…" }));
    expect(screen.queryByRole("dialog", { name: "Describe a filter" })).toBeNull();
    expect(await screen.findByDisplayValue(
      "tag:newsletter unread:>90 age:>1y")).toBeTruthy();   // the rule form
    // the main filter was not touched
    expect((screen.getByPlaceholderText("filter groups…") as HTMLInputElement)
      .value).toBe("");
  });

test("German strings and the language are sent along", async () => {
  setLang("de");
  localStorage.setItem("pmc_ai_ack", "1");
  await mount();
  fireEvent.click(screen.getByLabelText("Filter beschreiben"));
  const dlg = await screen.findByRole("dialog", { name: "Filter beschreiben" });
  expect(within(dlg).getByText(/Nur dieser Satz und die Filter-Syntax/))
    .toBeTruthy();
  fireEvent.change(within(dlg).getByLabelText(
    "Beschreib, wonach du suchst"), { target: { value: "Satz" } });
  fireEvent.click(within(dlg).getByRole("button", { name: "Senden" }));
  await within(dlg).findByDisplayValue("tag:newsletter unread:>90 age:>1y");
  expect(aiFilter).toHaveBeenCalledWith("Satz", "de");
  expect(within(dlg).getByText(/2 Gruppen · 50 Mails/)).toBeTruthy();
  expect(within(dlg).getByText(/davon 1 geschützt/)).toBeTruthy();
  expect(within(dlg).getByRole("button", { name: "Anwenden" })).toBeTruthy();
});

test("without a scan the preview says so", async () => {
  localStorage.setItem("pmc_ai_ack", "1");
  state = { ...baseState(), status: "idle", groups: { sender: {}, smart: {},
    domain: {}, subject: {}, thread: {} } };
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  fireEvent.click(await screen.findByLabelText("Describe a filter"));
  const dlg = await screen.findByRole("dialog", { name: "Describe a filter" });
  fireEvent.change(within(dlg).getByLabelText(
    "Describe what you are looking for"), { target: { value: "x" } });
  fireEvent.click(within(dlg).getByRole("button", { name: "Send" }));
  expect(await within(dlg).findByText(/Scan your mailbox/)).toBeTruthy();
});
