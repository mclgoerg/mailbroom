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
