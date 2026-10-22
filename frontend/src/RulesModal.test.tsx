// @vitest-environment jsdom
/* Retention fields (keep_latest / older_than_days) on saved rules. */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { RulesModal } from "./components/RulesModal";
import { DialogProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
import { EN } from "./locales/en";
import type { AppState, Rule } from "./types";

const createRule = vi.fn().mockResolvedValue({});
const updateRule = vi.fn().mockResolvedValue({});
const deleteRule = vi.fn().mockResolvedValue({});
const runRule = vi.fn().mockResolvedValue({});

vi.mock("./api", () => ({
  api: { createRule: (body: unknown) => createRule(body),
         updateRule: (id: string, body: unknown) => updateRule(id, body),
         deleteRule: (id: string) => deleteRule(id),
         runRule: (id: string) => runRule(id) },
}));

const baseState: AppState = {
  account: "proton", status: "idle", scanned_ts: null, groups_rev: 0,
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

const rule: Rule = {
  id: "abc1", name: "Old shop mail", scope: "mail", grouping: "sender", query: "",
  action: "trash", dest: "", schedule: "manual", mode: "report",
  keep_latest: null, older_than_days: 30, origin: "manual", report_runs: 1,
  created: 0, last_run: null,
};

afterEach(() => {
  cleanup();
  createRule.mockClear();
  updateRule.mockClear();
  deleteRule.mockClear();
  runRule.mockClear();
  setLang("en");
});

test("creating a rule with keep-latest sends the field, leaves the other " +
  "null", () => {
  render(<RulesModal state={baseState} onClose={() => {}}
    onChanged={() => {}} />);
  fireEvent.change(screen.getByLabelText("Name"),
    { target: { value: "My rule" } });
  fireEvent.change(screen.getByLabelText("Apply to"),
    { target: { value: "keep_latest" } });
  fireEvent.change(screen.getByPlaceholderText("N"),
    { target: { value: "5" } });
  fireEvent.click(screen.getByText("Create rule (report only)"));
  expect(createRule).toHaveBeenCalledWith(expect.objectContaining(
    { keep_latest: 5, older_than_days: null }));
});

test("editing a rule prefills the retention selector and shows its tag",
  () => {
    render(<RulesModal state={{ ...baseState, rules: [rule] }}
      onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByText("older than 30d")).toBeTruthy();
    fireEvent.click(screen.getByText("Edit"));
    expect(screen.getByDisplayValue("Only mails older than N days"))
      .toBeTruthy();
    expect(screen.getByDisplayValue("30")).toBeTruthy();
  });

const grp = (key: string, count: number, pinned: number) => ({
  key, label: key, sub: "", count, size: 0, unread: 0, first: "2024-01-01",
  last: "2025-01-01", tags: [], samples: [], bulk: false, unsub: false,
  ai: null, ratings: null, protected: false, replied: false, att_size: 0,
  unsubscribed: null, new: false, pinned, engagement: 50,
});

test("the live match count leaves pinned mails out (mark_read excepted)",
  () => {
  const state = { ...baseState, groups: { ...baseState.groups,
    sender: { a: grp("a", 10, 3), b: grp("b", 5, 0) } } };
  render(<RulesModal state={state} onClose={() => {}}
    onChanged={() => {}} />);
  expect(screen.getByText(/currently matches 2 groups · 12 mails/))
    .toBeTruthy();
  fireEvent.change(screen.getByDisplayValue("Move to Trash"),
    { target: { value: "mark_read" } });
  expect(screen.getByText(/currently matches 2 groups · 15 mails/))
    .toBeTruthy();
});

test("a run summary names the protected mails it skipped", () => {
  const ran: Rule = { ...rule, last_run: {
    ts: 1, mode: "report", groups: 1, mails: 4, acted: 0, capped: 0,
    skipped_protected: 0, skipped_pinned: 3, preview: [], error: "" } };
  render(<RulesModal state={{ ...baseState, rules: [ran] }}
    onClose={() => {}} onChanged={() => {}} />);
  expect(screen.getByText(/3 protected mails skipped/)).toBeTruthy();
});

test("every field of the new-rule form has a label", () => {
  render(<RulesModal state={baseState} onClose={() => {}}
    onChanged={() => {}} />);
  for (const label of ["Name", "Grouping", "Filter", "Action", "Schedule",
    "Apply to"]) {
    expect(screen.getByLabelText(label)).toBeTruthy();
  }
});

const renderCards = (rules: Rule[], onChanged = () => {}) =>
  render(<DialogProvider>
    <RulesModal state={{ ...baseState, rules }} onClose={() => {}}
      onChanged={onChanged} />
  </DialogProvider>);

test("card actions: Run now, Edit, Enable execute, then Delete last",
  () => {
  renderCards([rule]);
  const names = screen.getAllByRole("button")
    .map((b) => b.textContent?.trim())
    .filter((x) => ["Run now", "Edit", "Enable execute", "Delete"].includes(x!));
  expect(names).toEqual(["Run now", "Edit", "Enable execute", "Delete"]);
  expect(screen.getByText("Delete").className).toContain("text-danger-fg");
  expect(screen.getByText("Enable execute").className).not.toContain("bg-danger");
});

test("Delete asks first, then deletes the rule", async () => {
  const onChanged = vi.fn();
  renderCards([rule], onChanged);
  fireEvent.click(screen.getByText("Delete"));
  expect((await findDialog()).textContent).toContain("Old shop mail");
  expect(deleteRule).not.toHaveBeenCalled();
  await pressDialog("Delete");
  await waitFor(() => expect(deleteRule).toHaveBeenCalledWith("abc1"));
  expect(onChanged).toHaveBeenCalled();
});

test("cancelling Delete keeps the rule", async () => {
  renderCards([rule]);
  fireEvent.click(screen.getByText("Delete"));
  await cancelDialog();
  await expectNoDialog();
  expect(deleteRule).not.toHaveBeenCalled();
});

test("Enable execute asks first, then switches the rule to execute",
  async () => {
  renderCards([rule]);
  fireEvent.click(screen.getByText("Enable execute"));
  expect((await findDialog()).textContent).toContain("cap 500 per run");
  expect(updateRule).not.toHaveBeenCalled();
  await pressDialog("Enable execute");
  await waitFor(() => expect(updateRule)
    .toHaveBeenCalledWith("abc1", { mode: "execute" }));
});

test("cancelling Enable execute leaves the rule in report mode", async () => {
  renderCards([rule]);
  fireEvent.click(screen.getByText("Enable execute"));
  await cancelDialog();
  await expectNoDialog();
  expect(updateRule).not.toHaveBeenCalled();
});

test("Run now on an execute-mode rule confirms; report mode runs directly",
  async () => {
  const exec: Rule = { ...rule, mode: "execute" };
  const { unmount } = renderCards([exec]);
  fireEvent.click(screen.getByText("Run now"));
  await cancelDialog();
  await expectNoDialog();
  expect(runRule).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Run now"));
  await pressDialog("Run now");
  await waitFor(() => expect(runRule).toHaveBeenCalledWith("abc1"));
  unmount();
  runRule.mockClear();
  renderCards([rule]);
  fireEvent.click(screen.getByText("Run now"));
  await waitFor(() => expect(runRule).toHaveBeenCalledWith("abc1"));
});

// ------------------------------------------------ purge rules (Junk / Trash)

const purgeRule: Rule = {
  ...rule, id: "pg1", name: "Old junk", scope: "junk", action: "purge",
  schedule: "weekly", older_than_days: 30, report_runs: 1,
};

const pickScope = (value: string) =>
  fireEvent.change(screen.getByLabelText("Folder"), { target: { value } });

test("the Folder select offers Inbox & folders, Junk and Trash", () => {
  render(<RulesModal state={baseState} onClose={() => {}}
    onChanged={() => {}} />);
  const sel = screen.getByLabelText("Folder") as HTMLSelectElement;
  expect([...sel.options].map((o) => [o.value, o.textContent]))
    .toEqual([["mail", "Inbox & folders"], ["junk", "Junk"],
      ["trash", "Trash"]]);
  expect(sel.value).toBe("mail");
  expect(screen.queryByText(/on the server, permanently/)).toBeNull();
});

test("choosing Junk fixes the action, shows the warning and offers the " +
  "defaults: older than 30 days, weekly", () => {
  render(<RulesModal state={baseState} onClose={() => {}}
    onChanged={() => {}} />);
  pickScope("junk");
  expect(screen.getByText(/Deletes mail on the server, permanently/))
    .toBeTruthy();
  const action = screen.getByLabelText("Action") as HTMLSelectElement;
  expect(action.disabled).toBe(true);
  expect([...action.options].map((o) => o.textContent))
    .toEqual(["Delete permanently"]);
  expect(screen.getByLabelText("Received more than this many days ago"))
    .toHaveProperty("value", "30");
  expect(screen.getByLabelText("Schedule")).toHaveProperty("value", "weekly");
  expect(screen.queryByLabelText("Grouping")).toBeNull();
  expect(screen.queryByLabelText("Apply to")).toBeNull();
  // the filter stays the Input + the query builder
  expect(screen.getByLabelText("Filter")).toBeTruthy();
  expect(screen.getByRole("button", { name: /filter builder|Build/i })
    ).toBeTruthy();
  expect(screen.getByText("Create rule (report only)")).toBeTruthy();
});

test("a new purge rule is sent as purge on the chosen folder, 30 days " +
  "unless changed; the server forces report mode", () => {
  render(<RulesModal state={baseState} onClose={() => {}}
    onChanged={() => {}} />);
  pickScope("trash");
  fireEvent.change(screen.getByLabelText("Name"),
    { target: { value: "Weekly purge" } });
  fireEvent.click(screen.getByText("Create rule (report only)"));
  expect(createRule).toHaveBeenCalledWith(expect.objectContaining({
    name: "Weekly purge", scope: "trash", action: "purge",
    grouping: "sender", older_than_days: 30, keep_latest: null,
    schedule: "weekly", dest: "" }));
  expect(createRule.mock.calls[0][0]).not.toHaveProperty("mode");
});

test("a purge rule needs a whole number of days", () => {
  render(<RulesModal state={baseState} onClose={() => {}}
    onChanged={() => {}} />);
  pickScope("junk");
  fireEvent.change(screen.getByLabelText("Name"),
    { target: { value: "x" } });
  fireEvent.change(screen.getByLabelText("Received more than this many days ago"),
    { target: { value: "0" } });
  fireEvent.click(screen.getByText("Create rule (report only)"));
  expect(createRule).not.toHaveBeenCalled();
  expect(screen.getByText(/whole number of days/)).toBeTruthy();
});

test("switching back to Inbox & folders restores an ordinary rule form", () => {
  render(<RulesModal state={baseState} onClose={() => {}}
    onChanged={() => {}} />);
  pickScope("junk");
  pickScope("mail");
  expect(screen.queryByText(/on the server, permanently/)).toBeNull();
  expect((screen.getByLabelText("Action") as HTMLSelectElement).value)
    .toBe("trash");
  expect(screen.getByLabelText("Schedule")).toHaveProperty("value", "manual");
  expect(screen.getByLabelText("Apply to")).toHaveProperty("value", "none");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "m" } });
  fireEvent.click(screen.getByText("Create rule (report only)"));
  expect(createRule).toHaveBeenCalledWith(expect.objectContaining(
    { scope: "mail", action: "trash", older_than_days: null }));
});

