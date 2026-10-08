// @vitest-environment jsdom
/* Search panel: the mail-text toggle only exists for body_search=server,
 * the query asks for scope=body only when ticked, and the server's notes
 * (partial / charset / stale folder) are rendered. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactElement } from "react";
import { SearchPanel } from "./components/SearchPanel";
import { DialogProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { SearchResp } from "./types";

const search = vi.fn();
const deleteMessages = vi.fn();

vi.mock("./api", () => ({
  api: { search: (...a: unknown[]) => search(...a),
    deleteMessages: (...a: unknown[]) => deleteMessages(...a) },
  fmtSize: () => "1 KB",
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));

afterEach(() => {
  cleanup();
  search.mockReset();
  deleteMessages.mockReset();
  setLang("en");
});

const resp = (notes: SearchResp["notes"] = []): SearchResp =>
  ({ mails: [], notes });

const type = (value: string) => {
  fireEvent.change(screen.getByRole("textbox"), { target: { value } });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
};

test("no mail-text toggle when body search is off for the account", () => {
  render(<SearchPanel bodySearch={false} onClose={() => {}}
    onDeleted={() => {}} />);
  expect(screen.queryByText("Also search mail text")).toBeNull();
});

test("plain search stays metadata-only until the toggle is ticked", async () => {
  search.mockResolvedValue(resp());
  render(<SearchPanel bodySearch onClose={() => {}} onDeleted={() => {}} />);
  type("parcel");
  await waitFor(() => expect(search).toHaveBeenCalledWith("parcel", false));

  fireEvent.click(screen.getByLabelText("Also search mail text"));
  expect(screen.getByText(/asks your mail server/)).toBeTruthy();
  type("parcel");
  await waitFor(() => expect(search).toHaveBeenLastCalledWith("parcel", true));
});

test("server notes are rendered with their parameters", async () => {
  search.mockResolvedValue(resp([
    { key: "partial", params: {} },
    { key: "stale_folder", params: { folder: "Archive" } },
    { key: "charset_fallback", params: {} },
  ]));
  render(<SearchPanel bodySearch onClose={() => {}} onDeleted={() => {}} />);
  fireEvent.click(screen.getByLabelText("Also search mail text"));
  type("parcel");
  await waitFor(() => expect(screen.getByText(
    /Not every folder was searched in time/)).toBeTruthy());
  expect(screen.getByText(/"Archive" changed since the last scan/))
    .toBeTruthy();
  expect(screen.getByText(/does not support UTF-8 search/)).toBeTruthy();
});

test("notes are cleared by the next search", async () => {
  search.mockResolvedValueOnce(resp([{ key: "partial", params: {} }]))
    .mockResolvedValueOnce(resp());
  render(<SearchPanel bodySearch onClose={() => {}} onDeleted={() => {}} />);
  type("parcel");
  await waitFor(() => expect(screen.getByText(/Not every folder/))
    .toBeTruthy());
  type("parcel again");
  await waitFor(() => expect(screen.queryByText(/Not every folder/))
    .toBeNull());
});

test("local mode explains that it searches whole words and shows index notes",
  async () => {
    search.mockResolvedValue(resp([
      { key: "index_behind", params: { n: 3 } }]));
    render(<SearchPanel bodySearch bodyMode="local" onClose={() => {}}
      onDeleted={() => {}} />);
    fireEvent.click(screen.getByLabelText("Also search mail text"));
    expect(screen.getByText(/local word index: whole words only/)).toBeTruthy();
    expect(screen.queryByText(/asks your mail server/)).toBeNull();
    type("parcel");
    await waitFor(() => expect(search).toHaveBeenCalledWith("parcel", true));
    await screen.findByText(/3 newer mails are not in the index yet/);
  });

/* ---- list rows, toolbar relevance, empty states, confirm flow ---- */


const mail = (uid: number) => ({ uid, folder: "INBOX", date: "2026-01-02",
  ts: 1, subject: `Parcel ${uid}`, addr: "shop@x.example", size: 10,
  seen: true, ai: null });

const withDialogs = (ui: ReactElement) =>
  render(<DialogProvider>{ui}</DialogProvider>);

test("before a query: header, empty state, no selection actions", () => {
  withDialogs(<SearchPanel bodySearch onClose={() => {}}
    onDeleted={() => {}} />);
  expect(screen.getByText("Search your mailbox")).toBeTruthy();
  expect(screen.getByText(/Tick “Also search mail text”/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Select all" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Trash selected/ })).toBeNull();
});

test("without body search the empty state says so", () => {
  withDialogs(<SearchPanel onClose={() => {}} onDeleted={() => {}} />);
  expect(screen.getByText(/mail text is switched off/)).toBeTruthy();
});

test("no matches shows an empty state and no selection actions", async () => {
  search.mockResolvedValue(resp());
  withDialogs(<SearchPanel onClose={() => {}} onDeleted={() => {}} />);
  type("parcel");
  await screen.findByText("No matches");
  expect(screen.queryByRole("button", { name: "Select all" })).toBeNull();
});

test("results are MailRows; the danger button needs a selection, "
  + "and a cancelled confirm trashes nothing", async () => {
  search.mockResolvedValue({ mails: [mail(1), mail(2)], notes: [] });
  const onDeleted = vi.fn();
  withDialogs(<SearchPanel onClose={() => {}} onDeleted={onDeleted} />);
  type("parcel");
  await screen.findByText("Parcel 1");
  expect(screen.getByText("2 matches")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Select all" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Trash selected/ })).toBeNull();

  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  const trash = screen.getByRole("button", { name: "Trash selected (1)" });
  fireEvent.click(trash);
  await cancelDialog();
  await expectNoDialog();
  expect(deleteMessages).not.toHaveBeenCalled();
  expect(screen.getByText("Parcel 1")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Trash selected (1)" }));
  await pressDialog(/Move to Trash \(1\)/);
  await waitFor(() => expect(deleteMessages)
    .toHaveBeenCalledWith([["INBOX", 1]]));
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  expect(screen.queryByText("Parcel 1")).toBeNull();
});
