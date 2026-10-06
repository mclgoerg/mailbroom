// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupTable } from "./components/GroupTable";
import { setLang } from "./i18n";
import type { Group } from "./types";

const mk = (i: number): Group => ({
  key: `s${i}@x.example`, label: `Sender ${i}`, sub: `s${i}@x.example`,
  count: i + 1, size: 1000 * (i + 1), unread: 0,
  first: "2024-01-01", last: "2025-01-01", tags: [], samples: [],
  bulk: false, unsub: false, ai: null, ratings: null, protected: false,
  replied: false, att_size: 0, unsubscribed: null, new: false, pinned: 0,
  engagement: 50,
});

const groups = Array.from({ length: 120 }, (_, i) => mk(i));
const noop = () => {};

function renderTable(extra: Partial<Parameters<typeof GroupTable>[0]> = {}) {
  return render(
    <GroupTable
      groups={groups}
      selected={new Set()}
      focusedKey={null}
      onToggle={noop}
      onToggleAll={noop}
      onOpen={noop}
      onAckUnsub={noop}
      sortK="count"
      sortDir={-1}
      onSort={noop}
      groupLabel="Sender"
      resetSignal="a"
      {...extra}
    />,
  );
}

const rows = (c: HTMLElement) => c.querySelectorAll("tbody tr").length;

describe("GroupTable pagination", () => {
  beforeEach(() => {
    setLang("en");
    localStorage.removeItem("pmc_page_size");
  });
  afterEach(cleanup);

  it("shows the first page of 50 by default", () => {
    const { container, getByText } = renderTable();
    expect(rows(container)).toBe(50);
    getByText("Page 1 / 3");
    expect(container.querySelector("tbody tr")!.textContent)
      .toContain("Sender 0");
  });

  it("navigates with next / last / first", () => {
    const { container, getByText } = renderTable();
    fireEvent.click(getByText("›"));
    getByText("Page 2 / 3");
    expect(container.querySelector("tbody tr")!.textContent)
      .toContain("Sender 50");
    fireEvent.click(getByText("»"));
    getByText("Page 3 / 3");
    expect(rows(container)).toBe(20);
    fireEvent.click(getByText("«"));
    getByText("Page 1 / 3");
  });

  it("changes and persists the page size", () => {
    const { container, getByText, getByDisplayValue } = renderTable();
    fireEvent.change(getByDisplayValue("50 per page"),
      { target: { value: "25" } });
    expect(rows(container)).toBe(25);
    getByText("Page 1 / 5");
    expect(localStorage.getItem("pmc_page_size")).toBe("25");
  });

  it("follows the focused row onto its page", () => {
    const { container, getByText } = renderTable({
      focusedKey: "s70@x.example" });
    getByText("Page 2 / 3");
    expect(container.querySelector('[data-gidx="70"]')).toBeTruthy();
  });
});

describe("unsubscribe badge", () => {
  // Desktop table and mobile cards both render (only CSS toggles which is
  // visible), so every assertion here is duplicate-aware.
  beforeEach(() => setLang("en"));
  afterEach(cleanup);

  const withUnsub = (u: Group["unsubscribed"]) =>
    [{ ...mk(0), unsubscribed: u }];

  it("shows done", () => {
    const { getAllByText } = renderTable({ groups: withUnsub(
      { n: 1, of: 1, status: "done", link: "", addr: "" }) });
    expect(getAllByText(/Unsubscribed/).length).toBe(2);
  });

  it("shows a link plus a mark-done button, which calls back with the addr",
    () => {
    const onAckUnsub = vi.fn();
    const { getAllByText, getAllByTitle } = renderTable({ onAckUnsub, groups:
      withUnsub({ n: 0, of: 1, status: "link",
        link: "https://x.example/unsub", addr: "news@x.example" }) });
    const links = getAllByText(/Confirm/) as HTMLAnchorElement[];
    expect(links[0].href).toBe("https://x.example/unsub");
    fireEvent.click(getAllByTitle("Mark as done")[0]);
    expect(onAckUnsub).toHaveBeenCalledWith("news@x.example");
  });

  it("shows a partial-progress badge without claiming full completion",
    () => {
    const { getAllByText } = renderTable({ groups: withUnsub(
      { n: 1, of: 3, status: "pending", link: "", addr: "" }) });
    expect(getAllByText("1/3 unsubscribed").length).toBe(2);
  });

  it("shows a failed badge", () => {
    const { getAllByText } = renderTable({ groups: withUnsub(
      { n: 0, of: 1, status: "failed", link: "", addr: "" }) });
    expect(getAllByText(/unsubscribe failed/).length).toBe(2);
  });

  it("shows nothing when never attempted", () => {
    const { queryAllByText } = renderTable({ groups: withUnsub(null) });
    expect(queryAllByText(/[Uu]nsubscri/).length).toBe(0);
  });
});

describe("new-sender badge", () => {
  beforeEach(() => setLang("en"));
  afterEach(cleanup);

  it("shows no badge for a group that isn't flagged new", () => {
    const { queryAllByText } = renderTable({ groups: [mk(0)] });
    expect(queryAllByText("New").length).toBe(0);
  });

  it("shows a New badge for a flagged group (desktop + mobile)", () => {
    const { getAllByText } = renderTable({
      groups: [{ ...mk(0), new: true }] });
    expect(getAllByText(/New/).length).toBe(2);
  });
});

