import { BarChart3, ClipboardList, Copy, Eye, Layers, LayoutGrid, Mails,
  Paperclip, Search, ScrollText, Settings as SettingsIcon, ShieldAlert,
  Sparkles, Trash2, Users } from "lucide-react";
import type { ReactNode } from "react";
import { hashOf, type Page } from "../nav";
import { t } from "../i18n";

/** Tool entry points the sidebar can open (today: the modals). */
export type SidebarTool = "search" | "triage" | "duplicates" | "attachments"
  | "rules" | "junk" | "trash" | "stats" | "space" | "wrapped" | "trackers"
  | "activity" | "settings";

export interface SidebarProps {
  page: Page;
  onPage: (p: Page) => void;
  onOpen: (tool: SidebarTool) => void;
  /** The account switcher: the profile menu, rendered by the app. */
  account: ReactNode;
  /** Rows in the current grouping / mails in the mailbox (undefined = not
   *  scanned yet: no count shown). */
  senderCount?: number;
  mailCount?: number;
  junkCount?: number | null;
  trashCount?: number | null;
  /** Tools that are disabled today stay disabled with the same rule. */
  disabled: Partial<Record<SidebarTool, boolean>>;
}

const ITEM = `flex min-h-9 w-full items-center gap-2.5 rounded-control px-2.5
  text-left type-body transition-colors coarse:min-h-10
  disabled:cursor-not-allowed disabled:text-faint`;
const IDLE = "text-body enabled:hover:bg-chip";
const CURRENT = "bg-accent-tint font-medium text-accent";

function Count({ n }: { n?: number | null }) {
  return n == null ? null
    : <span className="ml-auto type-meta tabular-nums text-muted">{n}</span>;
}

/** Fixed left navigation from 1024 px. Pages are real links (hash routes,
 *  back/forward work); tools are buttons that open today's panels. */
export function Sidebar({ page, onPage, onOpen, account, senderCount,
  mailCount, junkCount, trashCount, disabled }: SidebarProps) {
  const pageLink = (p: Page, icon: ReactNode, label: string,
    count?: number) => (
    <a href={hashOf(p)} aria-current={page === p ? "page" : undefined}
      className={`${ITEM} ${page === p ? CURRENT : IDLE}`}
      onClick={(e) => {
        // Plain clicks go through the app (selection / detail reset); the
        // modified ones keep the browser's own behaviour.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onPage(p);
      }}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Count n={count} />
    </a>
  );
  const tool = (id: SidebarTool, icon: ReactNode, label: string,
    count?: number | null) => (
    <button type="button" className={`${ITEM} ${IDLE}`}
      disabled={disabled[id]} onClick={() => onOpen(id)}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Count n={count} />
    </button>
  );
  const section = (label: string) => (
    <div className="px-2.5 pb-1 pt-4 type-caption font-semibold
      text-muted">{label}</div>
  );
  return (
    <nav aria-label={t("nav.label")}
      className="fixed inset-y-0 left-0 z-(--z-dropdown) flex w-61 flex-col
        gap-0.5 overflow-y-auto border-r border-line bg-side p-3">
      {account}
      <button type="button" onClick={() => onOpen("search")}
        className="my-2 flex min-h-9 w-full items-center gap-2 rounded-control
          bg-chip px-2.5 text-left type-body text-muted transition-colors
          hover:bg-chiph coarse:min-h-10">
        <Search size={16} aria-hidden />
        {t("Search all mails")}
      </button>
      {pageLink("senders", <Users size={16} aria-hidden />,
        t("nav.senders"), senderCount)}
      {pageLink("all", <Mails size={16} aria-hidden />,
        t("nav.all_mail"), mailCount)}
      {section(t("tools.group_cleanup"))}
      {tool("triage", <Layers size={16} aria-hidden />, t("triage.menu"))}
      {tool("duplicates", <Copy size={16} aria-hidden />, t("Duplicates"))}
      {tool("attachments", <Paperclip size={16} aria-hidden />,
        t("Attachments"))}
      {tool("rules", <ClipboardList size={16} aria-hidden />, t("Rules"))}
      {tool("junk", <ShieldAlert size={16} aria-hidden />, t("role.junk"),
        junkCount)}
      {tool("trash", <Trash2 size={16} aria-hidden />, t("role.trash"),
        trashCount)}
      {section(t("tools.group_insights"))}
      {tool("stats", <BarChart3 size={16} aria-hidden />, t("Statistics"))}
      {tool("space", <LayoutGrid size={16} aria-hidden />, t("space.title"))}
      {tool("wrapped", <Sparkles size={16} aria-hidden />,
        t("wrapped.menu"))}
      {tool("trackers", <Eye size={16} aria-hidden />, t("tracker.menu"))}
      <div className="mt-auto flex items-center gap-1 border-t border-line
        pt-3">
        <button type="button" className={`${ITEM} ${IDLE} flex-1`}
          onClick={() => onOpen("activity")}>
          <ScrollText size={16} aria-hidden />
          {t("nav.activity")}
        </button>
        <button type="button" aria-label={t("Settings")} title={t("Settings")}
          className={`${IDLE} inline-flex size-9 shrink-0 items-center
            justify-center rounded-control transition-colors coarse:size-10`}
          onClick={() => onOpen("settings")}>
          <SettingsIcon size={16} aria-hidden />
        </button>
      </div>
    </nav>
  );
}
