// @vitest-environment jsdom
/* Menu: opens on trigger click, runs the item action and closes, and
 * closes on Escape / outside click. */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { Menu, MenuHeading, MenuItem } from "./components/ui";

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
