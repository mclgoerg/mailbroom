import { fireEvent, screen, waitFor, within } from "@testing-library/react";

/** The open confirm/prompt sheet (waits for it to appear). Panels are
 *  dialogs too, so only the titled sheets (aria-labelledby) count. */
export const findDialog = () => waitFor(() => {
  const sheets = screen.queryAllByRole("dialog")
    .filter((d) => d.hasAttribute("aria-labelledby"));
  if (!sheets.length) throw new Error("no confirm/prompt dialog is open");
  return sheets.at(-1)!;
});

/** Click a button of the open dialog, e.g. `await pressDialog(/Block/)`. */
export async function pressDialog(name: string | RegExp): Promise<void> {
  const dlg = await findDialog();
  fireEvent.click(within(dlg).getByRole("button", { name }));
}

export const cancelDialog = () => pressDialog("Cancel");
