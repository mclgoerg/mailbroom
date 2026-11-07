import { fireEvent, screen, within } from "@testing-library/react";

/** Drive the selection capsule: Archive / Move / Unsubscribe are buttons,
 *  Mark read / AI review live in its More menu. */
export function barAction(v: "archive" | "move" | "unsubscribe" | "mark_read"
    | "ai_review") {
  const bar = screen.getByRole("region", { name: "Selection actions" });
  const direct = { archive: "Archive", move: "Move", unsubscribe: "Unsubscribe" };
  if (v in direct) {
    fireEvent.click(within(bar).getByRole("button",
      { name: direct[v as keyof typeof direct] }));
    return;
  }
  fireEvent.click(within(bar).getByRole("button", { name: "More" }));
  fireEvent.click(screen.getByRole("menuitem",
    { name: v === "mark_read" ? "Mark read" : /^AI review/ }));
}

/** Open the capsule's "Limit to…" editor (More menu). */
export function openLimit() {
  const bar = screen.getByRole("region", { name: "Selection actions" });
  fireEvent.click(within(bar).getByRole("button", { name: "More" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /^Limit to…/ }));
}

/** Open the capsule's More menu and click the item. */
export function barMore(name: string | RegExp) {
  const bar = screen.getByRole("region", { name: "Selection actions" });
  fireEvent.click(within(bar).getByRole("button", { name: "More" }));
  fireEvent.click(screen.getByRole("menuitem", { name }));
}
