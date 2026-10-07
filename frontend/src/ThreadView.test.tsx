// @vitest-environment jsdom
/* Conversation reader: oldest-first stack of collapsible mails (incl. the
 * user's Sent replies), lazy bodies, folded quotes, notes, and the entry
 * points from MessageView. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MessageView } from "./components/MailList";
import { ThreadView } from "./components/ThreadView";
import { setLang } from "./i18n";
import type { ConversationResp, Mail, MessageDetail } from "./types";

const thread = vi.fn();
const message = vi.fn();

vi.mock("./api", () => ({
  api: {
    thread: (...a: unknown[]) => thread(...a),
    message: (...a: unknown[]) => message(...a),
  },
  fmtSize: () => "1 KB",
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));

const mk = (uid: number, over: Partial<Mail> = {}): Mail => ({
  uid, folder: "INBOX", date: `2024-03-0${uid % 9} 10:00`, ts: uid,
  subject: "Plan", addr: "boss@corp.example", size: 1, seen: true, ai: null,
  ...over,
});
const a1 = mk(1), r1 = mk(2, { folder: "Sent", sent: true,
  addr: "me@self.example", subject: "Re: Plan" });
const a2 = mk(3, { seen: false, subject: "Re: Plan" });

const conv = (notes: ConversationResp["notes"] = []): ConversationResp =>
  ({ key: "k", label: "Plan", mails: [a1, r1, a2], notes });

const bodyOf = (text: string): MessageDetail =>
  ({ from: "x", to: "y", date: "d", subject: "s", text });

afterEach(() => {
  cleanup();
  thread.mockReset();
  message.mockReset();
  setLang("en");
});

test("lists the conversation oldest first with the user's replies as You",
  async () => {
    thread.mockResolvedValue(conv());
    message.mockResolvedValue(bodyOf("hello"));
    render(<ThreadView mail={a2} onBack={() => {}} />);
    await screen.findByText("Plan", { selector: "span.truncate" });
    expect(thread).toHaveBeenCalledWith("INBOX", 3);
    const rows = screen.getAllByRole("button", { expanded: false })
      .concat(screen.getAllByRole("button", { expanded: true }))
      .filter((b) => b.hasAttribute("aria-expanded"));
    expect(rows).toHaveLength(3);
    expect(screen.getByText("3 mails")).toBeTruthy();
    expect(screen.getByText(/^You/)).toBeTruthy();
    // order in the DOM: a1, r1 (You), a2
    const text = document.body.textContent ?? "";
    expect(text.indexOf("boss@corp.example"))
      .toBeLessThan(text.indexOf("You"));
  });

test("only the mail we came from is open; others load when expanded",
  async () => {
    thread.mockResolvedValue(conv());
    message.mockImplementation((_f: string, uid: number) =>
      Promise.resolve(bodyOf(`body of ${uid}`)));
    render(<ThreadView mail={a2} onBack={() => {}} />);
    await screen.findByText("body of 3");
    expect(message).toHaveBeenCalledTimes(1);
    expect(message).toHaveBeenCalledWith("INBOX", 3);
    fireEvent.click(screen.getByText(/^You/));
    await screen.findByText("body of 2");
    expect(message).toHaveBeenCalledWith("Sent", 2);
    // collapsing and re-opening does not refetch
    fireEvent.click(screen.getByText(/^You/));
    fireEvent.click(screen.getByText(/^You/));
    expect(message).toHaveBeenCalledTimes(2);
  });

test("expand all fetches every mail, collapse all closes them", async () => {
  thread.mockResolvedValue(conv());
  message.mockImplementation((_f: string, uid: number) =>
    Promise.resolve(bodyOf(`body of ${uid}`)));
  render(<ThreadView mail={a1} onBack={() => {}} />);
  await screen.findByText("body of 1");
  fireEvent.click(screen.getByText("Expand all"));
  await screen.findByText("body of 2");
  await screen.findByText("body of 3");
  fireEvent.click(screen.getByText("Collapse all"));
  expect(screen.queryByText("body of 1")).toBeNull();
});

test("quoted history is folded behind a toggle", async () => {
  thread.mockResolvedValue(conv());
  message.mockResolvedValue(bodyOf(
    "Sounds good.\n\nOn Mon, Boss wrote:\n> Can we meet?\n"));
  render(<ThreadView mail={a2} onBack={() => {}} />);
  await screen.findByText(/Sounds good\./);
  expect(screen.queryByText(/Can we meet/)).toBeNull();
  fireEvent.click(screen.getByText("Show quoted text"));
  expect(screen.getByText(/Can we meet/)).toBeTruthy();
  fireEvent.click(screen.getByText("Hide quoted text"));
  expect(screen.queryByText(/Can we meet/)).toBeNull();
});

test("a body that fails to load shows its error in that card only",
  async () => {
    thread.mockResolvedValue(conv());
    message.mockRejectedValue(new Error("fetch failed"));
    render(<ThreadView mail={a2} onBack={() => {}} />);
    await screen.findByText("fetch failed");
    expect(screen.getByText("3 mails")).toBeTruthy();
  });

test("server notes are shown and a failed conversation load is reported",
  async () => {
    thread.mockResolvedValue(conv([{ key: "sent_unavailable", params: {} }]));
    message.mockResolvedValue(bodyOf("x"));
    const { unmount } = render(<ThreadView mail={a2} onBack={() => {}} />);
    await screen.findByText(/could not be loaded from the Sent folder/);
    unmount();
    thread.mockRejectedValue(new Error("boom"));
    render(<ThreadView mail={a2} onBack={() => {}} />);
    await screen.findByText("boom");
  });

test("back returns to the caller", async () => {
  thread.mockResolvedValue(conv());
  message.mockResolvedValue(bodyOf("x"));
  const onBack = vi.fn();
  render(<ThreadView mail={a1} onBack={onBack} />);
  await screen.findByText("3 mails");
  fireEvent.click(screen.getByText("back to list"));
  expect(onBack).toHaveBeenCalled();
});

// ------------------------------------------------- entry from a mail

test("MessageView offers the reader only for threaded mails", async () => {
  message.mockResolvedValue({ ...bodyOf("single"), thread: null });
  const { unmount } = render(<MessageView mail={a1} onBack={() => {}} />);
  await screen.findByText("single");
  expect(screen.queryByText("Read conversation")).toBeNull();
  unmount();

  message.mockResolvedValue({ ...bodyOf("part of a thread"),
    thread: { count: 2 } });
  thread.mockResolvedValue(conv());
  render(<MessageView mail={a1} onBack={() => {}} />);
  await screen.findByText("part of a thread");
  fireEvent.click(screen.getByText("Read conversation"));
  await screen.findByText("3 mails");
  // and back from the reader lands on the single message again
  fireEvent.click(screen.getByText("back to list"));
  await screen.findByText("Read conversation");
});
