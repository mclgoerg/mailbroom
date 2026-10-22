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
