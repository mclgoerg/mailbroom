// @vitest-environment jsdom
/* Restoring from Trash: the note says whether the views refresh by
 * themselves (a rescan was started) or the user has to rescan. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { TrashPanel } from "./components/TrashPanel";
import { setLang } from "./i18n";
import type { AppState } from "./types";

const trashRestore = vi.fn();

vi.mock("./api", () => ({
  api: {
    trash: () => Promise.resolve({
      folder: "Trash", uv: 1, total,
      mails: emptyList ? [] : [{ uid: 30, folder: "Trash", date: "2026-01-02", ts: 1,
        subject: "Deleted elsewhere", addr: "old@gone.example", size: 700,
        seen: false, ai: null }],
    }),
    trashRestore: (...a: unknown[]) => trashRestore(...a),
  },
  fmtSize: () => "1 KB",
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));

let total = 1;
let emptyList = false;
const state = {
  folders: ["INBOX"], folders_raw: ["INBOX"],
} as unknown as AppState;

afterEach(() => {
  cleanup();
  trashRestore.mockReset();
  total = 1;
  emptyList = false;
  setLang("en");
});

async function restoreOne() {
  render(<TrashPanel state={state} onClose={() => {}}
    onChanged={() => {}} onEmptyTrash={async () => true} />);
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.change(screen.getByDisplayValue(/Restore to/),
    { target: { value: "INBOX" } });
}

test("restore with a started rescan says the views update by themselves",
  async () => {
    trashRestore.mockResolvedValue({ restored: 1, rescan: true });
    await restoreOne();
    await waitFor(() => expect(screen.getByText(
      "Restored 1 mails - the views update automatically.")).toBeTruthy());
  });

test("restore while the server is busy still asks for a manual rescan",
  async () => {
    trashRestore.mockResolvedValue({ restored: 1, rescan: false });
    await restoreOne();
    await waitFor(() => expect(screen.getByText(
      "Restored 1 mails - rescan to see them in the views.")).toBeTruthy());
  });

test("the footer's Empty Trash runs the shared handler and reloads the list",
  async () => {
    const onEmptyTrash = vi.fn().mockResolvedValue(true);
    total = 7;
    render(<TrashPanel state={{ ...state, trash_count: 1 } as AppState}
      onClose={() => {}} onChanged={() => {}} onEmptyTrash={onEmptyTrash} />);
    await screen.findByText("Deleted elsewhere");
    // the panel's own listing total, not the (possibly stale) state count
    fireEvent.click(screen.getByRole("button", { name: "Empty Trash (7)…" }));
    await waitFor(() => expect(onEmptyTrash).toHaveBeenCalledWith(7));
  });

test("no Empty Trash footer when Trash is empty", async () => {
  total = 0;
  render(<TrashPanel state={{ ...state, trash_count: 3 } as AppState}
    onClose={() => {}} onChanged={() => {}} onEmptyTrash={async () => true} />);
  await screen.findByText("Deleted elsewhere");
  expect(screen.queryByRole("button", { name: /Empty Trash/ })).toBeNull();
});

test("rows are MailRows; the restore select only appears with a selection",
  async () => {
    render(<TrashPanel state={state} onClose={() => {}}
      onChanged={() => {}} onEmptyTrash={async () => true} />);
    await screen.findByText("Deleted elsewhere");
    expect(screen.getByText("old@gone.example · 1 KB")).toBeTruthy();
    expect(screen.getByText("2 Jan").getAttribute("title")).toBe("2026-01-02");
    expect(screen.getByText("unread")).toBeTruthy();   // seen: false
    expect(screen.getByLabelText("Select Deleted elsewhere")).toBeTruthy();
    expect(screen.queryByDisplayValue(/Restore to/)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByDisplayValue(/Restore to… \(1\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.queryByDisplayValue(/Restore to/)).toBeNull();
  });

test("an empty Trash shows the empty state and no Empty Trash footer",
  async () => {
    emptyList = true;
    total = 0;
    render(<TrashPanel state={state} onClose={() => {}}
      onChanged={() => {}} onEmptyTrash={async () => true} />);
    await screen.findByText("Trash is empty");
    expect(screen.queryByRole("button", { name: /Empty Trash/ })).toBeNull();
    expect(screen.queryByPlaceholderText("Search subject or sender")).toBeNull();
  });
