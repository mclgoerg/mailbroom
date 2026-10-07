// @vitest-environment jsdom
/* Flat "All mails" list: paging, sort/filter requests, folder per row,
 * selection + action bar, and the pinned-mail confirm/force flow. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AllMailsView } from "./components/AllMailsView";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
import type { AppState, Mail, MailsResp } from "./types";

const mails = vi.fn();
const deleteMessages = vi.fn();
const pin = vi.fn();

vi.mock("./api", () => ({
  api: {
    mails: (...a: unknown[]) => mails(...a),
    deleteMessages: (...a: unknown[]) => deleteMessages(...a),
    pin: (...a: unknown[]) => pin(...a),
    message: () => Promise.resolve({ from: "x", to: "", date: "d",
      subject: "s", text: "body text" }),
  },
  fmtSize: (b: number) => `${b} B`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));

const mk = (uid: number, over: Partial<Mail> = {}): Mail => ({
  uid, folder: uid % 2 ? "INBOX" : "Archive", date: `2026-01-${10 + uid}`,
  ts: uid, subject: `Subject ${uid}`, addr: `s${uid}@x.example`,
  size: 100 * uid, seen: true, ai: null, pinned: false, ...over,
});
const resp = (list: Mail[], total = list.length,
              ignored: string[] = []): MailsResp =>
  ({ total, offset: 0, mails: list, ignored });

const state = {
  account: "proton", groups_rev: 1,
  folders: ["INBOX", "Archive"], folders_raw: ["INBOX", "Archive"],
} as unknown as AppState;

const onChanged = vi.fn();
const renderView = () =>
  render(<ToastProvider><DialogProvider>
    <AllMailsView state={state} onChanged={onChanged} />
  </DialogProvider></ToastProvider>);

beforeEach(() => {
  deleteMessages.mockResolvedValue({ ok: true, queued: 1 });
  pin.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  mails.mockReset();
  deleteMessages.mockReset();
  pin.mockReset();
  onChanged.mockReset();
});

const tick = (uid: number) =>
  screen.getByText(`Subject ${uid}`).closest("div.flex")!
    .querySelector("input[type=checkbox]") as HTMLInputElement;

test("lists mails with folder and sender on every row and an x-of-y count",
  async () => {
    mails.mockResolvedValue(resp([mk(1), mk(2)], 250));
    renderView();
    await screen.findByText("Subject 1");
    expect(screen.getByText("2 of 250 mails")).toBeTruthy();
    expect(screen.getByText(/INBOX · s1@x.example/)).toBeTruthy();
    expect(screen.getByText(/Archive · s2@x.example/)).toBeTruthy();
    expect(mails).toHaveBeenCalledWith(
      { offset: 0, limit: 100, sort: "date", dir: "desc", q: "" });
  });

test("a single-folder list still shows the folder (detailed rows)",
  async () => {
    mails.mockResolvedValue(resp([mk(1), mk(3, { addr: "s1@x.example" })]));
    renderView();
    await screen.findByText("Subject 1");
    expect(screen.getAllByText(/INBOX · s1@x.example/)).toHaveLength(2);
  });

test("load more appends the next page and then goes away", async () => {
  mails.mockResolvedValueOnce(resp([mk(1), mk(2)], 3));
  renderView();
  await screen.findByText("Subject 1");
  mails.mockResolvedValueOnce({ ...resp([mk(3)], 3), offset: 2 });
  fireEvent.click(screen.getByText("Load 1 more"));
  await screen.findByText("Subject 3");
  expect(mails).toHaveBeenLastCalledWith(
    { offset: 2, limit: 100, sort: "date", dir: "desc", q: "" });
  expect(screen.getByText("3 of 3 mails")).toBeTruthy();
  expect(screen.queryByText(/Load \d+ more/)).toBeNull();
});

test("sort and filter go to the server; sender sort starts ascending",
  async () => {
    mails.mockResolvedValue(resp([mk(1)]));
    renderView();
    await screen.findByText("Subject 1");
    fireEvent.change(screen.getByDisplayValue("Date"),
      { target: { value: "sender" } });
    await waitFor(() => expect(mails).toHaveBeenLastCalledWith(
      { offset: 0, limit: 100, sort: "sender", dir: "asc", q: "" }));
    fireEvent.change(screen.getByPlaceholderText("filter mails…"),
      { target: { value: "age:>1y dhl" } });
    await waitFor(() => expect(mails).toHaveBeenLastCalledWith(
      { offset: 0, limit: 100, sort: "sender", dir: "asc",
        q: "age:>1y dhl" }));
    expect(localStorage.getItem("pmc_mails_sort")).toBe("sender");
  });

test("group-level qualifiers the server ignored are called out", async () => {
  mails.mockResolvedValue(resp([mk(1)], 1, ["tag:shipping"]));
  renderView();
  await screen.findByText(/Not applied to single mails: tag:shipping/);
});

test("selecting shows the action bar; Trash sends the picked mails",
  async () => {
    mails.mockResolvedValue(resp([mk(1), mk(2)], 2));
    renderView();
    await screen.findByText("Subject 1");
    expect(screen.queryByText(/selected/)).toBeNull();
    fireEvent.click(tick(2));
    expect(screen.getByText("1 selected")).toBeTruthy();
    fireEvent.click(screen.getByText(/Trash selected/));
    expect((await findDialog()).textContent).toContain('"Subject 2"');
    await pressDialog("Move to Trash (1)");
    await waitFor(() => expect(deleteMessages)
      .toHaveBeenCalledWith([["Archive", 2]], "trash", "", false));
    await waitFor(() => expect(screen.queryByText("Subject 2")).toBeNull());
    expect(screen.getByText("1 of 1 mails")).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

test("cancelling the trash confirmation sends nothing", async () => {
  mails.mockResolvedValue(resp([mk(1)], 1));
  renderView();
  await screen.findByText("Subject 1");
  fireEvent.click(tick(1));
  fireEvent.click(screen.getByText(/Trash selected/));
  await cancelDialog();
  await expectNoDialog();
  expect(deleteMessages).not.toHaveBeenCalled();
  expect(screen.getByText("Subject 1")).toBeTruthy();
});

test("Move to folder asks for a folder and sends it", async () => {
  mails.mockResolvedValue(resp([mk(1)], 1));
  renderView();
  await screen.findByText("Subject 1");
  fireEvent.click(tick(1));
  fireEvent.change(screen.getByDisplayValue("Action…"),
    { target: { value: "move" } });
  fireEvent.change(screen.getAllByDisplayValue("Move to folder…")[0],
    { target: { value: "Archive" } });
  await pressDialog(/^Move → Archive \(1\)$/);
  await waitFor(() => expect(deleteMessages)
    .toHaveBeenCalledWith([["INBOX", 1]], "move", "Archive", false));
});

test("mark read keeps the row and marks it read", async () => {
  mails.mockResolvedValue(resp([mk(1, { seen: false })], 1));
  renderView();
  await screen.findByText("Subject 1");
  fireEvent.click(tick(1));
  fireEvent.change(screen.getByDisplayValue("Action…"),
    { target: { value: "mark_read" } });
  await pressDialog("Mark as read (1)");
  await waitFor(() => expect(deleteMessages)
    .toHaveBeenCalledWith([["INBOX", 1]], "mark_read", "", false));
  expect(screen.getByText("Subject 1")).toBeTruthy();
});

test("ONE pinned mail gets its own warning and is sent with force",
  async () => {
    mails.mockResolvedValue(resp([mk(1, { pinned: true })], 1));
    renderView();
    await screen.findByText("Subject 1");
    fireEvent.click(tick(1));
    fireEvent.click(screen.getByText(/Trash selected/));
    expect((await findDialog()).textContent).toContain("Subject 1");
    await pressDialog("Move to Trash anyway");
    await waitFor(() => expect(deleteMessages)
      .toHaveBeenCalledWith([["INBOX", 1]], "trash", "", true));
  });

test("pinned mails inside a larger selection are dropped, not moved",
  async () => {
    mails.mockResolvedValue(resp([mk(1, { pinned: true }), mk(2)], 2));
    renderView();
    await screen.findByText("Subject 2");
    fireEvent.click(tick(1));
    fireEvent.click(tick(2));
    fireEvent.click(screen.getByText(/Trash selected/));
    expect((await findDialog()).textContent)
      .toContain("1 protected mail(s) skipped");
    await pressDialog("Move to Trash (1)");
    await waitFor(() => expect(deleteMessages)
      .toHaveBeenCalledWith([["Archive", 2]], "trash", "", false));
    expect(screen.getByText("Subject 1")).toBeTruthy();   // still listed
  });

test("a selection of only pinned mails does nothing", async () => {
  mails.mockResolvedValue(resp(
    [mk(1, { pinned: true }), mk(3, { pinned: true })], 2));
  renderView();
  await screen.findByText("Subject 1");
  fireEvent.click(tick(1));
  fireEvent.click(tick(3));
  fireEvent.click(screen.getByText(/Trash selected/));
  expect(deleteMessages).not.toHaveBeenCalled();
});

test("opening a mail shows it in the message view", async () => {
  mails.mockResolvedValue(resp([mk(1)], 1));
  renderView();
  fireEvent.click(await screen.findByText("Subject 1"));
  await screen.findByText("body text");
});

test("a new groups_rev refreshes in place keeping the loaded pages",
  async () => {
    mails.mockResolvedValue(resp([mk(1), mk(2)], 2));
    const { rerender } = renderView();
    await screen.findByText("Subject 1");
    mails.mockClear();
    mails.mockResolvedValue(resp([mk(2)], 1));
    rerender(<ToastProvider><DialogProvider>
      <AllMailsView state={{ ...state, groups_rev: 2 } as AppState}
        onChanged={onChanged} />
    </DialogProvider></ToastProvider>);
    await waitFor(() => expect(screen.queryByText("Subject 1")).toBeNull());
    expect(mails).toHaveBeenCalledWith(
      { offset: 0, limit: 100, sort: "date", dir: "desc", q: "" });
  });
