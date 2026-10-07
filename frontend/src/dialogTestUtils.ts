import { DIALOG_ARM_MS } from "./components/ui";
import { expect } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

/** The open confirm/prompt sheet (waits for it to appear). Panels are
 *  dialogs too, so only the titled sheets (aria-labelledby) count. */
export const findDialog = () => waitFor(() => {
  const sheets = screen.queryAllByRole("dialog")
    .filter((d) => d.hasAttribute("aria-labelledby"));
  if (!sheets.length) throw new Error("no confirm/prompt dialog is open");
  return sheets.at(-1)!;
});

/** Click a button of the open dialog, e.g. `await pressDialog(/Block/)`.
 *  Waits out the dialog's arming delay first (a confirm tapped right after
 *  opening is ignored on purpose); Cancel is never delayed. */
export async function pressDialog(name: string | RegExp): Promise<void> {
  const dlg = await findDialog();
  if (name !== "Cancel") await new Promise((r) => setTimeout(r, DIALOG_ARM_MS + 30));
  fireEvent.click(within(dlg).getByRole("button", { name }));
}

export const cancelDialog = () => pressDialog("Cancel");

/** Settles pending promises/effects, then asserts no confirm/prompt sheet
 *  is open - use before a "cancel did nothing" assertion so it can't pass
 *  merely because the action hadn't run yet. */
export async function expectNoDialog(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryAllByRole("dialog")
    .filter((d) => d.hasAttribute("aria-labelledby"))).toHaveLength(0);
}