test("the query builder of a purge rule only offers sender conditions",
  () => {
  render(<RulesModal state={baseState} onClose={() => {}}
    onChanged={() => {}} />);
  pickScope("trash");
  const trigger = screen.getAllByRole("button")
    .find((b) => b.getAttribute("aria-expanded") !== null)!;
  fireEvent.click(trigger);
  expect(screen.getByText(EN["qb.age"])).toBeTruthy();
  expect(screen.getByText(EN["qb.unread"])).toBeTruthy();
  for (const k of ["qb.tag", "qb.ai", "qb.att", "qb.flags"]) {
    expect(screen.queryByText(EN[k]), k).toBeNull();
  }
  expect(screen.queryByText(EN["qb.is_protected"])).toBeNull();
});

test("a purge rule card shows folder, action, mode and a sender-level " +
  "preview", () => {
  const ran: Rule = { ...purgeRule, last_run: {
    ts: 1, mode: "report", groups: 2, mails: 5, acted: 0, capped: 0,
    skipped_protected: 1, skipped_pinned: 2, error: "", preview: [
      { key: "a@gone.example", label: "Anna", count: 3 },
      { key: "b@gone.example", label: "b@gone.example", count: 2 }] } };
  renderCards([ran]);
  const tags = [...document.querySelectorAll("span")].map((e) => e.textContent);
  expect(tags).toContain("Junk");           // the folder tag (not the option)
  expect(screen.getByText("Delete permanently")).toBeTruthy();
  expect(screen.getByText("report")).toBeTruthy();
  expect(screen.getByText(/5 mails would be deleted permanently \(2 senders\)/))
    .toBeTruthy();
  expect(screen.getByText(/Anna \(3\) · b@gone.example \(2\)/)).toBeTruthy();
  expect(screen.getByText(/2 protected mails skipped/)).toBeTruthy();
  expect(screen.getByText(/1 protected skipped/)).toBeTruthy();
});

