import { expect, test } from "vitest";
import type { WrappedResp } from "./types";
import { buildSummarySvg, maskAddr, type SummaryStrings } from "./wrapped";

const data: WrappedResp = {
  year: 2026, partial: false, years: [2025, 2026],
  received: { mails: 1234, bytes: 1, senders: 5, read: 100, new_senders: 2 },
  top_senders: [
    { label: "Ann Example", addr: "ann@shop.example", mails: 40, bytes: 9 },
    { label: "Bob <&>", addr: "bob@news.example", mails: 30, bytes: 9 }],
  loudest_month: null, busiest_weekday: null, busiest_hour: null,
  biggest: null, ghosts: { count: 0, top: [] },
  cleanup: { trashed: 0, archived: 0, purged: 0, freed_bytes: 0,
    unsubscribes: 0, rule_runs: 0, top_rule: null },
};
const str: SummaryStrings = {
  title: "Your year in mail 2026", lead: "You received",
  big: "1,234", unit: "mails in 2026", note: "Based on the mail in my mailbox now",
  stats: [{ value: "5", label: "senders" }], topTitle: "Loudest senders",
  topRows: ["40 mails", "30 mails"], footer: "Mailbroom",
};
const pal = { bg: "#000", panel: "#111", line: "#222", body: "#fff",
  muted: "#aaa", accent: "#c80" };

test("maskAddr keeps the first letter and the last domain label only", () => {
  expect(maskAddr("ann@shop.example")).toBe("a...@...example");
  expect(maskAddr("x@a.b.example")).toBe("x...@...example");
  expect(maskAddr("odd")).toBe("o...");
});

test("the summary SVG masks sender names by default", () => {
  const svg = buildSummarySvg(data, str, pal, false);
  expect(svg).not.toContain("ann@shop.example");
  expect(svg).not.toContain("shop");
  expect(svg).not.toContain("Ann Example");
  expect(svg).not.toContain("bob@news.example");
  expect(svg).toContain("a...@...example");
  expect(svg).toContain("1,234");
});

test("names appear only when toggled on, XML-escaped", () => {
  const svg = buildSummarySvg(data, str, pal, true);
  expect(svg).toContain("Ann Example");
  expect(svg).toContain("Bob &lt;&amp;&gt;");
  expect(svg).not.toContain("a...@...example");
  expect(svg.startsWith("<svg")).toBe(true);
});

test("the SVG carries translated strings as given (German)", () => {
  const de = { ...str, title: "Dein Jahr in Mails 2026",
    topTitle: "Lauteste Absender" };
  const svg = buildSummarySvg(data, de, pal, false);
  expect(svg).toContain("Dein Jahr in Mails 2026");
  expect(svg).toContain("Lauteste Absender");
});

test("control characters in names never reach the SVG", () => {
  const d = { ...data, top_senders: [{ ...data.top_senders[0],
    label: "An\u0000n\u0008 \u001FX" }] };
  const svg = buildSummarySvg(d, str, pal, true);
  expect(svg).toContain("Ann X");
  expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(svg)).toBe(false);
});
