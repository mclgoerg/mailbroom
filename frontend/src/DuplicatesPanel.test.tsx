// @vitest-environment jsdom
/* Duplicates panel: MailRow rows per set, relevance-based toolbar, empty
 * state, select-all-but-newest and the ConfirmDialog flow. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DuplicatesPanel } from "./components/DuplicatesPanel";
import { DialogProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";

const duplicates = vi.fn();
const possibleDuplicates = vi.fn();
const duplicateVersions = vi.fn();
const deleteMessages = vi.fn();
const jobState = vi.fn();

vi.mock("./api", () => ({
  api: { duplicates: () => duplicates(),
    state: () => jobState(),
    possibleDuplicates: () => possibleDuplicates(),
    duplicateVersions: () => duplicateVersions(),
    deleteMessages: (...a: unknown[]) => deleteMessages(...a) },
  fmtSize: () => "1 KB",
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));

const mk = (uid: number, folder = "INBOX") => ({ uid, folder,
  date: "2026-01-02T10:30:00", ts: 1, subject: "Invoice", addr: "a@x.example",
  size: 10, seen: false, ai: null });

const show = () => render(<DialogProvider>
  <DuplicatesPanel onClose={() => {}} onDeleted={() => {}} />
</DialogProvider>);

test("a queued deletion keeps candidates visible and reconciles a failed job", async () => {
  const sets = [{ wasted: 10, mails: [mk(3), mk(1)] }];
  duplicates.mockResolvedValue(sets);
  deleteMessages.mockResolvedValue({ ok: true, queued: 1 });
  jobState.mockResolvedValue({ delete: { status: "error", error: "move refused" } });
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Select all but newest" }));
  fireEvent.click(screen.getByRole("button", { name: "Trash selected (1)" }));
  await pressDialog(/Move to Trash \(1\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalled());
  expect(screen.getAllByRole("checkbox", { name: /Invoice/ })).toHaveLength(2);
  await waitFor(() => expect(screen.getByText(/move refused/)).toBeTruthy(), { timeout: 2500 });
  expect(screen.getAllByRole("checkbox", { name: /Invoice/ })).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Select all but newest" }).hasAttribute("disabled")).toBe(false);
});

beforeEach(() => {
  possibleDuplicates.mockResolvedValue([]);
  duplicateVersions.mockResolvedValue([]);
  duplicates.mockResolvedValue([]);
  jobState.mockResolvedValue({ delete: { status: "running", error: "" } });
});

afterEach(() => {
  cleanup();
  duplicates.mockReset().mockResolvedValue([]);
  possibleDuplicates.mockReset().mockResolvedValue([]);
  duplicateVersions.mockReset().mockResolvedValue([]);
  deleteMessages.mockReset();
  setLang("en");
});

test("no duplicates: empty state and no selection actions", async () => {
  duplicates.mockResolvedValue([]);
  show();
  await screen.findByText("No duplicates found");
  expect(screen.getByText(/no possible double-sends/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Select all but newest/ }))
    .toBeNull();
  expect(screen.queryByRole("button", { name: /Trash selected/ })).toBeNull();
});

test("select-all-but-newest then confirm trashes only the older copies; "
  + "cancel does nothing", async () => {
  duplicates.mockResolvedValue([{ wasted: 10,
    mails: [mk(3), mk(2, "Archive"), mk(1)] }]);
  show();
  await screen.findAllByText("Invoice");
  expect(screen.getByText("1 KB · Archive")).toBeTruthy();   // size before folder
  expect(screen.getAllByText("2 Jan, 10:30")[0].getAttribute("title"))
    .toBe("2026-01-02T10:30:00");
  expect(screen.getAllByText("unread")).toHaveLength(3);
  expect(screen.getByText("newest")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Trash selected/ })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Select all but newest" }));
  fireEvent.click(screen.getByRole("button", { name: "Trash selected (2)" }));
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("Move to Trash");
  expect(dlg.textContent).toContain("2 selected mails");
  await cancelDialog();
  await expectNoDialog();
  expect(deleteMessages).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Trash selected (2)" }));
  await pressDialog(/Move to Trash \(2\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
    [["Archive", 2], ["INBOX", 1]], "trash"));
});


const poss = (uid: number) => ({ ...mk(uid), subject: "Offer", addr: "b@y.example" });

test("possible duplicates: own section, never selected by select-all-but-newest, "
  + "but checkable and trashable", async () => {
  duplicates.mockResolvedValue([{ wasted: 10, mails: [mk(3), mk(1)] }]);
  possibleDuplicates.mockResolvedValue([{ wasted: 10,
    mails: [poss(8), poss(7)] }]);
  show();
  await screen.findByText(/Possible duplicates/);
  expect(screen.getByText(/different Message-IDs - they may differ/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Select all but newest" }));
  expect(screen.getByRole("button", { name: "Trash selected (1)" })).toBeTruthy();
  fireEvent.click(screen.getAllByRole("checkbox", { name: /Offer/ })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Trash selected (2)" }));
  await pressDialog(/Move to Trash \(2\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
    [["INBOX", 1], ["INBOX", 8]], "trash"));
});

test("select-all-but-newest keeps manual picks in the other sections and "
  + "unticks a ticked newest copy", async () => {
  const ver = (uid: number, size: number) =>
    ({ ...mk(uid), subject: "Report", addr: "c@z.example", size });
  duplicates.mockResolvedValue([{ wasted: 10, mails: [mk(3), mk(1)] }]);
  duplicateVersions.mockResolvedValue([{ wasted: 0,
    mails: [ver(5, 10), ver(4, 20)] }]);
  possibleDuplicates.mockResolvedValue([{ wasted: 10,
    mails: [poss(8), poss(7)] }]);
  show();
  await screen.findByText(/Possible duplicates/);
  fireEvent.click(screen.getAllByRole("checkbox", { name: /Invoice/ })[0]);
  fireEvent.click(screen.getAllByRole("checkbox", { name: /Report/ })[0]);
  fireEvent.click(screen.getAllByRole("checkbox", { name: /Offer/ })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Select all but newest" }));
  fireEvent.click(screen.getByRole("button", { name: "Trash selected (3)" }));
  await pressDialog(/Move to Trash \(3\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
    [["INBOX", 1], ["INBOX", 5], ["INBOX", 8]], "trash"));
});

test("only possible duplicates: no empty state, no select-all button",
  async () => {
    duplicates.mockResolvedValue([]);
    possibleDuplicates.mockResolvedValue([{ wasted: 10,
      mails: [poss(8), poss(7)] }]);
    show();
    await screen.findByText(/Possible duplicates/);
    expect(screen.queryByText("No duplicates found")).toBeNull();
    expect(screen.queryByRole("button", { name: /Select all but newest/ }))
      .toBeNull();
  });

test("the possible section is hidden when empty and worded in German", async () => {
  duplicates.mockResolvedValue([{ wasted: 10, mails: [mk(3), mk(1)] }]);
  show();
  await screen.findAllByText("Invoice");
  expect(screen.queryByText(/Possible duplicates/)).toBeNull();
  cleanup();
  setLang("de");
  possibleDuplicates.mockResolvedValue([{ wasted: 10,
    mails: [poss(8), poss(7)] }]);
  show();
  await screen.findByText(/Mögliche Duplikate/);
});


const ver = (uid: number, size: number, folder = "INBOX") =>
  ({ ...mk(uid, folder), subject: "Report", size });

const verSet = () => ({ wasted: 0, mails: [ver(6, 100), ver(5, 900, "Archive")] });

test("three headed sections, each with an explanation", async () => {
  duplicates.mockResolvedValue([{ wasted: 10, mails: [mk(3), mk(1)] }]);
  duplicateVersions.mockResolvedValue([verSet()]);
  possibleDuplicates.mockResolvedValue([{ wasted: 10, mails: [poss(8), poss(7)] }]);
  show();
  await screen.findByText("Identical copies");
  expect(screen.getByText(/Same Message-ID and the same size/)).toBeTruthy();
  expect(screen.getByText("Same mail, different versions")).toBeTruthy();
  expect(screen.getByText(/the copies differ in size/)).toBeTruthy();
  expect(screen.getByText(/Same sender and subject, sent within minutes/)).toBeTruthy();
  expect(screen.getByText("Possible duplicates")).toBeTruthy();
  // only the identical section is "reclaimable"; versions tag the largest
  expect(screen.getAllByText(/reclaimable/)).toHaveLength(2);   // header + set
  expect(screen.getByText("largest")).toBeTruthy();
  expect(screen.getAllByText("newest")).toHaveLength(1);
});

test("select-all-but-newest selects only identical sets, never versions", async () => {
  duplicates.mockResolvedValue([{ wasted: 10, mails: [mk(3), mk(1)] }]);
  duplicateVersions.mockResolvedValue([verSet()]);
  show();
  await screen.findByText("Same mail, different versions");
  fireEvent.click(screen.getByRole("button", { name: "Select all but newest" }));
  expect(screen.getByRole("button", { name: "Trash selected (1)" })).toBeTruthy();
  screen.getAllByRole("checkbox", { name: /Report/ }).forEach((c) =>
    expect((c as HTMLInputElement).checked).toBe(false));
});

test("only versions: no select-all button, no empty state; a manually "
  + "ticked versions row is trashed", async () => {
  duplicateVersions.mockResolvedValue([verSet()]);
  show();
  await screen.findByText("Same mail, different versions");
  expect(screen.queryByText("No duplicates found")).toBeNull();
  expect(screen.queryByRole("button", { name: /Select all but newest/ })).toBeNull();
  fireEvent.click(screen.getAllByRole("checkbox", { name: /Report/ })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Trash selected (1)" }));
  await pressDialog(/Move to Trash \(1\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
    [["INBOX", 6]], "trash"));
});

test("a failing versions fetch keeps the identical list", async () => {
  duplicates.mockResolvedValue([{ wasted: 10, mails: [mk(3), mk(1)] }]);
  duplicateVersions.mockRejectedValue(new Error("boom"));
  show();
  await screen.findByText("Identical copies");
  expect(screen.getAllByText("Invoice")).toHaveLength(2);
  expect(screen.queryByText("Same mail, different versions")).toBeNull();
});

test("the version sections are worded in German", async () => {
  setLang("de");
  duplicateVersions.mockResolvedValue([verSet()]);
  show();
  await screen.findByText("Dieselbe Mail, verschiedene Versionen");
  expect(screen.getByText("größte")).toBeTruthy();
});

test("a tie for the largest copy tags none", async () => {
  duplicateVersions.mockResolvedValue([{ wasted: 0,
    mails: [ver(6, 500), ver(5, 500, "Archive")] }]);
  show();
  await screen.findByText("Same mail, different versions");
  expect(screen.queryByText("largest")).toBeNull();
});

test("after a trash run all lists refresh, even if versions fails", async () => {
  duplicates.mockResolvedValueOnce([{ wasted: 10, mails: [mk(3), mk(1)] }])
    .mockResolvedValue([]);
  duplicateVersions.mockResolvedValueOnce([verSet()])
    .mockRejectedValue(new Error("boom"));
  deleteMessages.mockResolvedValue({ ok: true, queued: 1 });
  jobState.mockResolvedValue({ delete: { status: "done", error: "" } });
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Select all but newest" }));
  fireEvent.click(screen.getByRole("button", { name: "Trash selected (1)" }));
  await pressDialog(/Move to Trash \(1\)/);
  await screen.findByText("No duplicates found", {}, { timeout: 2500 });
  expect(screen.queryByRole("button", { name: /Trash selected/ })).toBeNull();
});

test("after a trash run the versions list shows the new data", async () => {
  duplicates.mockResolvedValue([{ wasted: 10, mails: [mk(3), mk(1)] }]);
  duplicateVersions.mockResolvedValueOnce([verSet()]).mockResolvedValue([
    { wasted: 0, mails: [{ ...ver(8, 100), subject: "Fresh" },
      { ...ver(7, 300), subject: "Fresh" }] }]);
  deleteMessages.mockResolvedValue({ ok: true, queued: 1 });
  jobState.mockResolvedValue({ delete: { status: "done", error: "" } });
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Select all but newest" }));
  fireEvent.click(screen.getByRole("button", { name: "Trash selected (1)" }));
  await pressDialog(/Move to Trash \(1\)/);
  await screen.findAllByText("Fresh", {}, { timeout: 2500 });
  expect(screen.queryByText("Report")).toBeNull();
});
