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
      folder: "Trash", uv: 1, total: 1,
      mails: [{ uid: 30, folder: "Trash", date: "2026-01-02", ts: 1,
        subject: "Deleted elsewhere", addr: "old@gone.example", size: 700,
        seen: true, ai: null }],
    }),
    trashRestore: (...a: unknown[]) => trashRestore(...a),
  },
  fmtSize: () => "1 KB",
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));

const state = {
  folders: ["INBOX"], folders_raw: ["INBOX"],
} as unknown as AppState;

afterEach(() => {
  cleanup();
  trashRestore.mockReset();
  setLang("en");
});

async function restoreOne() {
  render(<TrashPanel state={state} onClose={() => {}}
    onChanged={() => {}} />);
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
