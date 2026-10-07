// @vitest-environment jsdom
/* Search panel: the mail-text toggle only exists for body_search=server,
 * the query asks for scope=body only when ticked, and the server's notes
 * (partial / charset / stale folder) are rendered. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SearchPanel } from "./components/SearchPanel";
import { setLang } from "./i18n";
import type { SearchResp } from "./types";

const search = vi.fn();

vi.mock("./api", () => ({
  api: { search: (...a: unknown[]) => search(...a), deleteMessages: vi.fn() },
  fmtSize: () => "1 KB",
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));

afterEach(() => {
  cleanup();
  search.mockReset();
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