test("in report mode Run report is the primary button", async () => {
  renderCards([purgeRule]);
  const btn = screen.getByText("Run report");
  expect(btn.className).toContain("bg-accent");
  fireEvent.click(btn);
  await waitFor(() => expect(runRule).toHaveBeenCalledWith("pg1"));
});

test("Enable execute on a purge rule opens a danger dialog with the " +
  "permanent wording and only then switches", async () => {
  renderCards([purgeRule]);
  fireEvent.click(screen.getByText("Enable execute"));
  const dlg = (await findDialog()).textContent ?? "";
  expect(dlg).toContain("permanently");
  expect(dlg).toContain("on the server");
  expect(dlg).toContain("500 mails per run");
  expect(dlg).toContain("Protected senders and protected mails are never touched");
  expect(dlg).toContain("switch back to report mode");
  expect(updateRule).not.toHaveBeenCalled();
  await pressDialog("Enable execute");
  await waitFor(() => expect(updateRule)
    .toHaveBeenCalledWith("pg1", { mode: "execute" }));
});

test("cancelling the purge confirm leaves the rule in report mode",
  async () => {
  renderCards([purgeRule]);
  fireEvent.click(screen.getByText("Enable execute"));
  await cancelDialog();
  await expectNoDialog();
  expect(updateRule).not.toHaveBeenCalled();
});

