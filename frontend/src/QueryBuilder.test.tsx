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
