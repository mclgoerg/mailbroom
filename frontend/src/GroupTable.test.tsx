// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GroupTable } from "./components/GroupTable";
import { setLang } from "./i18n";
import type { Group } from "./types";

const mk = (i: number): Group => ({
  key: `s${i}@x.example`, label: `Sender ${i}`, sub: `s${i}@x.example`,
  count: i + 1, size: 1000 * (i + 1), unread: 0,
  first: "2024-01-01", last: "2025-01-01", tags: [], samples: [],
  bulk: false, unsub: false, ai: null, ratings: null, protected: false,
  replied: false,
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