test("a purge rule without a report run cannot be switched to execute",
  () => {
  renderCards([{ ...purgeRule, report_runs: 0 }]);
  expect((screen.getByText("Enable execute").closest("button")!).disabled)
    .toBe(true);
});

test("Run on an execute-mode purge rule confirms with the permanent wording",
  async () => {
  renderCards([{ ...purgeRule, mode: "execute" }]);
  fireEvent.click(screen.getByText("Run now"));
  const dlg = (await findDialog()).textContent ?? "";
  expect(dlg).toContain("permanently, on the server");
  expect(runRule).not.toHaveBeenCalled();
  await pressDialog("Run now");
  await waitFor(() => expect(runRule).toHaveBeenCalledWith("pg1"));
});

test("going back to report mode needs no confirmation", async () => {
  renderCards([{ ...purgeRule, mode: "execute" }]);
  fireEvent.click(screen.getByText("Back to report mode"));
  await waitFor(() => expect(updateRule)
    .toHaveBeenCalledWith("pg1", { mode: "report" }));
});

test("editing an execute-mode purge rule says it goes back to report mode",
  () => {
  renderCards([{ ...purgeRule, mode: "execute" }]);
  fireEvent.click(screen.getByText("Edit"));
  expect(screen.getByText(/switches this rule back to report mode/))
    .toBeTruthy();
  expect(screen.getByLabelText("Folder")).toHaveProperty("value", "junk");
  expect(screen.getByLabelText("Received more than this many days ago"))
    .toHaveProperty("value", "30");
  fireEvent.click(screen.getByText("Save"));
  expect(updateRule).toHaveBeenCalledWith("pg1", expect.objectContaining(
    { scope: "junk", action: "purge", older_than_days: 30 }));
});

test("a purge run's unverified mails are named", () => {
  renderCards([{ ...purgeRule, last_run: {
    ts: 1, mode: "execute", groups: 1, mails: 2, acted: 1, capped: 0,
    skipped_protected: 0, skipped_pinned: 0, preview: [], error: "",
    unverified: 1 } }]);
  expect(screen.getByText(/1 mail moved to Trash but not deleted/))
    .toBeTruthy();
  expect(screen.getByText(/executed: 1 mail deleted permanently/))
    .toBeTruthy();
});

test("German: folder select, warning, defaults and the confirm", async () => {
  setLang("de");
  renderCards([purgeRule]);
  expect(screen.getByLabelText("Ordner")).toBeTruthy();
  expect(screen.getByText("Endgültig löschen")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Ordner"), { target: { value: "trash" } });
  expect(screen.getByText(/Löscht Mails auf dem Server, endgültig/))
    .toBeTruthy();
  expect(screen.getByLabelText("Vor mehr als so vielen Tagen empfangen"))
    .toHaveProperty("value", "30");
  expect((screen.getByLabelText("Aktion") as HTMLSelectElement).disabled)
    .toBe(true);
  fireEvent.click(screen.getByText("Ausführen aktivieren"));
  const dlg = (await findDialog()).textContent ?? "";
  expect(dlg).toContain("endgültig");
  expect(dlg).toContain("auf dem Server");
  expect(dlg).toContain("500");
  expect(dlg).toContain("Berichtsmodus");
});

test("every purge-rule string exists in English and German with _one forms",
  async () => {
  const { EN } = await import("./locales/en");
  const { DE } = await import("./locales/de");
  const keys = Object.keys(EN).filter((k) => /^rule\.purge_|^action\.purge$|^rule\.(f_scope|scope_mail|run_report_btn)$/
    .test(k));
  expect(keys.length).toBeGreaterThan(10);
  for (const k of keys) expect(DE[k], k).toBeTruthy();
  for (const base of ["rule.purge_run_report", "rule.purge_run_exec",
    "rule.purge_unverified"]) {
    expect(EN[`${base}_one`], base).toBeTruthy();
    expect(DE[`${base}_one`], base).toBeTruthy();
  }
});
