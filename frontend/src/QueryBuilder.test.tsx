// @vitest-environment jsdom
/* The filter builder must emit exactly the DSL that parseFilter reads -
 * clicking conditions together yields a query users could have typed. */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { QueryBuilder } from "./components/QueryBuilder";
import { parseFilter } from "./lib";

afterEach(cleanup);

function setup(initial = "") {
  let value = initial;
  const onChange = vi.fn((q: string) => { value = q; });
  const view = render(
    <QueryBuilder value={value} onChange={onChange} />);
  const rerender = () =>
    view.rerender(<QueryBuilder value={value} onChange={onChange} />);
  fireEvent.click(screen.getByTitle(/Build a filter/));
  return { onChange, get: () => value, rerender };
}

test("clicking conditions appends valid DSL tokens", () => {
  const s = setup();
  // default tag is "newsletter"
  fireEvent.click(screen.getAllByText("Add")[0]);
  expect(s.get()).toBe("tag:newsletter");
  s.rerender();
  fireEvent.click(screen.getByText("with unsubscribe link"));
  expect(s.get()).toBe("tag:newsletter is:unsub");
  s.rerender();
  // age row: 1 + years by default -> age:>1y (third Add button)
  fireEvent.click(screen.getAllByText("Add")[2]);
  expect(s.get()).toBe("tag:newsletter is:unsub age:>1y");
  // …and the result round-trips through the real parser
  const f = parseFilter(s.get());
  expect(f.tags).toEqual(["newsletter"]);
  expect(f.unsub).toBe(true);
  expect(f.ageMonths).toBe(12);
});

test("not-yet-unsubscribed chip emits the DSL token", () => {
  const s = setup();
  fireEvent.click(screen.getByText("not yet unsubscribed"));
  expect(s.get()).toBe("is:not-unsubscribed");
  expect(parseFilter(s.get()).unsubscribed).toBe(false);
});

test("fully-unsubscribed chip emits the DSL token", () => {
  const s = setup();
  fireEvent.click(screen.getByText("fully unsubscribed"));
  expect(s.get()).toBe("is:unsubscribed");
  expect(parseFilter(s.get()).unsubscribed).toBe(true);
});

test("new-senders chip emits the is:new DSL token", () => {
  const s = setup();
  fireEvent.click(screen.getByText("new senders"));
  expect(s.get()).toBe("is:new");
  expect(parseFilter(s.get()).newOnly).toBe(true);
});

test("tokens are never added twice", () => {
  const s = setup("is:unsub");
  fireEvent.click(screen.getByText("with unsubscribe link"));
  expect(s.onChange).not.toHaveBeenCalled();
});

test("clear empties the query", () => {
  const s = setup("tag:social is:unsub");
  fireEvent.click(screen.getByText("Clear"));
  expect(s.get()).toBe("");
});

test("protected-mails chip emits the has:pinned DSL token", () => {
  const s = setup();
  fireEvent.click(screen.getByText("with protected mails"));
  expect(s.get()).toBe("has:pinned");
  expect(parseFilter(s.get()).pinnedOnly).toBe(true);
});

test.each([
  ["rarely engaged with", "eng:low"],
  ["sometimes engaged with", "eng:medium"],
  ["often engaged with", "eng:high"],
])("engagement chip '%s' emits the %s DSL token", (label, token) => {
  const s = setup();
  fireEvent.click(screen.getByText(label));
  expect(s.get()).toBe(token);
  expect(parseFilter(s.get()).eng).toBe(token.slice(4));
});

test("every row adds its own token, Add buttons are one per row", () => {
  const s = setup();
  const adds = screen.getAllByText("Add");
  expect(adds).toHaveLength(5);
  fireEvent.click(adds[1]);
  expect(s.get()).toBe("ai:safe");
  s.rerender();
  fireEvent.click(adds[3]);
  expect(s.get()).toBe("ai:safe unread:>80");
  s.rerender();
  fireEvent.click(adds[4]);
  expect(s.get()).toBe("ai:safe unread:>80 att:>10m");
});

test("on desktop the builder is a popover; Done closes it", () => {
  setup();
  expect(screen.getByText("Build a filter")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByText("Done"));
  expect(screen.queryByText("Build a filter")).toBeNull();
});

test("on phones it opens as a bottom sheet and Done / Esc close it", () => {
  const mq = vi.fn((q: string) => ({ matches: q.includes("max-width: 639px"),
    addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal("matchMedia", mq);
  window.matchMedia = mq as unknown as typeof window.matchMedia;
  try {
    const s = setup("tag:social");
    const sheet = screen.getByRole("dialog");
    expect(sheet.getAttribute("data-size")).toBe("sm");
    expect(sheet.textContent).toContain("Build a filter");
    expect(sheet.textContent).toContain("tag:social");   // current query
    // phones get icon-only Add buttons (named for AT)
    expect(screen.queryByText("Add")).toBeNull();
    expect(document.activeElement).toBe(screen.getByText("Build a filter"));
    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]);
    expect(s.get()).toBe("tag:social tag:newsletter");
    fireEvent.click(screen.getByText("Done"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTitle(/Build a filter/));
    fireEvent.click(screen.getByTitle(/Build a filter/));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  } finally {
    vi.unstubAllGlobals();
    // @ts-expect-error jsdom has no matchMedia by default
    delete window.matchMedia;
  }
});

test("closing the popover returns focus to the trigger (Done and Esc)", () => {
  setup();
  fireEvent.click(screen.getByText("Done"));
  expect(document.activeElement).toBe(screen.getByTitle(/Build a filter/));
  fireEvent.click(screen.getByTitle(/Build a filter/));
  expect(screen.getByText("Build a filter")).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByText("Build a filter")).toBeNull();
  expect(document.activeElement).toBe(screen.getByTitle(/Build a filter/));
});
