import { useLayoutEffect, type RefObject } from "react";
import { useMediaQuery } from "./components/ui";

/** Tailwind `xl`: from here a group's details open beside the list instead
 *  of in a modal (UI-UX-PLAN §11.2). Below it nothing changes. */
export const SPLIT_PANE_QUERY = "(min-width: 1280px)";

/** Live flag for the split-pane layout; flips when the window is resized
 *  across 1280 px. */
export const useSplitPane = () => useMediaQuery(SPLIT_PANE_QUERY);

/** Sizes the sticky detail pane to the viewport space below it: `body` is
 *  the scroll container and the pane starts under the toolbar, so a flat
 *  100dvh would push its footer (Trash all) below the fold until the user
 *  scrolls. Publishes `--pane-avail` on `ref`; CSS subtracts the bulk bar. */
export function usePaneHeight(ref: RefObject<HTMLElement | null>,
    active: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    const cell = el?.parentElement;
    if (!active || !el || !cell) return;
    const stick = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
    const sync = () => {
      const top = Math.max(cell.getBoundingClientRect().top, stick);
      el.style.setProperty("--pane-avail", `${window.innerHeight - top}px`);
    };
    sync();
    document.body.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      document.body.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [ref, active]);
}
