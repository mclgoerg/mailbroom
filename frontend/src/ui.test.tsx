// @vitest-environment jsdom
/* Menu: opens on trigger click, runs the item action and closes, and
 * closes on Escape / outside click. */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { AccountAvatar, Menu, MenuHeading, MenuItem } from "./components/ui";

afterEach(cleanup);

const renderMenu = (onPick: () => void) =>
  render(
    <Menu label="Profile" trigger={<>👤</>}>
      <MenuHeading>me@x.example</MenuHeading>
      <MenuItem onClick={onPick}>Do it</MenuItem>
    </Menu>,
  );

test("menu opens, runs the action and closes again", () => {
  const onPick = vi.fn();
  renderMenu(onPick);
  expect(screen.queryByText("Do it")).toBeNull();
  fireEvent.click(screen.getByLabelText("Profile"));
  expect(screen.getByText("me@x.example")).toBeTruthy();
  fireEvent.click(screen.getByText("Do it"));
  expect(onPick).toHaveBeenCalledOnce();
  expect(screen.queryByText("Do it")).toBeNull();     // closed after click
});

test("menu closes on Escape without running anything", () => {
  const onPick = vi.fn();
  renderMenu(onPick);
  fireEvent.click(screen.getByLabelText("Profile"));
  expect(screen.getByText("Do it")).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByText("Do it")).toBeNull();
  expect(onPick).not.toHaveBeenCalled();
});

test("MenuItem renders a sub line and marks the active row", () => {
  render(
    <Menu label="Accounts" trigger={<>👤</>}>
      <MenuItem active sub="marcel@proton.example">proton</MenuItem>
      <MenuItem active={false} sub="marcel@icloud.example">icloud</MenuItem>
    </Menu>,
  );
  fireEvent.click(screen.getByLabelText("Accounts"));
  const rows = screen.getAllByRole("menuitemradio");
  expect(rows).toHaveLength(2);
  expect(rows[0].getAttribute("aria-checked")).toBe("true");
  expect(rows[1].getAttribute("aria-checked")).toBe("false");
  expect(screen.getByText("marcel@proton.example")).toBeTruthy();
});

test("AccountAvatar shows the first letter and a stable, distinct hue "
  + "per name", () => {
  render(<>
    <AccountAvatar name="proton" />
    <AccountAvatar name="icloud" />
  </>);
  expect(screen.getByText("p")).toBeTruthy();
  expect(screen.getByText("i")).toBeTruthy();
  const [a, b] = screen.getAllByText(/^[a-z]$/);
  expect(a.className).not.toBe(b.className);       // distinct hues
});

test("menu flips to left-aligned when right-aligned would run off the " +
  "left screen edge (trigger wrapped to the start of a row)", () => {
  const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
  rect.mockReturnValue({ left: -60, right: 140, width: 200, height: 80,
    top: 0, bottom: 80, x: -60, y: 0, toJSON: () => ({}) });
  renderMenu(() => {});
  fireEvent.click(screen.getByLabelText("Profile"));
  const popover = screen.getByText("Do it").closest("div.absolute")!;
  expect(popover.className).toContain("left-0");
  expect(popover.className).not.toContain("right-0");
  rect.mockRestore();
});

test("menu stays right-aligned when it fits", () => {
  const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
  rect.mockReturnValue({ left: 120, right: 320, width: 200, height: 80,
    top: 0, bottom: 80, x: 120, y: 0, toJSON: () => ({}) });
  renderMenu(() => {});
  fireEvent.click(screen.getByLabelText("Profile"));
  const popover = screen.getByText("Do it").closest("div.absolute")!;
  expect(popover.className).toContain("right-0");
  rect.mockRestore();
});

// jsdom can't hit-test, so pin the stacking layers at class level: the
// popover must sit on the dropdown layer, above the sticky table header.
test("menu popover uses the dropdown layer", () => {
  renderMenu(vi.fn());
  fireEvent.click(screen.getByLabelText("Profile"));
  const pop = screen.getByText("Do it").closest("div.absolute")!;
  expect(pop.className).toContain("z-(--z-dropdown)");
});

test("z-index scale is strictly ordered sticky < bulkbar < dropdown < toast < modal", async () => {
  // vitest blanks CSS imports (even ?raw), so read the file from disk (cwd is frontend/).
  // @ts-expect-error node builtins have no types in this project
  const { readFileSync } = await import("node:fs");
  const indexCss: string = readFileSync("src/index.css", "utf8");
  const z = (n: string) => Number(new RegExp(`--z-${n}:\\s*(\\d+)`).exec(indexCss)?.[1]);
  const order = ["sticky", "bulkbar", "dropdown", "toast", "modal"].map(z);
  expect(order.every(Number.isFinite)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(new Set(order).size).toBe(order.length);
});
