// @vitest-environment jsdom
/* Retention fields (keep_latest / older_than_days) on saved rules. */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { RulesModal } from "./components/RulesModal";
import { setLang } from "./i18n";
import type { AppState, Rule } from "./types";

const createRule = vi.fn().mockResolvedValue({});
const updateRule = vi.fn().mockResolvedValue({});

vi.mock("./api", () => ({
  api: { createRule: (body: unknown) => createRule(body),
         updateRule: (id: string, body: unknown) => updateRule(id, body) },
}));

const baseState: AppState = {
  account: "proton", status: "idle", scanned_ts: null, groups_rev: 0,
  progress: "", error: "", folders: [],
  groups: { sender: {}, domain: {}, subject: {} },
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
  setLang("en");
});

test("creating a rule with keep-latest sends the field, leaves the other " +
  "null", () => {
  render(<RulesModal state={baseState} onClose={() => {}}
    onChanged={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText("Rule name"),
    { target: { value: "My rule" } });
  fireEvent.change(screen.getByDisplayValue("All mails"),
    { target: { value: "keep_latest" } });
  fireEvent.change(screen.getByPlaceholderText("N"),
    { target: { value: "5" } });
  fireEvent.click(screen.getByText("Create (report mode)"));
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
