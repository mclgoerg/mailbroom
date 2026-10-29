// @vitest-environment jsdom
/* Space map panel: drill-down + breadcrumb, the Other bucket, colour modes,
 * tick -> Done hands exactly the ticked (non-protected) sender keys over,
 * keyboard use, German. */

import { cleanup, fireEvent, render, screen, within }
  from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SpaceMapPanel } from "./components/SpaceMapPanel";
import { setLang } from "./i18n";
import type { Group } from "./types";

const MB = 1048576;
const g = (key: string, size: number, over: Partial<Group> = {}): Group => ({
  key, label: key, sub: key, count: 10, size, unread: 0, first: "2020-01-01",
  last: "2026-01-01", tags: [], samples: [], bulk: false, unsub: false,
  ai: null, ratings: null, protected: false, replied: false, att_size: 0,
  unsubscribed: null, new: false, pinned: 0, engagement: 50, ...over,
});
const groups = (...gs: Group[]) => Object.fromEntries(gs.map((x) => [x.key, x]));

const BASE = groups(
  g("a@big.example", 300 * MB, { count: 100 }),
  g("b@big.example", 500 * MB, { count: 200 }),
  g("p@big.example", 100 * MB, { count: 20, protected: true }),
  g("c@mid.example", 200 * MB, { count: 50 }),
  g("d@small.example", 100 * MB, { count: 5 }));

const onDone = vi.fn();
const show = (gs: Record<string, Group> = BASE) =>
  render(<SpaceMapPanel groups={gs} onDone={onDone} onClose={() => {}} />);
const map = () => screen.getByTestId("space-map");
const tile = (re: RegExp | string) =>
  within(map()).getByRole("button", { name: re });

afterEach(() => {
  cleanup();
  onDone.mockReset();
  setLang("en");
});

test("header total and tile labels name size and mails", () => {
  show();
  expect(screen.getByText("1.2 GB in 375 mails")).toBeTruthy();
  expect(tile("big.example, 900.0 MB, 320 mails, 1 protected sender"))
    .toBeTruthy();
});

test("tile areas are proportional to the sizes", () => {
  show();
  const areaOf = (name: string) => {
    const b = within(map()).getByRole("button", { name: new RegExp(`^${name}`) });
    return parseFloat(b.style.width) * parseFloat(b.style.height);
  };
  expect(areaOf("big.example") / areaOf("mid.example")).toBeCloseTo(4.5, 1);
  expect(areaOf("mid.example") / areaOf("small.example")).toBeCloseTo(2, 1);
});

test("drill into a domain shows its senders and a breadcrumb; All mail "
  + "goes back", () => {
  show();
  fireEvent.click(tile(/^big\.example/));
  const crumbs = screen.getByRole("navigation", { name: "Space map path" });
  expect(within(crumbs).getByText("big.example")
    .getAttribute("aria-current")).toBe("page");
  expect(within(map()).getByRole("button", { name: /^b@big\.example/ }))
    .toBeTruthy();
  expect(within(map()).queryByRole("button", { name: /^c@mid\.example/ }))
    .toBeNull();
  fireEvent.click(within(crumbs).getByRole("button", { name: "All mail" }));
  expect(within(map()).getByRole("button", { name: /^c@mid\.example|^mid\.example/ }))
    .toBeTruthy();
});

test("tiny items fold into an Other tile that drills into its own map", () => {
  const tiny = Object.fromEntries([1, 2, 3].map((i) =>
    [`t${i}@tiny${i}.example`, g(`t${i}@tiny${i}.example`, MB, { count: 1 })]));
  show({ ...groups(g("a@big.example", 900 * MB)), ...tiny });
  fireEvent.click(tile(/^Other \(3\)/));
  const crumbs = screen.getByRole("navigation", { name: "Space map path" });
  expect(within(crumbs).getByText("Other (3)")).toBeTruthy();
  for (const i of [1, 2, 3]) {
    expect(screen.getAllByRole("button", { name: new RegExp(`^tiny${i}\\.example`) })
      .length).toBeGreaterThan(0);
  }
});

