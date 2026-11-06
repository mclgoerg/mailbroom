// @vitest-environment jsdom
/* The error line of the rule form shows what the server refused with in the
 * interface language (real api layer, stubbed fetch). */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { RulesModal } from "./components/RulesModal";
import { DialogProvider } from "./components/ui";
import { setLang, t } from "./i18n";
import type { AppState } from "./types";

const state: AppState = {
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

afterEach(() => {
  cleanup();
  setLang("en");
  vi.unstubAllGlobals();
});

const refuse = (detail: string) => vi.stubGlobal("fetch", vi.fn()
  .mockResolvedValue({ ok: false, status: 400,
    text: () => Promise.resolve(JSON.stringify({ detail })) }));

const submitPurgeRule = () => {
  render(<DialogProvider>
    <RulesModal state={state} onClose={() => {}} onChanged={() => {}} />
  </DialogProvider>);
  fireEvent.change(screen.getByLabelText(t("rule.f_scope")),
    { target: { value: "trash" } });
  fireEvent.change(screen.getByLabelText(t("rule.f_name")), { target: { value: "x" } });
  fireEvent.click(screen.getByText(t("rule.create")));
};

test("a refused filter reads in English", async () => {
  refuse("rule_purge_filter:names=tag%3A");
  submitPurgeRule();
  expect(await screen.findByText(
    "Error: This filter is not available for Junk and Trash rules: tag:"))
    .toBeTruthy();
});

test("a refused filter reads in German", async () => {
  setLang("de");
  refuse("rule_purge_filter:names=tag%3A");
  submitPurgeRule();
  await waitFor(() => expect(document.body.textContent).toContain(
    "Dieser Filter ist für Spam- und Papierkorb-Regeln nicht verfügbar: tag:"));
  expect(document.body.textContent).not.toContain("rule_purge_filter");
});

const submitMailRule = () => {
  render(<DialogProvider>
    <RulesModal state={state} onClose={() => {}} onChanged={() => {}} />
  </DialogProvider>);
  fireEvent.change(screen.getByLabelText(t("rule.f_name")), { target: { value: "x" } });
  fireEvent.change(screen.getByLabelText(t("rule.f_filter")),
    { target: { value: "age:>1yr" } });
  fireEvent.click(screen.getByText(t("rule.create")));
};

test("a filter with a mistyped part is shown next to the filter field", async () => {
  refuse("rule_filter_invalid:names=age%3A%3E1yr");
  submitMailRule();
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe(
    "This filter has parts Inboxrake doesn't understand: age:>1yr");
  expect((screen.getByLabelText(t("rule.f_filter")) as HTMLInputElement)
    .getAttribute("aria-invalid")).toBe("true");
});

test("German: the mistyped-filter error is translated", async () => {
  setLang("de");
  refuse("rule_filter_invalid:names=age%3A%3E1yr");
  submitMailRule();
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Dieser Filter enthält Teile, die Inboxrake nicht versteht: age:>1yr");
});

test("a saved rule with a mistyped filter shows a warning on its card", () => {
  render(<DialogProvider>
    <RulesModal state={{ ...state, rules: [{
      id: "r1", name: "old", scope: "mail", grouping: "sender",
      query: "age:>1yr", action: "trash", dest: "", schedule: "manual",
      mode: "execute", keep_latest: null, older_than_days: null,
      origin: "manual", report_runs: 1, created: 1, last_run: null,
      filter_invalid: ["age:>1yr"] } as any] }}
      onClose={() => {}} onChanged={() => {}} />
  </DialogProvider>);
  expect(document.body.textContent).toContain(
    "The filter has parts Inboxrake doesn't understand: age:>1yr");
});
