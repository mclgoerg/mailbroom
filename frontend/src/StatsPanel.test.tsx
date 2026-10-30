// @vitest-environment jsdom
/* Statistics: "freed" is what permanent deletes freed (`purged_bytes`) and
 * is only shown from the version that added them on; the old move-based
 * `freed` of earlier months is history and never shown as freed space. */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { StatsPanel } from "./components/StatsPanel";
import { setLang } from "./i18n";

let actions: Record<string, object> = {};
vi.mock("./api", () => ({
  api: { stats: () => Promise.resolve({
    mails: 10, size: 1000, senders: 2, unread: 1, bulk: 1, replied_senders: 0,
    oldest: "2025-01-01", years: [], months: [], categories: [],
    top_domains: [], top_senders: [], scans: [], actions,
    ai: { rated: 0, groups: 0 }, ai_groups: { delete_safe: 0, review: 0,
      keep: 0, unrated: 0 },
    rated_mails: { delete_safe: 0, review: 0, keep: 0 } }) },
  fmtSize: (n: number) => `${n} B`,
}));

const thisMonth = new Date().toISOString().slice(0, 7);
afterEach(() => { cleanup(); setLang("en"); });

test("freed is shown from purged_bytes only; old months show no figure",
  async () => {
    actions = {
      "2026-01": { trash: 4, archive: 1, move: 0, mark_read: 0, freed: 9999 },
      [thisMonth]: { trash: 2, archive: 0, move: 0, mark_read: 0,
        freed: 7777, purge: 3, purged_bytes: 1234 },
    };
    render(<StatsPanel onClose={() => {}} />);
    await screen.findByText("moved to Trash this month: 2 mails");
    expect(screen.getByText(
      "permanently deleted this month: 3 mails · 1234 B freed")).toBeTruthy();
    // the old move-based figures are never presented as freed space
    expect(document.body.textContent).not.toContain("9999");
    expect(document.body.textContent).not.toContain("7777");
    expect(document.body.textContent).toContain(
      "4 moved to Trash · 1 archived · 0 moved · 0 marked read");
    expect(document.body.textContent).toContain(
      "2 moved to Trash · 0 archived · 0 moved · 0 marked read · 3 deleted "
      + "permanently (1234 B freed)");
    // the old month has no "freed" at all
    expect(document.body.textContent?.match(/freed\)/g)).toHaveLength(1);
  });

test("a month without permanent deletes shows no freed line", async () => {
  actions = { [thisMonth]: { trash: 5, archive: 0, move: 0, mark_read: 0,
    freed: 5000 } };
  render(<StatsPanel onClose={() => {}} />);
  await screen.findByText("moved to Trash this month: 5 mails");
  expect(document.body.textContent).not.toContain("freed");
});

test("German labels", async () => {
  setLang("de");
  actions = { [thisMonth]: { trash: 1, archive: 0, move: 0, mark_read: 0,
    freed: 0, purge: 1, purged_bytes: 20 } };
  render(<StatsPanel onClose={() => {}} />);
  await screen.findByText("diesen Monat in den Papierkorb verschoben: 1 Mail");
  expect(screen.getByText(
    "diesen Monat endgültig gelöscht: 1 Mail · 20 B frei")).toBeTruthy();
  expect(document.body.textContent).toContain("1 endgültig gelöscht (20 B frei)");
});

test("the header offers 'Your year in mail' when the host wires it", async () => {
  actions = {};
  const onWrapped = vi.fn();
  render(<StatsPanel onClose={() => {}} onWrapped={onWrapped} />);
  fireEvent.click(await screen.findByRole("button",
    { name: "Your year in mail" }));
  expect(onWrapped).toHaveBeenCalledTimes(1);
  cleanup();
  render(<StatsPanel onClose={() => {}} />);
  await screen.findByText("mails");
  expect(screen.queryByRole("button", { name: "Your year in mail" })).toBeNull();
});
