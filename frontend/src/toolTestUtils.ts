import { fireEvent, screen } from "@testing-library/react";

/** Phone / tablet shell (< 1024, which is what jsdom without matchMedia
 *  renders): the tools live on the Clean up / Insights tab pages. */
export const openTab = (name: "Clean up" | "Insights" | "Senders") =>
  fireEvent.click(screen.getByRole("link", { name }));

/** Open one tool: its tab, then its row. */
export const openTool = (tab: "Clean up" | "Insights",
    row: string | RegExp) => {
  openTab(tab);
  fireEvent.click(screen.getByRole("button", { name: row }));
};