describe("pinned badge", () => {
  beforeEach(() => setLang("en"));
  afterEach(cleanup);

  it("shows no pin indicator for a group without pinned mails", () => {
    const { queryAllByTitle } = renderTable({ groups: [mk(0)] });
    expect(queryAllByTitle(/protected from bulk actions/).length).toBe(0);
  });

  it("shows the pinned-mail count on the row (desktop + mobile)", () => {
    const { getAllByTitle } = renderTable({
      groups: [{ ...mk(4), pinned: 3 }] });
    const badges = getAllByTitle("3 mail(s) protected from bulk actions");
    expect(badges.length).toBe(2);
    expect(badges[0].textContent).toContain("3");
  });
});

describe("blocked badge", () => {
  // Trash/Block/Protect buttons were removed from rows entirely - single-
  // group actions live in DetailPanel now (opened via onOpen). Rows only
  // keep the informational "Blocked" tag.
  beforeEach(() => setLang("en"));
  afterEach(cleanup);

  it("shows no badge for an unblocked group", () => {
    const { queryAllByText } = renderTable({ groups: [mk(0)] });
    expect(queryAllByText("Blocked").length).toBe(0);
  });

  it("shows a Blocked badge for blocked keys", () => {
    const { getAllByText } = renderTable({
      groups: [mk(0)], blockedKeys: new Map([[mk(0).key, "rule1"]]) });
    expect(getAllByText(/Blocked/).length).toBe(2);   // desktop + mobile
  });
});

describe("row opens detail (avatar/chevron/label are all part of one tap target)", () => {
  beforeEach(() => setLang("en"));
  afterEach(cleanup);

  it("calls onOpen with the group when the mobile row is tapped", () => {
    const onOpen = vi.fn();
    const { getAllByText } = renderTable({ onOpen, groups: [mk(0)] });
    fireEvent.click(getAllByText("Sender 0")[1]);     // [0] desktop, [1] mobile
    expect(onOpen).toHaveBeenCalledWith(mk(0));
  });

  it("calls onOpen when the desktop sender button is clicked", () => {
    const onOpen = vi.fn();
    const { getAllByText } = renderTable({ onOpen, groups: [mk(0)] });
    fireEvent.click(getAllByText("Sender 0")[0]);     // desktop
    expect(onOpen).toHaveBeenCalledWith(mk(0));
  });

  it("renders an initials avatar per row (desktop + mobile)", () => {
    const { container } = renderTable({ groups: [mk(0)] });
    // "Sender 0" -> initial "S", once in the desktop table, once in the
    // mobile cards.
    expect(container.querySelectorAll("tbody td span")[0]?.textContent)
      .toBe("S");
  });
});

describe("engagement indicator", () => {
  beforeEach(() => setLang("en"));
  afterEach(cleanup);

  const eng = (score: number, over: Partial<Group> = {}): Group => ({
    ...mk(0), engagement: score, ...over });

  it.each([[10, "low", 1], [34, "medium", 2], [66, "medium", 2],
    [67, "high", 3], [100, "high", 3]])(
    "score %i renders the %s tier with %i lit bar(s)",
    (score, tier, lit) => {
      const { container } = renderTable({ groups: [eng(score)] });
      const meter = container.querySelector("tbody [data-eng]")!;
      expect(meter.getAttribute("data-eng")).toBe(tier);
      expect(meter.querySelectorAll('[data-lit="true"]').length).toBe(lit);
      expect(meter.querySelectorAll('[data-lit="false"]').length)
        .toBe(3 - lit);
    });

  it("the tooltip spells out what the score is made of", () => {
    const { container } = renderTable({ groups: [eng(12, {
      count: 100, unread: 88, replied: false, bulk: true,
      last: "2023-05-01" })] });
    expect(container.querySelector("tbody [data-eng]")!
      .getAttribute("title")).toBe(
      "Engagement 12/100 (low): 12% read, never replied, "
      + "newsletter/bulk, last mail 2023");
  });

  it("the tooltip names a replied sender and omits the bulk part", () => {
    const { container } = renderTable({ groups: [eng(90, {
      count: 4, unread: 0, replied: true, bulk: false,
      last: "2026-09-01" })] });
    expect(container.querySelector("tbody [data-eng]")!
      .getAttribute("title")).toBe(
      "Engagement 90/100 (high): 100% read, replied, last mail 2026");
  });

  it("is also shown on the mobile cards", () => {
    const { container } = renderTable({ groups: [eng(80)] });
    expect(container.querySelectorAll("[data-eng='high']").length).toBe(2);
  });

  it("the column header sorts by engagement", () => {
    const onSort = vi.fn();
    const { getByText } = renderTable({ onSort });
    fireEvent.click(getByText("Eng."));
    expect(onSort).toHaveBeenCalledWith("engagement");
  });

  it("is translated in German", () => {
    setLang("de");
    const { container, getByText } = renderTable({ groups: [eng(10)] });
    expect(container.querySelector("[data-eng]")!.getAttribute("title"))
      .toContain("Interaktion 10/100 (niedrig)");
    getByText("Inter.");
  });
});
