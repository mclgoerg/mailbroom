// @vitest-environment jsdom
/* Retention fields (keep_latest / older_than_days) on saved rules. */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { RulesModal } from "./components/RulesModal";
import { DialogProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
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
  groups: { sender: {}, domain: {}, subject: {}, thread: {} },
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
  id: "abc1", name: "Old shop mail", grouping: "sender", query: "",
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
