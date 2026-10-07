// @vitest-environment jsdom
/* Conversation reader: oldest-first stack of collapsible mails (incl. the
 * user's Sent replies), lazy bodies fetched in batches over one request,
 * folded quotes, notes, and the entry point from MessageView. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MessageView } from "./components/MailList";
import { ThreadView } from "./components/ThreadView";
import { setLang } from "./i18n";
import type { ConversationResp, Mail, MessageDetail } from "./types";

const thread = vi.fn();
const message = vi.fn();          // single mail (MessageView)
const messages = vi.fn();         // batch (ThreadView)

vi.mock("./api", () => ({
  api: {
    thread: (...a: unknown[]) => thread(...a),
    message: (...a: unknown[]) => message(...a),
    messages: (...a: unknown[]) => messages(...a),
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

const conv = (notes: ConversationResp["notes"] = [],
              mails: Mail[] = [a1, r1, a2]): ConversationResp =>
  ({ key: "k", label: "Plan", mails, notes });

const bodyOf = (text: string): MessageDetail =>
  ({ from: "x", to: "y", date: "d", subject: "s", text });

/** The batch endpoint: a text per uid, `bad` uids answer with an error. */
const serve = (text = (uid: number) => `body of ${uid}`, bad: number[] = []) =>
  messages.mockImplementation((items: [string, number][]) =>
    Promise.resolve({ messages: items.map(([folder, uid]) => ({
      folder, uid, ...(bad.includes(uid) ? { error: "fetch failed" }
        : bodyOf(text(uid))) })) }));

afterEach(() => {
  cleanup();
  thread.mockReset();
  message.mockReset();
  messages.mockReset();
  setLang("en");
});

test("lists the conversation oldest first with the user's replies as You",
  async () => {
    thread.mockResolvedValue(conv());
    serve();
    render(<ThreadView mail={a2} onBack={() => {}} />);
    await screen.findByText("3 mails");
    expect(thread).toHaveBeenCalledWith("INBOX", 3);
    expect(document.querySelectorAll("[aria-expanded]")).toHaveLength(3);
    expect(screen.getByText(/^You/)).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text.indexOf("boss@corp.example"))
      .toBeLessThan(text.indexOf("You"));
  });

test("the opened mail's text is reused - no request for it", async () => {
  thread.mockResolvedValue(conv());
  serve();
  render(<ThreadView mail={a2} initial={bodyOf("already loaded")}
    onBack={() => {}} />);
  await screen.findByText("already loaded");
  expect(messages).not.toHaveBeenCalled();
});

test("expanding a card fetches just that mail, once", async () => {
  thread.mockResolvedValue(conv());
  serve();
  render(<ThreadView mail={a2} initial={bodyOf("opened")}
    onBack={() => {}} />);
  await screen.findByText("opened");
  fireEvent.click(screen.getByText(/^You/));
  await screen.findByText("body of 2");
  expect(messages).toHaveBeenCalledTimes(1);
  expect(messages).toHaveBeenCalledWith([["Sent", 2]]);
  // collapsing and re-opening does not refetch
  fireEvent.click(screen.getByText(/^You/));
  fireEvent.click(screen.getByText(/^You/));
  expect(messages).toHaveBeenCalledTimes(1);
});

test("expand all loads in batches of 8 instead of one request per mail",
  async () => {
    const many = Array.from({ length: 12 }, (_, i) => mk(i + 1));
    thread.mockResolvedValue(conv([], many));
    serve();
    render(<ThreadView mail={many[0]} initial={bodyOf("first")}
      onBack={() => {}} />);
    await screen.findByText("first");
    fireEvent.click(screen.getByText("Expand all"));
    await screen.findByText("body of 12");
    expect(messages.mock.calls.map((c) => c[0].length)).toEqual([8, 3]);
    fireEvent.click(screen.getByText("Collapse all"));
    expect(screen.queryByText("body of 12")).toBeNull();
  });

test("quoted history is folded behind a toggle", async () => {
  thread.mockResolvedValue(conv());
  render(<ThreadView mail={a2} onBack={() => {}}
    initial={bodyOf("Sounds good.\n\nOn Mon, Boss wrote:\n> Can we meet?\n")}
  />);
  await screen.findByText(/Sounds good\./);
  expect(screen.queryByText(/Can we meet/)).toBeNull();
  fireEvent.click(screen.getByText("Show quoted text"));
  expect(screen.getByText(/Can we meet/)).toBeTruthy();
  fireEvent.click(screen.getByText("Hide quoted text"));
  expect(screen.queryByText(/Can we meet/)).toBeNull();
});

test("a mail that cannot be loaded shows its error in that card only",
  async () => {
    thread.mockResolvedValue(conv());
    serve(undefined, [2]);
    render(<ThreadView mail={a2} initial={bodyOf("ok")} onBack={() => {}} />);
    await screen.findByText("ok");
    fireEvent.click(screen.getByText(/^You/));
    await screen.findByText("fetch failed");
    expect(screen.getByText("ok")).toBeTruthy();
  });

test("a failed batch request marks its mails with the error", async () => {
  thread.mockResolvedValue(conv());
  messages.mockRejectedValue(new Error("connection reset"));
  render(<ThreadView mail={a2} initial={bodyOf("ok")} onBack={() => {}} />);
  await screen.findByText("3 mails");
  fireEvent.click(screen.getByText(/^You/));
  await screen.findByText("connection reset");
});

test("server notes are shown and a failed conversation load is reported",
  async () => {
    thread.mockResolvedValue(conv([{ key: "sent_unavailable", params: {} }]));
    const { unmount } = render(<ThreadView mail={a2} initial={bodyOf("x")}
      onBack={() => {}} />);
    await screen.findByText(/could not be loaded from the Sent folder/);
    unmount();
    thread.mockRejectedValue(new Error("boom"));
    render(<ThreadView mail={a2} initial={bodyOf("x")} onBack={() => {}} />);
    await screen.findByText("boom");
  });

test("back returns to the caller", async () => {
  thread.mockResolvedValue(conv());
  const onBack = vi.fn();
  render(<ThreadView mail={a1} initial={bodyOf("x")} onBack={onBack} />);
  await screen.findByText("3 mails");
  fireEvent.click(screen.getByText("back to list"));
  expect(onBack).toHaveBeenCalled();
});

// ------------------------------------------------- entry from a mail

test("MessageView offers the reader only for threaded mails, and hands the "
  + "loaded text over", async () => {
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
  expect(screen.getByText("part of a thread")).toBeTruthy();   // not refetched
  expect(messages).not.toHaveBeenCalled();
  // and back from the reader lands on the single message again
  fireEvent.click(screen.getByText("back to list"));
  await screen.findByText("Read conversation");
});
