import { BarChart3, ChevronRight, Users, Wand2 } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { hashOf, type Page } from "../nav";
import { t } from "../i18n";
import { useBulkBarHeight } from "./ui";

const TABS: { page: Page; icon: ReactNode; label: string }[] = [
  { page: "senders", icon: <Users size={18} aria-hidden />,
    label: "nav.senders" },
  { page: "cleanup", icon: <Wand2 size={18} aria-hidden />,
    label: "tools.group_cleanup" },
  { page: "insights", icon: <BarChart3 size={18} aria-hidden />,
    label: "tools.group_insights" },
];

/** The bottom tab bar below 1024 px (iOS pattern): translucent, safe-area
 *  padded, 44 px targets. Publishes its height as `--tabbar-h` (page padding,
 *  toasts). Mount it only while it is visible - the app unmounts it while
 *  something is selected and the selection bar takes the bottom. "All mail"
 *  is a segment of the Senders page, so it keeps the Senders tab current. */
export function TabBar({ page, onPage }: {
  page: Page; onPage: (p: Page) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useBulkBarHeight(ref, true, "--tabbar-h");
  const current = page === "all" ? "senders" : page;
  return (
    <nav ref={ref} aria-label={t("nav.label")}
      className="pmc-tabbar fixed inset-x-0 bottom-0 z-(--z-bulkbar) flex
        border-t bar-glass px-2 pt-1"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.25rem)" }}>
      {TABS.map((tab) => (
        <a key={tab.page} href={hashOf(tab.page)}
          aria-current={current === tab.page ? "page" : undefined}
          className={`flex min-h-11 flex-1 flex-col items-center justify-center
            gap-0.5 rounded-control type-caption font-medium transition-colors
            ${current === tab.page ? "text-accent" : "text-muted"}`}
          onClick={(e) => {
            // Plain taps go through the app (selection / detail reset).
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onPage(tab.page);
          }}>
          {tab.icon}
          {t(tab.label)}
        </a>
      ))}
    </nav>
  );
}

/** An inset list of tool rows (the Clean up / Insights tab pages): panel
 *  card, hairlines between rows. */
export function ToolList({ label, children }: {
  label: string; children: ReactNode;
}) {
  return (
    <ul aria-label={label} className="mb-4 overflow-hidden rounded-card
      bg-panel">
      {children}
    </ul>
  );
}

/** One row of a `ToolList`: icon, label (+ optional sub line), count and a
 *  chevron. Disabled rows keep the rule the old Tools menu had. */
export function ToolRow({ icon, label, sub, count, disabled, onClick }: {
  icon: ReactNode; label: string; sub?: string; count?: number | null;
  disabled?: boolean; onClick: () => void;
}) {
  return (
    // The hairline starts after the icon (inset list), not at the card edge.
    <li className="relative not-first:after:absolute not-first:after:inset-x-0
      not-first:after:top-0 not-first:after:ml-12 not-first:after:border-t
      not-first:after:border-line not-first:after:content-['']">
      <button type="button" disabled={disabled} onClick={onClick}
        className="flex min-h-12 w-full items-center gap-3 px-3 py-2
          text-left transition-colors enabled:hover:bg-panel2
          disabled:cursor-not-allowed disabled:text-faint">
        <span className="shrink-0 text-muted">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate type-body">{label}</span>
          {sub && (
            <span className="block truncate type-meta text-muted">{sub}</span>
          )}
        </span>
        {!!count && (
          <span className="type-meta tabular-nums text-muted">{count}</span>
        )}
        <ChevronRight size={16} aria-hidden className="shrink-0 text-faint" />
      </button>
    </li>
  );
}
