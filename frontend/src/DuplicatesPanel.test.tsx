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
const deleteMessages = vi.fn();

vi.mock("./api", () => ({
  api: { duplicates: () => duplicates(),
    possibleDuplicates: () => possibleDuplicates(),
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

beforeEach(() => { possibleDuplicates.mockResolvedValue([]); });

afterEach(() => {
  cleanup();
  duplicates.mockReset();
  possibleDuplicates.mockReset().mockResolvedValue([]);
  deleteMessages.mockReset();
  setLang("en");
});

test("no duplicates: empty state and no selection actions", async () => {
  duplicates.mockResolvedValue([]);
  show();
  await screen.findByText("No duplicates found");
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
  await screen.findByText(/Possible duplicates - same sender and subject/);
  expect(screen.getByText(/different Message-IDs and may differ/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Select all but newest" }));
  expect(screen.getByRole("button", { name: "Trash selected (1)" })).toBeTruthy();
  fireEvent.click(screen.getAllByRole("checkbox", { name: /Offer/ })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Trash selected (2)" }));
  await pressDialog(/Move to Trash \(2\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
    [["INBOX", 1], ["INBOX", 8]], "trash"));
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
  await screen.findByText(/Mögliche Duplikate - gleicher Absender und Betreff/);
});
