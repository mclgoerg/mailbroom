import { describe, expect, it } from "vitest";
import { splitQuoted } from "./quoted";

const visible = (t: string) => splitQuoted(t).filter((s) => !s.quoted)
  .map((s) => s.text).join("\n").trim();
const hidden = (t: string) => splitQuoted(t).filter((s) => s.quoted)
  .map((s) => s.text).join("\n");

describe("splitQuoted", () => {
  it("keeps a plain message as one visible segment", () => {
    expect(splitQuoted("Hello\n\nSee you")).toEqual(
      [{ text: "Hello\n\nSee you", quoted: false }]);
  });

  it("folds a top-posted reply's quoted history", () => {
    const t = "Sounds good.\n\nOn Mon, Mar 3, 2024 at 10:00 AM Boss "
      + "<boss@corp.example> wrote:\n> Can we meet?\n> At noon?\n";
    expect(visible(t)).toBe("Sounds good.");
    expect(hidden(t)).toContain("Can we meet?");
    expect(hidden(t)).toContain("wrote:");
  });

  it("handles an attribution wrapped onto two lines (Gmail)", () => {
    const t = "Yes.\n\nOn Mon, Mar 3, 2024 at 10:00 AM Boss <boss@corp.example>\n"
      + "wrote:\n> question\n";
    expect(visible(t)).toBe("Yes.");
    expect(hidden(t)).toContain("question");
  });

  it("handles German attributions", () => {
    const t = "Passt.\n\nAm 03.03.2024 um 10:00 schrieb Boss <b@x.de>:\n> Frage\n";
    expect(visible(t)).toBe("Passt.");
  });

  it("keeps an answer written BELOW the quote (bottom-posting)", () => {
    const t = "On Mon, Boss wrote:\n> Can we meet?\n\nYes, at noon.";
    expect(visible(t)).toBe("Yes, at noon.");
    expect(hidden(t)).toContain("Can we meet?");
  });

  it("keeps inline answers between quoted lines visible", () => {
    const t = "> Q1?\nA1.\n> Q2?\nA2.";
    expect(visible(t)).toBe("A1.\nA2.");
    expect(splitQuoted(t).map((s) => s.quoted))
      .toEqual([true, false, true, false]);
  });

  it("folds ordinary '>' blocks without an attribution", () => {
    expect(visible("Thanks!\n> old\n> older")).toBe("Thanks!");
  });

  it("folds an Outlook header block and everything after it", () => {
    const t = "Done.\n\n________________________________\nFrom: Boss\n"
      + "Sent: Monday\nTo: Me\nSubject: Plan\n\nOld text\nmore old";
    expect(visible(t)).toContain("Done.");
    expect(visible(t)).not.toContain("Old text");
    expect(hidden(t)).toContain("Old text");
  });

  it("folds 'Original Message' and forwarded-message markers", () => {
    expect(visible("ok\n-----Original Message-----\nFrom: x\nstuff"))
      .toBe("ok");
    expect(visible("fyi\n---------- Forwarded message ---------\nFrom: x\nbody"))
      .toBe("fyi");
    expect(visible("ok\n-----Ursprüngliche Nachricht-----\nVon: x\nalt"))
      .toBe("ok");
  });

  it("does not fold a lone 'On … wrote:' sentence without a quote", () => {
    const t = "On Monday I wrote: nothing special.\nBye";
    expect(splitQuoted(t)).toEqual([{ text: t, quoted: false }]);
  });

  it("returns the whole body when nothing of it would stay visible", () => {
    const t = "> just a quote\n> and more";
    expect(splitQuoted(t)).toEqual([{ text: t, quoted: false }]);
    const fwd = "-----Original Message-----\nFrom: x\nSent: y\nSubject: z\nbody";
    expect(splitQuoted(fwd)).toEqual([{ text: fwd, quoted: false }]);
  });

  it("copes with CRLF and empty input", () => {
    expect(visible("Hi\r\n> q\r\n")).toBe("Hi");
    expect(splitQuoted("")).toEqual([{ text: "", quoted: false }]);
  });
});
