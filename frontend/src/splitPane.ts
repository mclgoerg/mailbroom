import { useLayoutEffect } from "react";
import { useMediaQuery } from "./components/ui";

/** Tailwind `xl`: from here a group's details open beside the list instead
 *  of in a modal (UI-UX-PLAN §11.2). Below it nothing changes. */
export const SPLIT_PANE_QUERY = "(min-width: 1280px)";

/** Live flag for the split-pane layout; flips when the window is resized
 *  across 1280 px. */
export const useSplitPane = () => useMediaQuery(SPLIT_PANE_QUERY);

/** Sizes the sticky detail pane (`el`, a callback-ref'd element) to the room
 *  below the toolbar: `body` is the scroll container and the pane starts under
 *  the toolbar, so a flat 100dvh would push its footer (Trash all) below the
 *  fold. The pane's bottom is the viewport bottom (above the bulk bar / safe
 *  area), but never lower than the list's own bottom or, for a short list, one
 *  screen - so the pane can't make the page longer, and at the end of the page
 *  it doesn't get pushed up under the header strip. Re-measured on scroll,
 *  window resize and any size change of the cell or the page around it. */
export function usePaneHeight(el: HTMLElement | null) {
  useLayoutEffect(() => {
    const cell = el?.parentElement;
    if (!el || !cell) return;
    const list = cell.previousElementSibling?.firstElementChild;
    const body = document.body;
    const num = (v: string) => parseFloat(v) || 0;
    const sync = () => {
      const cs = getComputedStyle(body);
      const stick = num(cs.paddingTop);
      // Bulk bar (fixed, publishes --bulkbar-h) or the home-indicator inset.
      const reserve = Math.max(num(getComputedStyle(document.documentElement)
        .getPropertyValue("--bulkbar-h")), num(cs.paddingBottom));
      const cellTop = cell.getBoundingClientRect().top;
      const view = window.innerHeight - reserve;
      // One screen's worth below the cell's document position, or the list.
      const room = Math.max(view - (cellTop + body.scrollTop), 0);
      const own = Math.max(list?.getBoundingClientRect().height ?? 0, room);
      const top = Math.max(cellTop, stick);
      const bottom = Math.min(view, cellTop + own);
      el.style.height = `${Math.max(bottom - top, MIN_PANE_H)}px`;
    };
    sync();
    document.body.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    // Everything above the pane shifts it (notice dismissed, toolbar wraps):
    // watch the page containers, not just the cell.
    const ro = typeof ResizeObserver === "undefined" ? null
      : new ResizeObserver(sync);
    for (let n: Element | null = cell; n && n !== document.documentElement;
      n = n.parentElement) ro?.observe(n);
    if (list) ro?.observe(list);
    return () => {
      document.body.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      ro?.disconnect();
    };
  }, [el]);
}

const MIN_PANE_H = 240;
