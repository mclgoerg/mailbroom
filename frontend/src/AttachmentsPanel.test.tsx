// @vitest-environment jsdom
/* Attachments panel: MailRow rows, relevance-based toolbar, empty states
 * and the ConfirmDialog flow for trashing. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AttachmentsPanel } from "./components/AttachmentsPanel";
import { DialogProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { AppState } from "./types";

const attachments = vi.fn();
const deleteMessages = vi.fn();

vi.mock("./api", () => ({
  api: { attachments: () => attachments(),
    deleteMessages: (...a: unknown[]) => deleteMessages(...a) },
  fmtSize: () => "2 MB",
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));

const mk = (uid: number) => ({ uid, folder: "INBOX", date: "2026-01-02",
  ts: 1, subject: `Scan ${uid}`, addr: "a@x.example", size: 10, seen: true,
  ai: null, att_size: 2e6, atts: [{ name: "doc.pdf", size: 2e6 }] });

const state = (status: string) => ({ status: "done",
  atts: { status, mails: 2, size: 4e6, progress: "", error: "" },
}) as unknown as AppState;

const show = (status = "done") => render(<DialogProvider>
  <AttachmentsPanel state={state(status)} onClose={() => {}}
    onDeleted={() => {}} />
</DialogProvider>);

afterEach(() => {
  cleanup();
  attachments.mockReset();
  deleteMessages.mockReset();
  setLang("en");
});

test("never analyzed: empty state, no selection actions", () => {
  show("idle");
  expect(screen.getByText("Not analyzed yet")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Trash selected/ })).toBeNull();
});

test("nothing found: empty state that points to Re-analyze", async () => {
  attachments.mockResolvedValue([]);
  show();
  await screen.findByText("No attachments found");
  expect(screen.getByText(/Re-analyze/, { selector: "div" })).toBeTruthy();
});

test("rows are MailRows; danger button only with a selection; cancel keeps "
  + "everything", async () => {
  attachments.mockResolvedValue([mk(1), mk(2)]);
  show();
  await screen.findByText("Scan 1");
  expect(screen.getAllByText(/2 Jan · a@x.example · doc.pdf \(2 MB\)/))
    .toHaveLength(2);
  expect(screen.queryByRole("button", { name: /Trash selected/ })).toBeNull();

  fireEvent.click(screen.getAllByRole("checkbox")[1]);
  fireEvent.click(screen.getByRole("button", { name: "Trash selected (1)" }));
  await cancelDialog();
  await expectNoDialog();
  expect(deleteMessages).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Trash selected (1)" }));
  await pressDialog(/Move to Trash \(1\)/);
  await waitFor(() => expect(deleteMessages)
    .toHaveBeenCalledWith([["INBOX", 2]], "trash"));
});
