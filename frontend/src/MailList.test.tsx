// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import type { Mail } from "./types";

import { MailRows } from "./components/MailList";

const mk = (uid: number, over: Partial<Mail> = {}): Mail => ({
  uid, folder: "INBOX", date: "2025-01-01", ts: 0,
  subject: `Mail ${uid}`, addr: "s@x.example", size: 1000,
  seen: true, ai: null, ...over,
});

const noop = () => {};

describe("MailRows", () => {
  afterEach(cleanup);
  setLang("en");

  it("bolds the subject of an unread mail and keeps read ones regular",
    () => {
    render(<MailRows mails={[mk(1, { seen: false }), mk(2, { seen: true })]}
      sel={new Set()} onToggle={noop} onOpen={noop} />);
    expect(screen.getByText("Mail 1").className).toContain("font-semibold");
    expect(screen.getByText("Mail 2").className).not.toContain("font-semibold");
  });

  it("keeps the meta line to date + size for a single-sender, "
    + "single-folder list", () => {
    render(<MailRows mails={[mk(1), mk(2)]}
      sel={new Set()} onToggle={noop} onOpen={noop} />);
    expect(screen.getAllByText("1000 B").length).toBe(2);
    // the date is a <time> with the ISO day as its tooltip
    expect(screen.getAllByText("1 Jan 2025")[0].getAttribute("title"))
      .toBe("2025-01-01");
  });

  it("adds the sender address once the visible mails span more than one "
    + "sender", () => {
    render(<MailRows mails={[
      mk(1, { addr: "a@x.example" }), mk(2, { addr: "b@x.example" }),
    ]} sel={new Set()} onToggle={noop} onOpen={noop} />);
    expect(screen.getByText("a@x.example · 1000 B")).toBeTruthy();
    expect(screen.getByText("b@x.example · 1000 B")).toBeTruthy();
  });

  it("adds the folder once the visible mails span more than one folder",
    () => {
    render(<MailRows mails={[
      mk(1, { folder: "INBOX" }), mk(2, { folder: "Archive" }),
    ]} sel={new Set()} onToggle={noop} onOpen={noop} />);
    expect(screen.getByText("INBOX · 1000 B")).toBeTruthy();
    expect(screen.getByText("Archive · 1000 B")).toBeTruthy();
  });
});
