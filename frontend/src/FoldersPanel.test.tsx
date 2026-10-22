// @vitest-environment jsdom
/* Folders panel: Junk | Trash switch, by-sender grouping, selection-only
 * actions, "Not junk" with an Undo + Protect toast, restore from Trash (the
 * note says whether the views refresh by themselves), Empty Trash footer. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FoldersPanel } from "./components/FoldersPanel";
import { DialogProvider, ToastProvider } from "./components/ui";
import { setLang } from "./i18n";
import type { AppState } from "./types";

const trashRestore = vi.fn();
const folderMove = vi.fn();
const foldersPanel = vi.fn();

vi.mock("./api", () => ({
  api: {
    foldersPanel: (role: string) => foldersPanel(role),
    folderMove: (...a: unknown[]) => folderMove(...a),
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

const trashListing = () => ({
  folder: "Trash", uv: 1, total, max_uid: 77,
  mails: emptyList ? [] : [{ uid: 30, folder: "Trash", date: "2026-01-02",
    ts: 1, subject: "Deleted elsewhere", addr: "old@gone.example", size: 700,
    seen: false, ai: null }],
  senders: emptyList ? [] : [{ addr: "old@gone.example", count: 1,
    size: 700, unread: 1, ts: 1, date: "2026-01-02", uids: [30] }],
});
const junkListing = () => ({
  folder: "Spam", uv: 4, total: 3, max_uid: 42,
  mails: [
    { uid: 42, folder: "Spam", date: "2026-01-04", ts: 4,
      subject: "Wrongly caught", addr: "bob@friends.example", size: 700,
      seen: false, ai: null },
    { uid: 41, folder: "Spam", date: "2026-01-03", ts: 3, subject: "Again",
      addr: "win@lottery.example", size: 600, seen: true, ai: null },
    { uid: 40, folder: "Spam", date: "2026-01-02", ts: 2, subject: "You won",
      addr: "win@lottery.example", size: 500, seen: false, ai: null },
  ],
  senders: [
    { addr: "win@lottery.example", count: 2, size: 1100, unread: 1, ts: 3,
      date: "2026-01-03", uids: [40, 41] },
    { addr: "bob@friends.example", count: 1, size: 700, unread: 1, ts: 4,
      date: "2026-01-04", uids: [42] },
  ],
});

beforeEach(() => {
  foldersPanel.mockImplementation((role: string) =>
    Promise.resolve(role === "junk" ? junkListing() : trashListing()));
});

afterEach(() => {
  cleanup();
  folderMove.mockReset();
  foldersPanel.mockReset();
  trashRestore.mockReset();
  total = 1;
  emptyList = false;
  setLang("en");
});

const onUndo = vi.fn();
const onProtect = vi.fn().mockResolvedValue(true);
function panel(over: Partial<React.ComponentProps<typeof FoldersPanel>> = {}) {
  return render(<ToastProvider><DialogProvider>
    <FoldersPanel state={state} onClose={() => {}} onChanged={() => {}}
      onEmptyTrash={async () => true} onUndo={onUndo} onProtect={onProtect}
      {...over} />
  </DialogProvider></ToastProvider>);
}

async function restoreOne() {
  panel();
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.change(screen.getByDisplayValue(/Restore to/),
    { target: { value: "INBOX" } });
}

test("restore with a started rescan says the views update by themselves",
  async () => {
    trashRestore.mockResolvedValue({ restored: 1, rescan: true });
    await restoreOne();
    await waitFor(() => expect(screen.getByText(
      "Restored 1 mail - the views update automatically.")).toBeTruthy());
  });

test("restore while the server is busy still asks for a manual rescan",
  async () => {
    trashRestore.mockResolvedValue({ restored: 1, rescan: false });
    await restoreOne();
    await waitFor(() => expect(screen.getByText(
      "Restored 1 mail - rescan to see it in the views.")).toBeTruthy());
  });

test("the footer's Empty Trash runs the shared handler and reloads the list",
  async () => {
    const onEmptyTrash = vi.fn().mockResolvedValue(true);
    total = 7;
    panel({ state: { ...state, trash_count: 1 } as AppState, onEmptyTrash });
    await screen.findByText("Deleted elsewhere");
    // the panel's own listing total, not the (possibly stale) state count
    fireEvent.click(screen.getByRole("button", { name: "Empty Trash (7)…" }));
    await waitFor(() => expect(onEmptyTrash).toHaveBeenCalledWith(
      expect.objectContaining({ total: 7, uv: 1, max_uid: 77 })));
  });

test("no Empty Trash footer when Trash is empty", async () => {
  total = 0;
  panel({ state: { ...state, trash_count: 3 } as AppState });
  await screen.findByText("Deleted elsewhere");
  expect(screen.queryByRole("button", { name: /Empty Trash/ })).toBeNull();
});

test("rows are MailRows; the restore select only appears with a selection",
  async () => {
    panel();
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
    panel();
    await screen.findByText("Trash is empty");
    expect(screen.queryByRole("button", { name: /Empty Trash/ })).toBeNull();
    expect(screen.queryByPlaceholderText("Search subject or sender")).toBeNull();
  });

/* ------------------------------ Junk | Trash ------------------------------ */