test("colour modes: AI verdict only when something is rated; legend follows",
  () => {
    const { unmount } = show();
    expect(screen.queryByRole("tab", { name: "AI verdict" })).toBeNull();
    expect(screen.getByText("Rarely opened")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Age of last mail" }));
    expect(screen.getByText("Last mail over 2 years ago")).toBeTruthy();
    unmount();
    show(groups(g("a@big.example", MB, { ai: { verdict: "keep", reason: "" } })));
    fireEvent.click(screen.getByRole("tab", { name: "AI verdict" }));
    expect(screen.getByText("Not rated")).toBeTruthy();
    expect(screen.getByText("Delete-safe")).toBeTruthy();
  });

test("select a domain tile -> Done hands over its non-protected senders",
  () => {
    show();
    expect(screen.queryByText(/selected$/)).toBeNull();     // no bar before Select
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.getByRole("button", { name: "Done" })
      .hasAttribute("disabled")).toBe(true);
    fireEvent.click(tile(/^big\.example/));
    expect(screen.getByText("2 senders - 800.0 MB selected")).toBeTruthy();
    expect(screen.getByText("Protected senders can't be selected here."))
      .toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect([...onDone.mock.calls[0][0]].sort())
      .toEqual(["a@big.example", "b@big.example"]);
  });

test("Done hands over exactly the ticked keys across levels", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  fireEvent.click(tile(/^mid\.example/));
  // tick a whole domain through its list checkbox, then untick it again
  fireEvent.click(screen.getByRole("checkbox", { name: "Select big.example" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select big.example" }));
  // drill through the list link and tick one single sender
  fireEvent.click(screen.getAllByRole("button", { name: "big.example" })[0]);
  fireEvent.click(within(map()).getByRole("button", { name: /^a@big\.example/ }));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect([...onDone.mock.calls[0][0]].sort())
    .toEqual(["a@big.example", "c@mid.example"]);
});

test("a tile of only protected senders can't be ticked", () => {
  show(groups(g("p@z.example", 500 * MB, { protected: true }),
    g("a@y.example", 100 * MB)));
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  const t = within(map()).getByRole("button", { name: /^z\.example/ });
  expect(t.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(t);
  expect(screen.getByRole("button", { name: "Done" })
    .hasAttribute("disabled")).toBe(true);
});

test("a sender tile in browse mode starts a selection with it", () => {
  show();
  fireEvent.click(tile(/^small\.example/));
  fireEvent.click(within(map()).getByRole("button", { name: /^d@small\.example/ }));
  expect(screen.getByText("1 sender - 100.0 MB selected")).toBeTruthy();
});

test("tiles are native, focusable buttons with a full label", () => {
  show();
  const tiles = within(map()).getAllByRole("button");
  expect(tiles.length).toBeGreaterThan(2);
  for (const t of tiles) {
    expect(t.tagName).toBe("BUTTON");
    expect(t.tabIndex).toBeGreaterThanOrEqual(0);
    expect(t.getAttribute("aria-label")).toMatch(/, \d.*, \d+ mails?/);
  }
  tiles[0].focus();
  expect(document.activeElement).toBe(tiles[0]);
});

test("the accessible list names the biggest of the level", () => {
  show();
  const rows = screen.getAllByRole("listitem")
    .filter((li) => li.textContent?.includes("·"));
  expect(rows[0].textContent).toContain("big.example");
  expect(rows[0].textContent).toContain("900.0 MB");
});

test("empty mailbox: a hint instead of a map", () => {
  show({});
  expect(screen.getByText("Nothing to map yet - run a scan first.")).toBeTruthy();
});

test("German", () => {
  setLang("de");
  show();
  expect(screen.getByText("1.2 GB in 375 Mails")).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Alter der letzten Mail" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Auswählen" }));
  fireEvent.click(tile(/^mid\.example/));
  expect(screen.getByText("1 Absender - 200.0 MB ausgewählt")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Fertig" })).toBeTruthy();
});
