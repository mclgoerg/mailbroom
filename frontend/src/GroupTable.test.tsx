// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupTable, localizedSub } from "./components/GroupTable";
import { EngagementMeter, PinBadge, TrackerBadge } from "./components/ui";
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


// The engagement meter, tracker and pin badges left the rows for the detail
// header; their own behaviour (popovers, tooltips, not opening a row they
// sit in) is still tested here in a row-shaped host.
function renderBadges({ groups: [g], onOpen = noop }: {
  groups: Group[]; onOpen?: (g: Group) => void;
}) {
  return render(
    <table><tbody>
      <tr onClick={() => onOpen(g)}><td>
        <EngagementMeter g={g} /><TrackerBadge g={g} /><PinBadge n={g.pinned} />
      </td></tr>
    </tbody></table>,
  );
}

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
    const { container, getByText, getByRole } = renderTable();
    fireEvent.click(getByRole("button", { name: "Next page" }));
    getByText("Page 2 / 3");
    expect(container.querySelector("tbody tr")!.textContent)
      .toContain("Sender 50");
    fireEvent.click(getByRole("button", { name: "Last page" }));
    getByText("Page 3 / 3");
    expect(rows(container)).toBe(20);
    fireEvent.click(getByRole("button", { name: "First page" }));
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

describe("unsubscribe pill", () => {
  // Desktop table and mobile cards both render (only CSS toggles which is
  // visible), so every assertion here is duplicate-aware.
  beforeEach(() => setLang("en"));
  afterEach(cleanup);

  const withUnsub = (u: Group["unsubscribed"]) =>
    [{ ...mk(0), unsubscribed: u }];

  it("shows done as an info pill", () => {
    const { getAllByText } = renderTable({ groups: withUnsub(
      { n: 1, of: 1, status: "done", link: "", addr: "" }) });
    expect(getAllByText("Unsubscribed").length).toBe(2);
  });

  it("a page to confirm is a hint only: no link, no mark-done on the row",
    () => {
    const onOpen = vi.fn();
    const { container, getAllByText, queryAllByTitle } = renderTable({
      onOpen, groups: withUnsub({ n: 0, of: 1, status: "link",
        link: "https://x.example/unsub", addr: "news@x.example" }) });
    expect(getAllByText("Confirm on page").length).toBe(2);
    expect(container.querySelector("a[href]")).toBeNull();
    expect(queryAllByTitle("Mark as done").length).toBe(0);
    // the pill is not a control: a click on it opens the row like any other
    fireEvent.click(getAllByText("Confirm on page")[0]
      .closest("tr")!.querySelector("td:nth-child(4)")!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("shows a partial-progress pill without claiming full completion",
    () => {
    const { getAllByText } = renderTable({ groups: withUnsub(
      { n: 1, of: 3, status: "pending", link: "", addr: "" }) });
    expect(getAllByText("1/3 unsubscribed").length).toBe(2);
  });

  it("shows a failed pill", () => {
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
    const { queryAllByTitle } = renderBadges({ groups: [mk(0)] });
    expect(queryAllByTitle(/protected from bulk actions/).length).toBe(0);
  });

  it("shows the pinned-mail count on the row", () => {
    const { getAllByTitle } = renderBadges({
      groups: [{ ...mk(4), pinned: 3 }] });
    const badges = getAllByTitle("3 mails protected from bulk actions");
    expect(badges.length).toBe(1);
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
      const { container } = renderBadges({ groups: [eng(score)] });
      const meter = container.querySelector("[data-eng]")!;
      expect(meter.getAttribute("data-eng")).toBe(tier);
      expect(meter.querySelectorAll('[data-lit="true"]').length).toBe(lit);
      expect(meter.querySelectorAll('[data-lit="false"]').length)
        .toBe(3 - lit);
    });

  it("the tooltip spells out what the score is made of", () => {
    const { container } = renderBadges({ groups: [eng(12, {
      count: 100, unread: 88, replied: false, bulk: true,
      last: "2023-05-01" })] });
    expect(container.querySelector("[data-eng]")!
      .getAttribute("title")).toBe(
      "Engagement 12/100 (low): 12% read, never replied, "
      + "newsletter/bulk, last mail 2023");
  });

  it("the tooltip names a replied sender and omits the bulk part", () => {
    const { container } = renderBadges({ groups: [eng(90, {
      count: 4, unread: 0, replied: true, bulk: false,
      last: "2026-09-01" })] });
    expect(container.querySelector("[data-eng]")!
      .getAttribute("title")).toBe(
      "Engagement 90/100 (high): 100% read, replied, last mail 2026");
  });

  it("tapping the meter opens a popover naming the score and its parts "
    + "(touch screens have no hover)", () => {
    const { container, getByRole, queryByRole } = renderBadges({
      groups: [eng(12, { count: 100, unread: 88, bulk: true,
        last: "2023-05-01" })] });
    expect(queryByRole("dialog")).toBeNull();
    fireEvent.click(container.querySelector("[data-eng]")!);
    const pop = getByRole("dialog");
    expect(pop.textContent).toContain("Engagement score 12/100 · low");
    expect(pop.textContent).toContain(
      "12% read · never replied · newsletter/bulk · last mail 2023");
    // toggles closed again
    fireEvent.click(container.querySelector("[data-eng]")!);
    expect(queryByRole("dialog")).toBeNull();
  });

  it("the popover closes on outside tap and on Escape", () => {
    const { container, queryByRole } = renderBadges({ groups: [eng(50)] });
    const meter = () => container.querySelector("[data-eng]")!;
    fireEvent.click(meter());
    expect(queryByRole("dialog")).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(queryByRole("dialog")).toBeNull();
    fireEvent.click(meter());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(queryByRole("dialog")).toBeNull();
  });

  it("the popover flips to the right edge when it would overflow", () => {
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
    rect.mockReturnValue({ left: 300, right: window.innerWidth + 40,
      width: 240, height: 60, top: 0, bottom: 60, x: 300, y: 0,
      toJSON: () => ({}) });
    const { container, getByRole } = renderBadges({ groups: [eng(50)] });
    fireEvent.click(container.querySelector("[data-eng]")!);
    expect(getByRole("dialog").className).toContain("right-0");
    rect.mockRestore();
  });

  it("is translated in German", () => {
    setLang("de");
    const { container } = renderBadges({ groups: [eng(10)] });
    expect(container.querySelector("[data-eng]")!.getAttribute("title"))
      .toContain("Interaktion 10/100 (niedrig)");
  });
});

describe("GroupTable stacking", () => {
  afterEach(cleanup);

  it("keeps the sticky header on the sticky layer, below popovers", () => {
    const { container } = renderTable();
    const tr = container.querySelector("thead tr")!;
    expect(tr.className).toContain("z-(--z-sticky)");
  });
});

describe("GroupTable rows and header", () => {
  beforeEach(() => setLang("en"));
  afterEach(cleanup);

  it("a row is avatar, name, one meta line, mails over size and a chevron", () => {
    const g = { ...mk(2), count: 76, unread: 57, size: 7.2 * 1024 * 1024 };
    const { container } = renderTable({ groups: [g] });
    const row = container.querySelector("tbody tr")!;
    expect(row.querySelectorAll("td").length).toBe(6);
    const meta = row.querySelector("td:nth-child(3) div:last-child")!;
    expect(meta.textContent).toBe("75% unread · last 1 Jan 2025");
    expect(meta.querySelector("time")!.getAttribute("title"))
      .toBe("2025-01-01");
    const num = row.querySelector("td:nth-child(5)")!;
    expect(num.className).toContain("whitespace-nowrap");
    expect(num.children[0].textContent).toBe("76");
    expect(num.children[0].className).toContain("font-semibold");
    expect(num.children[1].textContent).toBe("7.2 MB");
  });

  it("the header keeps Name / Mails / Size sortable and drops the rest", () => {
    const onSort = vi.fn();
    const { container, getByText, queryByText } = renderTable({ onSort });
    const head = container.querySelector("thead")!;
    for (const gone of ["Engagement", "AI", "Last", "Status & tags"]) {
      expect(queryByText(gone)).toBeNull();
    }
    fireEvent.click(getByText("Size"));
    fireEvent.click(getByText("Mails"));
    fireEvent.click(getByText("Sender"));
    expect(onSort.mock.calls.map((c) => c[0]))
      .toEqual(["size", "count", "label"]);
    expect(head.querySelectorAll("button").length).toBe(3);
  });

  it("marks only the sorted column with aria-sort", () => {
    const { container } = renderTable();
    const sorted = container.querySelectorAll("th[aria-sort]");
    expect(sorted.length).toBe(1);
    expect(sorted[0].getAttribute("aria-sort")).toBe("descending");
    expect(sorted[0].textContent).toBe("MailsSize");
  });

  it("opens the detail from a row click, but not from the checkbox column, buttons or a text selection", () => {
    const onOpen = vi.fn();
    const { container } = renderTable({ onOpen, groups: [mk(0)],
      selectMode: true });
    const row = container.querySelector("tbody tr")!;
    const tds = row.querySelectorAll("td");
    fireEvent.click(row.querySelector("input[type=checkbox]")!);
    fireEvent.click(tds[0]);                       // checkbox cell, beside the box
    expect(onOpen).not.toHaveBeenCalled();
    const sel = vi.spyOn(window, "getSelection").mockReturnValue(
      { toString: () => "some text" } as Selection);
    fireEvent.click(tds[4]);
    expect(onOpen).not.toHaveBeenCalled();
    sel.mockRestore();
    fireEvent.click(tds[4]);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(tds[3]);                       // the pill cell opens too
    expect(onOpen).toHaveBeenCalledTimes(2);
    fireEvent.click(row.querySelector("button[aria-label='View details']")!);
    expect(onOpen).toHaveBeenCalledTimes(3);
  });
});

describe("GroupTable select mode", () => {
  beforeEach(() => setLang("en"));
  afterEach(cleanup);

  const hidden = (el: Element) => el.className.includes("opacity-0");
  const rowBox = (c: HTMLElement) =>
    c.querySelector("tbody tr td:first-child label")!;
  const headBox = (c: HTMLElement) =>
    c.querySelector("thead th:first-child label")!;
  const cardChecks = (c: HTMLElement) =>
    c.querySelectorAll(".md\\:hidden [data-gidx] input[type=checkbox]");

  it("desktop: checkboxes wait for hover / focus until something is "
    + "selected or select mode is on", () => {
    const idle = renderTable({ groups: [mk(0)] });
    expect(hidden(rowBox(idle.container))).toBe(true);
    expect(hidden(headBox(idle.container))).toBe(true);
    expect(rowBox(idle.container).className).toContain(
      "hoverable:group-hover/row:opacity-100");
    expect(rowBox(idle.container).className).toContain(
      "focus-within:opacity-100");
    idle.unmount();
    const sel = renderTable({ groups: [mk(0)], selected: new Set([mk(0).key]) });
    expect(hidden(rowBox(sel.container))).toBe(false);
    expect(hidden(headBox(sel.container))).toBe(false);
    sel.unmount();
    const mode = renderTable({ groups: [mk(0)], selectMode: true });
    expect(hidden(rowBox(mode.container))).toBe(false);
    expect(hidden(headBox(mode.container))).toBe(false);
  });

  it("a hidden checkbox is inert on touch (the tap opens the row)", () => {
    const { container } = renderTable({ groups: [mk(0)] });
    expect(rowBox(container).className).toContain("coarse:pointer-events-none");
  });

  it("phone cards have no checkboxes outside select mode", () => {
    const idle = renderTable({ groups: [mk(0), mk(1)] });
    expect(cardChecks(idle.container).length).toBe(0);
    idle.unmount();
    const mode = renderTable({ groups: [mk(0), mk(1)], selectMode: true });
    expect(cardChecks(mode.container).length).toBe(2);
    mode.unmount();
    const sel = renderTable({ groups: [mk(0)], selected: new Set([mk(0).key]) });
    expect(cardChecks(sel.container).length).toBe(1);
  });

  it("the list inside a detail panel (cards) always shows its checks", () => {
    const { container } = renderTable({ groups: [mk(0)], cards: true });
    expect(container.querySelector("tbody")).toBeNull();
    expect(container.querySelectorAll("[data-gidx] input[type=checkbox]")
      .length).toBe(1);
  });

  it("a tap on the card's check gutter toggles selection without opening the detail", () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const { container } = renderTable({ groups: [mk(1)], onOpen, onToggle,
      selectMode: true });
    const card = container.querySelector(".md\\:hidden [data-gidx]")!;
    const gutter = card.querySelector("label")!;
    expect(gutter.className).toContain("w-11");
    expect(gutter.className).toContain("self-stretch");
    // The open-detail area is a sibling of the gutter, never an ancestor.
    expect(gutter.nextElementSibling!.contains(gutter)).toBe(false);
    fireEvent.click(gutter.querySelector("input")!);
    expect(onToggle).toHaveBeenCalledWith(mk(1).key);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(gutter);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(gutter.nextElementSibling!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("select-all in the header selects the shown page", () => {
    const onToggleAll = vi.fn();
    const { getByLabelText } = renderTable({ onToggleAll, selectMode: true });
    fireEvent.click(getByLabelText("Select all"));
    expect(onToggleAll).toHaveBeenCalledWith(true,
      groups.slice(0, 50).map((g) => g.key));
  });

  it("selected rows get the lighter panel, not an accent tint", () => {
    const { container } = renderTable({ groups: [mk(0), mk(1)],
      selected: new Set([mk(0).key]) });
    const [a, b] = container.querySelectorAll("tbody tr");
    expect(a.className).toContain("bg-panel2");
    expect(a.className).not.toContain("accent-tint");
    expect(b.className).not.toMatch(/(^| )bg-panel2( |$)/);
  });

  it("keeps rows to the two text lines (no tag cell, no wrapping badges)", () => {
    const { container } = renderTable({ groups: [{ ...mk(0), new: true,
      tags: ["newsletter"], att_size: 5000, pinned: 2, replied: true }] });
    expect(container.textContent).not.toContain("newsletter");
    expect(container.textContent).not.toMatch(/KB|protected/);
    expect(container.querySelector("tbody tr")!.querySelectorAll("td").length)
      .toBe(6);
  });
});

describe("GroupTable avatars and phone cards", () => {
  beforeEach(() => setLang("en"));
  afterEach(cleanup);

  const avatars = (c: HTMLElement) =>
    [...c.querySelectorAll("tbody tr td:nth-child(2) > *")];

  it("thread rows use the first sender's avatar, never the subject letter", () => {
    const g = { ...mk(0), label: "Re: Quarterly plan", samples: ["news@x.example"] };
    const { container } = renderTable({ groups: [g], grouping: "thread" });
    expect(avatars(container)[0].textContent).toBe("n");
    const letters = [...container.querySelectorAll("span.rounded-full")]
      .map((a) => a.textContent);
    expect(letters).toEqual(["n", "n"]);                // table + card, no "R"
  });

  it("a thread without a known sender gets a neutral icon avatar", () => {
    const g = { ...mk(0), label: "Quarterly plan", samples: [] };
    const { container } = renderTable({ groups: [g], grouping: "thread" });
    const av = avatars(container)[0];
    expect(av.textContent).toBe("");                    // no letter at all
    expect(av.querySelector("svg")).toBeTruthy();
    expect(av.className).toContain("bg-chip");
  });

  it("Smart pools get a kind icon, own rows keep the letter", () => {
    const pooled = { ...mk(0), label: "Newsletters", kind: "newsletter" as const,
      n_senders: 12, members: [] };
    const { container } = renderTable({ groups: [pooled], grouping: "smart" });
    const av = avatars(container)[0];
    expect(av.textContent).toBe("");
    expect(av.querySelector("svg")).toBeTruthy();
    const own = { ...mk(0), label: "Shop", kind: "sender" as const,
      addr: "a@x.example" };
    const o = renderTable({ groups: [own], grouping: "smart" });
    expect(avatars(o.container).at(-1)!.textContent).toBe("S");
  });

  it("other groupings keep the letter avatar", () => {
    const { container } = renderTable({ groups: [mk(0)], grouping: "sender" });
    expect(avatars(container)[0].textContent).toBe("S");
  });

  it("a phone card's title is a real button that opens the detail once", () => {
    const onOpen = vi.fn();
    const { container } = renderTable({ groups: [mk(0)], onOpen });
    const card = container.querySelector(".md\\:hidden")!;
    const title = card.querySelector("button[data-no-open]") as HTMLElement;
    expect(title.textContent).toBe("Sender 0");
    fireEvent.click(title);
    expect(onOpen).toHaveBeenCalledTimes(1);            // not twice (bubbling)
    fireEvent.click(card.querySelector(".cursor-pointer.gap-3")!);
    expect(onOpen).toHaveBeenCalledTimes(2);            // the card body still works
  });
});

describe("GroupTable status pill (one per row, first match wins)", () => {
  beforeEach(() => setLang("en"));
  afterEach(cleanup);

  const sm = { since: "2025-02-01", n: 3, last: "2025-03-01" } as
    unknown as NonNullable<Group["still_mailing"]>;
  const link = { n: 0, of: 1, status: "link", link: "https://x.example/u",
    addr: "a@x.example" } as Group["unsubscribed"];
  const done = { n: 1, of: 1, status: "done", link: "", addr: "" } as
    Group["unsubscribed"];
  const ai = { verdict: "delete_safe", reason: "r" } as Group["ai"];
  const everything = { ...mk(0), still_mailing: sm, unsubscribed: link,
    new: true, ai, replied: true };
  const blocked = new Map([[mk(0).key, "rule1"]]);

  /** The pill text of the desktop row (the mobile card shows the same). */
  const pillOf = (g: Group, blockedKeys?: Map<string, string>) => {
    const { container, unmount } = renderTable({ groups: [g], blockedKeys });
    const cell = container.querySelector("tbody tr td:nth-child(4)")!;
    const text = cell.textContent;
    const pills = cell.querySelectorAll("span.type-caption").length;
    const cardPills = container.querySelectorAll(
      ".md\\:hidden .type-caption").length;
    unmount();
    return { text, pills, cardPills };
  };

  it.each([
    ["Still mailing", everything, blocked],
    ["Confirm on page", { ...everything, still_mailing: null }, blocked],
    ["Blocked", { ...everything, still_mailing: null, unsubscribed: done },
      blocked],
    ["New", { ...everything, still_mailing: null, unsubscribed: done }, undefined],
    ["delete safe", { ...everything, still_mailing: null, new: false,
      unsubscribed: done }, undefined],
    ["Unsubscribed", { ...everything, still_mailing: null, new: false,
      ai: null, unsubscribed: done }, undefined],
    ["replied", { ...everything, still_mailing: null, new: false,
      ai: null, unsubscribed: null }, undefined],
  ] as [string, Group, Map<string, string> | undefined][])(
    "%s outranks everything below it", (want, g, b) => {
    const { text, pills, cardPills } = pillOf(g, b);
    expect(text).toContain(want);
    expect(pills).toBeGreaterThanOrEqual(1);
    expect(text!.match(/Still mailing|Confirm on page|Blocked|New|delete safe|Unsubscribed|replied/g))
      .toHaveLength(1);
    expect(cardPills).toBe(pills);
  });

  it("an AI review / keep verdict gets its own tone", () => {
    const { container } = renderTable({ groups: [{ ...mk(0),
      ai: { verdict: "keep", reason: "r" } as Group["ai"] }] });
    const p = container.querySelector("tbody tr td:nth-child(4) .type-caption")!;
    expect(p.className).toContain("bg-keep-bg");
    expect(p.className).toContain("rounded-full");
  });

  it("a row without any state has no pill and no empty line on the card", () => {
    const { container } = renderTable({ groups: [mk(0)] });
    expect(container.querySelector("tbody tr td:nth-child(4)")!.textContent)
      .toBe("");
    expect(container.querySelectorAll(".md\\:hidden .type-caption").length)
      .toBe(0);
  });

  it("the pill is a status, not a control (the row opens from it)", () => {
    const { container } = renderTable({ groups: [{ ...mk(0), new: true }] });
    const cell = container.querySelector("tbody tr td:nth-child(4)")!;
    expect(cell.querySelector("button, a")).toBeNull();
  });

  it("the Still mailing pill keeps its explanatory popover", () => {
    const { container, getByRole } = renderTable({ groups: [everything] });
    fireEvent.click(container.querySelector("tbody [data-still-mailing]")!);
    expect(getByRole("dialog").textContent).toContain("Still mailing");
  });
});

describe("localizedSub", () => {
  afterEach(() => setLang("en"));
  it("translates the backend's thread / subject summaries, leaves addresses alone", () => {
    setLang("de");
    expect(localizedSub("2 mails, 1 sender")).toBe("2 Mails, 1 Absender");
    expect(localizedSub("1 mail, 3 senders")).toBe("1 Mail, 3 Absender");
    expect(localizedSub("4 senders")).toBe("4 Absender");
    expect(localizedSub("news@shop.example")).toBe("news@shop.example");
    setLang("en");
    expect(localizedSub("1 mail, 3 senders")).toBe("1 mail, 3 senders");
  });
});

describe("GroupTable focus", () => {
  afterEach(cleanup);
  it("moves focus to the replacement row, or the list when none is left", () => {
    const { container, rerender } = renderTable({ groups: [mk(0), mk(1)] });
    const row = container.querySelector("tbody tr button") as HTMLElement;
    row.focus();
    expect(document.activeElement).toBe(row);
    rerender(<GroupTable groups={[mk(1)]} selected={new Set()} focusedKey={null}
      onToggle={noop} onToggleAll={noop} onOpen={noop}
      sortK="count" sortDir={-1} onSort={noop} groupLabel="Sender" resetSignal="a" />);
    expect(row.isConnected).toBe(false);
    expect(document.activeElement!.textContent).toBe("Sender 1");  // took its place
    document.querySelector<HTMLElement>("tbody tr button")!.focus();
    rerender(<GroupTable groups={[]} selected={new Set()} focusedKey={null}
      onToggle={noop} onToggleAll={noop} onOpen={noop}
      sortK="count" sortDir={-1} onSort={noop} groupLabel="Sender" resetSignal="a" />);
    expect(document.activeElement)                    // no rows left: the list
      .toBe(container.querySelector("[data-focus-return]"));
  });

  it("does not steal focus when it was never in the list", () => {
    const { rerender } = renderTable({ groups: [mk(0)] });
    rerender(<GroupTable groups={[mk(1)]} selected={new Set()} focusedKey={null}
      onToggle={noop} onToggleAll={noop} onOpen={noop}
      sortK="count" sortDir={-1} onSort={noop} groupLabel="Sender" resetSignal="a" />);
    expect(document.activeElement).toBe(document.body);
  });
});

describe("GroupTable focus lands on the row that took the place", () => {
  afterEach(cleanup);
  const re = (groups: Group[]) => (<GroupTable groups={groups} selected={new Set()}
    focusedKey={null} onToggle={noop} onToggleAll={noop} onOpen={noop}
    sortK="count" sortDir={-1} onSort={noop}
    groupLabel="Sender" resetSignal="a" />);
  it("focuses the next row, or the previous when the last one was removed", () => {
    const { container, rerender } = render(re([mk(0), mk(1), mk(2)]));
    const title = (i: number) => container.querySelectorAll("tbody tr")[i]
      .querySelector("button") as HTMLElement;
    title(1).focus();
    rerender(re([mk(0), mk(2)]));                    // row 1 trashed
    expect(document.activeElement).toBe(title(1));   // now Sender 2's button
    expect(document.activeElement!.textContent).toBe("Sender 2");
    rerender(re([mk(0), mk(2)].slice(0, 2)));
    title(1).focus();
    rerender(re([mk(0)]));                           // the last one trashed
    expect(document.activeElement!.textContent).toBe("Sender 0");
  });
});

describe("tracker badge", () => {
  beforeEach(() => setLang("en"));
  afterEach(cleanup);

  const tracked = (trackers?: Group["trackers"]): Group =>
    ({ ...mk(0), trackers });

  it("is absent without tracker data or without tracking", () => {
    for (const g of [tracked(undefined),
      tracked({ checked: 4, pixel: 0, click: 0, hosts: [] })]) {
      const { container, unmount } = renderBadges({ groups: [g] });
      expect(container.querySelector('[aria-label^="Tracks"]')).toBeNull();
      unmount();
    }
  });

  it.each([
    [{ checked: 4, pixel: 2, click: 0, hosts: ["t.example"] }, "Tracks opens"],
    [{ checked: 4, pixel: 0, click: 1, hosts: ["t.example"] },
      "Tracks clicks"],
    [{ checked: 4, pixel: 2, click: 1, hosts: ["t.example"] },
      "Tracks opens and clicks"],
  ])("labels what it tracks (%#)", (trackers, label) => {
    const { container } = renderBadges({ groups: [tracked(trackers)] });
    expect(container.querySelector(`[aria-label="${label}"]`))
      .not.toBeNull();
  });

  it("tapping it opens a popover with the share and the hosts, and does "
    + "not open the row", () => {
    const onOpen = vi.fn();
    const { container, getByRole } = renderBadges({ onOpen, groups: [tracked({
      checked: 4, pixel: 3, click: 1, hosts: ["t.example", "u.example"] })] });
    fireEvent.click(container.querySelector(
      '[aria-label="Tracks opens and clicks"]')!);
    const pop = getByRole("dialog");
    expect(pop.textContent).toContain("3 of 4 checked mails contain a "
      + "tracking pixel");
    expect(pop.textContent).toContain("1 of 4 checked mails contain "
      + "click-tracking links");
    expect(pop.textContent).toContain("Hosts: t.example, u.example");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("is translated", () => {
    setLang("de");
    const { container } = renderBadges({ groups: [tracked({
      checked: 4, pixel: 3, click: 0, hosts: [] })] });
    expect(container.querySelector('[aria-label="Verfolgt Öffnungen"]'))
      .not.toBeNull();
  });
});

