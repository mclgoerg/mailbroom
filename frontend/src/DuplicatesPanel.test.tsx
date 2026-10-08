// @vitest-environment jsdom
/* Duplicates panel: MailRow rows per set, relevance-based toolbar, empty
 * state, select-all-but-newest and the ConfirmDialog flow. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { DuplicatesPanel } from "./components/DuplicatesPanel";
import { DialogProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";

const duplicates = vi.fn();
const deleteMessages = vi.fn();

vi.mock("./api", () => ({
  api: { duplicates: () => duplicates(),
    deleteMessages: (...a: unknown[]) => deleteMessages(...a) },
  fmtSize: () => "1 KB",
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));

const mk = (uid: number, folder = "INBOX") => ({ uid, folder,
  date: "2026-01-02T10:30:00", ts: 1, subject: "Invoice", addr: "a@x.example",
  size: 10, seen: true, ai: null });

const show = () => render(<DialogProvider>
  <DuplicatesPanel onClose={() => {}} onDeleted={() => {}} />
</DialogProvider>);

afterEach(() => {
  cleanup();
  duplicates.mockReset();
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
  expect(screen.getByText(/2 Jan, 10:30 · Archive · 1 KB/)).toBeTruthy();
  expect(screen.getByText("newest")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Trash selected/ })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Select all but newest" }));
  fireEvent.click(screen.getByRole("button", { name: "Trash selected (2)" }));
  await cancelDialog();
  await expectNoDialog();
  expect(deleteMessages).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Trash selected (2)" }));
  await pressDialog(/Move to Trash \(2\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
    [["Archive", 2], ["INBOX", 1]], "trash"));
});