test("the Segmented switch loads the other folder", async () => {
  panel();
  await screen.findByText("Deleted elsewhere");
  expect(foldersPanel).toHaveBeenLastCalledWith("trash");
  fireEvent.click(screen.getByRole("tab", { name: "Junk" }));
  await screen.findByText("win@lottery.example");          // Junk: by sender
  expect(foldersPanel).toHaveBeenLastCalledWith("junk");
  // Empty Trash belongs to Trash only
  expect(screen.queryByRole("button", { name: /Empty Trash/ })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Trash" }));
  await screen.findByText("Deleted elsewhere");
  expect(screen.getByRole("button", { name: /Empty Trash/ })).toBeTruthy();
});

test("the header chip opens on Trash, the Tools entry / Junk chip on Junk",
  async () => {
    panel({ initialRole: "junk" });
    await screen.findByText("win@lottery.example");
    expect(screen.getByRole("tab", { name: "Junk" })
      .getAttribute("aria-selected")).toBe("true");
  });

test("by sender: one row per sender with its count; opening it lists its mails",
  async () => {
    panel({ initialRole: "junk" });
    await screen.findByText("win@lottery.example");
    expect(screen.getByText("2 mails · 1 KB")).toBeTruthy();
    expect(screen.getByText("bob@friends.example")).toBeTruthy();
    fireEvent.click(screen.getByText("win@lottery.example"));
    await screen.findByText("You won");
    expect(screen.getByText("Again")).toBeTruthy();
    expect(screen.queryByText("Wrongly caught")).toBeNull();   // filtered
    // back to the sender view with the By sender segment
    fireEvent.change(screen.getByPlaceholderText("Search subject or sender"),
      { target: { value: "" } });
    fireEvent.click(screen.getByRole("tab", { name: "By sender" }));
    expect(screen.getByText("2 mails · 1 KB")).toBeTruthy();
  });

test("selecting a sender selects all of its mails; actions only with a selection",
  async () => {
    panel({ initialRole: "junk" });
    await screen.findByText("win@lottery.example");
    expect(screen.queryByRole("button", { name: /Not junk/ })).toBeNull();
    expect(screen.queryByLabelText("Action…")).toBeNull();
    fireEvent.click(screen.getByLabelText("Select win@lottery.example"));
    expect(screen.getByRole("button", { name: "Not junk (2)" })).toBeTruthy();
    expect(screen.getByLabelText("Action…")).toBeTruthy();
    // no permanent delete in this panel
    expect(screen.queryByText(/permanently/i)).toBeNull();
    fireEvent.click(screen.getByLabelText("Select win@lottery.example"));
    expect(screen.queryByRole("button", { name: /Not junk/ })).toBeNull();
  });

test("Not junk moves the exact UIDs, toasts with Undo and Protect sender",
  async () => {
    const onChanged = vi.fn();
    const undo = { ts: 9, label: "1 mails from Junk", count: 1 };
    folderMove.mockResolvedValue({ moved: 1, rescan: true,
      senders: ["bob@friends.example"], undo });
    panel({ initialRole: "junk", onChanged });
    await screen.findByText("bob@friends.example");
    fireEvent.click(screen.getByLabelText("Select bob@friends.example"));
    fireEvent.click(screen.getByRole("button", { name: "Not junk (1)" }));
    await screen.findByText("Moved 1 mail to your inbox");
    expect(folderMove).toHaveBeenCalledWith("junk", "not_junk", [42], 4);
    // the row is gone; the count in the sub line follows
    expect(screen.queryByText("bob@friends.example")).toBeNull();
    expect(screen.getByText("2 mails")).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
    // nothing was protected by the move itself
    expect(onProtect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Protect sender" }));
    expect(onProtect).toHaveBeenCalledWith(["bob@friends.example"]);
    cleanup();
    panel({ initialRole: "junk" });
    await screen.findByText("bob@friends.example");
    fireEvent.click(screen.getByLabelText("Select bob@friends.example"));
    fireEvent.click(screen.getByRole("button", { name: "Not junk (1)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledWith(undo);
  });

test("Move to Trash from Junk; protected mails ask before a forced retry",
  async () => {
    const err = Object.assign(new Error("Some are protected."),
      { code: "protected_mails" });
    folderMove.mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ moved: 1, rescan: false,
        senders: ["bob@friends.example"], undo: null });
    panel({ initialRole: "junk" });
    await screen.findByText("bob@friends.example");
    fireEvent.click(screen.getByLabelText("Select bob@friends.example"));
    fireEvent.change(screen.getByLabelText("Action…"),
      { target: { value: "trash" } });
    expect(await screen.findByText("Some are protected.")).toBeTruthy();
    expect(folderMove).toHaveBeenCalledTimes(1);          // nothing forced yet
    expect(folderMove).toHaveBeenLastCalledWith("junk", "trash", [42], 4);
    fireEvent.click(screen.getByRole("button", { name: "Move anyway" }));
    await screen.findByText("Moved 1 mail to Trash");
    expect(folderMove).toHaveBeenLastCalledWith("junk", "trash", [42], 4, true);
  });

test("German labels", async () => {
  setLang("de");
  panel({ initialRole: "junk" });
  await screen.findByText("win@lottery.example");
  expect(screen.getByRole("tab", { name: "Spam" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Papierkorb" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Nach Absender" })).toBeTruthy();
  fireEvent.click(screen.getByLabelText("bob@friends.example auswählen"));
  expect(screen.getByRole("button", { name: "Kein Spam (1)" })).toBeTruthy();
  expect(screen.getByLabelText("Aktion…")).toBeTruthy();
});

test("phone layout: the role switch has its own full-width row, buttons >= 44px",
  async () => {
    panel({ initialRole: "junk" });
    await screen.findByText("win@lottery.example");
    const tabs = screen.getByRole("tablist", { name: "Folder" });
    expect(tabs.className).toContain("w-full");
    expect(tabs.parentElement!.className).toContain("border-b");
    fireEvent.click(screen.getByLabelText("Select bob@friends.example"));
    expect(screen.getByRole("button", { name: "Not junk (1)" }).className)
      .toContain("max-sm:coarse:min-h-11");
    expect(screen.getByLabelText("Action…").className)
      .toContain("max-sm:coarse:min-h-11");
  });
