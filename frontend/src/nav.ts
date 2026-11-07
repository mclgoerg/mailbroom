import { useCallback, useEffect, useState } from "react";
import { useMediaQuery } from "./components/ui";

/** Pages of the app shell. Later tasks add more (overview, tool pages). */
export type Page = "senders" | "all" | "cleanup" | "insights";

export const PAGES: readonly Page[] = ["senders", "all", "cleanup", "insights"];
/** The phone / tablet tab pages: lists of tools. The sidebar shows the same
 *  items, so from 1024 px these routes fall back to the default page. */
export const TAB_PAGES: readonly Page[] = ["cleanup", "insights"];
export const isTabPage = (p: Page): boolean => TAB_PAGES.includes(p);
export const DEFAULT_PAGE: Page = "senders";

/** `#/senders` -> "senders"; anything else (empty, unknown) -> null. */
export function parseHash(hash: string): Page | null {
  const name = hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  return PAGES.find((p) => p === name) ?? null;
}

export const hashOf = (page: Page): string => `#/${page}`;

/** The current page and a setter. The URL hash is the source of truth, so
 *  back/forward and reloads keep the page; no router dependency. An empty or
 *  unknown hash shows `initial` without rewriting the URL. */
export function useNav(initial: Page = DEFAULT_PAGE): [Page, (p: Page) => void] {
  // Frozen at mount: the caller's fallback may follow the page itself (the
  // persisted view), and Back to an empty hash must land on the start page.
  const [fallback] = useState(initial);
  const read = () => parseHash(window.location.hash) ?? fallback;
  const [page, setPageState] = useState<Page>(read);
  useEffect(() => {
    const on = () => setPageState(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setPage = useCallback((p: Page) => {
    setPageState(p);
    if (parseHash(window.location.hash) !== p)
      window.location.hash = hashOf(p);
  }, []);
  return [page, setPage];
}

/** From here the sidebar replaces the header, Tools menu and Junk / Trash
 *  links (Tailwind `lg`). Below it the old header stays. */
export const SIDEBAR_QUERY = "(min-width: 1024px)";
export const SIDEBAR_W = 244;

export const useSidebar = () => useMediaQuery(SIDEBAR_QUERY);
