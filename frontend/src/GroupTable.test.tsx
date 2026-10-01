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
  replied: false, att_size: 0, unsubscribed: null,
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
      onTrash={noop}
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

describe("block button + blocked badge", () => {
  beforeEach(() => setLang("en"));
  afterEach(cleanup);

  it("hides the Block button and shows no badge without onBlock", () => {
    const { queryAllByText } = renderTable({ groups: [mk(0)] });
    expect(queryAllByText("Block").length).toBe(0);
    expect(queryAllByText("Blocked").length).toBe(0);
  });

  it("shows a Block button that calls back with the group", () => {
    const onBlock = vi.fn();
    const { getAllByText } = renderTable({ onBlock, groups: [mk(0)] });
    const buttons = getAllByText("Block");
    expect(buttons.length).toBe(2);           // desktop + mobile
    fireEvent.click(buttons[0]);
    expect(onBlock).toHaveBeenCalledWith(mk(0));
  });

  it("shows a Blocked badge and hides the Block button for blocked keys",
    () => {
    const onBlock = vi.fn();
    const { getAllByText, queryAllByText } = renderTable({ onBlock,
      groups: [mk(0)], blockedKeys: new Set([mk(0).key]) });
    expect(getAllByText(/Blocked/).length).toBe(2);
    expect(queryAllByText("Block").length).toBe(0);
  });
});
