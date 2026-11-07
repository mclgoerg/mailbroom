import { ArrowDown, Briefcase, Building2, CalendarCheck, ChevronLeft,
  ChevronRight, ChevronsLeft, ChevronsRight, KeyRound, LifeBuoy,
  MessagesSquare, Newspaper, Package, Reply, Shapes, Shield, Tag as TagIcon,
  Users, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { fmtSize } from "../api";
import type { Group, Grouping, SmartKind } from "../types";
import { t } from "../i18n";
import { Avatar, Button, Checkbox, ShortDate, StillMailingBadge, Tag, Select, isModalOpen, type TagTone } from "./ui";

export type SortKey = "count" | "size" | "label" | "last" | "unreadPct"
  | "engagement";

const PAGE_SIZES = [25, 50, 100, 200];
const ALL = 1_000_000;

interface Props {
  groups: Group[];
  selected: Set<string>;
  focusedKey: string | null;
  // Group shown in the split pane (selected-row style), and whether the
  // table is squeezed into the list column beside it (drops Type / Last).
  openKey?: string | null;
  compact?: boolean;
  onToggle: (key: string) => void;
  onToggleAll: (checked: boolean, keys: string[]) => void;
  // Select mode (App's "Select" button): checkboxes are shown on every row.
  // Without it they show on row hover / focus and once something is
  // selected (mouse), and only once something is selected on touch.
  selectMode?: boolean;
  // Opens DetailPanel, which is where single-group actions (Trash/Block/
  // Protect) now live - rows themselves are selection + navigation only.
  onOpen: (g: Group) => void;
  blockedKeys?: Map<string, string>;   // group key -> blocking rule id
  sortK: SortKey;
  sortDir: number;
  onSort: (k: SortKey) => void;
  groupLabel: string;
  grouping?: Grouping;   // "thread" rows show a sender / neutral avatar
  resetSignal: string;   // page resets to 1 when this changes (mode/filter)
  // One extra line under a row's own lines (the Smart sender list says why a
  // sender sits in its row). Empty / absent = no line.
  rowNote?: (g: Group) => string;
  // Always the card layout (a list inside the detail panel, which is narrow
  // beside the list at any viewport width); its checkboxes are always shown.
  cards?: boolean;
}

/** Thread / subject groups carry an English summary from the backend
 *  ("2 mails, 1 sender" / "3 senders"); show it in the UI language. Sender
 *  and domain groups carry an address, which passes through untouched. */
const SUB_COUNTS = /^(?:(\d+) mails?, )?(\d+) senders?$/;
export function localizedSub(sub: string): string {
  const m = SUB_COUNTS.exec(sub);
  if (!m) return sub;
  const senders = t("n.senders", { n: Number(m[2]) });
  return m[1] ? `${t("n.mails", { n: Number(m[1]) })}, ${senders}` : senders;
}

// Smart pools have no single sender to take a letter from: each kind gets
// an icon (DESIGN.md Icons) on the same neutral avatar disc as thread rows.
const KIND_ICON: Record<Exclude<SmartKind, "sender">, LucideIcon> = {
  company: Building2, protected: Shield, replied: Reply, orders: Package,
  appointments: CalendarCheck, jobs: Briefcase, support: LifeBuoy,
  accounts: KeyRound, category: TagIcon, newsletter: Newspaper,
  individuals: Users, other: Shapes,
};

/** The row's avatar. A thread's label is its subject, and a subject's
 *  first letter says nothing - so thread rows show their first sender, or a
 *  neutral icon avatar when there is none. A Smart company / bucket row
 *  shows its kind's icon. */
export function RowAvatar({ g, grouping, size = "md" }: {
  g: Group; grouping?: Grouping; size?: "md" | "lg";
}) {
  const disc = size === "lg" ? "size-16" : "size-8";
  const glyph = (I: LucideIcon) =>
    size === "lg" ? <I size={18} /> : <I size={16} />;
  if (grouping === "smart" && g.kind && g.kind !== "sender") {
    return (
      <span aria-hidden className={`inline-flex ${disc} shrink-0 items-center
        justify-center rounded-full bg-chip text-muted`}>
        {glyph(KIND_ICON[g.kind])}
      </span>
    );
  }
  if (grouping !== "thread") {
    return <Avatar name={g.label || g.key} size={size} />;
  }
  const first = g.samples[0];
  return first ? <Avatar name={first} size={size} /> : (
    <span aria-hidden className={`inline-flex ${disc} shrink-0 items-center
      justify-center rounded-full bg-chip text-faint`}>
      {glyph(MessagesSquare)}
    </span>
  );
}

interface PageProps extends Props {
  slice: Group[];
  baseIdx: number;
}

const unreadPct = (g: Group) =>
  g.count ? Math.round((100 * g.unread) / g.count) : 0;

/* One status pill per row: the first thing that applies, in this priority
   (the detail header shows all the rest). The unsubscribe page to confirm is
   only a hint here - the link and "Mark as done" live in the detail. */
function rowPill(g: Group, blocked: boolean): ReactNode {
  const u = g.unsubscribed;
  if (g.still_mailing) return <StillMailingBadge sm={g.still_mailing} />;
  const pill = (tone: TagTone, label: string, title?: string) => (
    <Tag tone={tone} dot className="whitespace-nowrap">
      <span title={title}>{label}</span>
    </Tag>
  );
  if (u?.status === "link") return pill("review", t("unsub.pill_link"));
  if (blocked) return pill("keep", t("Blocked"));
  if (g.new) return pill("new", t("New"), t("new_sender.tip"));
  if (g.ai) {
    return pill(VERDICT_PILL[g.ai.verdict] ?? "neutral",
      g.ai.verdict.replace("_", " "), g.ai.reason);
  }
  if (u?.status === "done") return pill("info", t("Unsubscribed"));
  if (u?.status === "failed") return pill("keep", t("unsub.badge_failed"));
  if (u?.status === "pending") {
    return pill("review", t("unsub.badge_pending", { n: u.n, of: u.of }));
  }
  if (g.replied) return pill("info", t("replied"), t("replied.tip"));
  return null;
}

const VERDICT_PILL: Record<string, TagTone> = {
  delete_safe: "safe", review: "review", keep: "keep",
};

/** The row's one meta line: the sub (address, Smart summary...) truncates,
 *  "76% unread · last 6 Nov" stays whole. */
function MetaLine({ g }: { g: Group }) {
  return (
    <div className="flex min-w-0 type-meta text-muted">
      {g.sub && (
        <span className="min-w-0 truncate">{localizedSub(g.sub)}</span>
      )}
      <span className="shrink-0 whitespace-nowrap">
        {g.sub ? " · " : ""}{unreadPct(g)}% {t("unread")} · {t("row.last")}{" "}
        <ShortDate iso={g.last} />
      </span>
    </div>
  );
}

/* Selected / open row: a lighter panel + (open) the accent edge. Never an
   accent tint - the status pills must keep 4.5:1 on it (index.contrast.test). */
const ROW_ON = "bg-panel2";

/* Desktop: fixed-layout table so column widths never change when the
   grouping mode (and with it the content) changes. */
function DesktopTable({ slice, baseIdx, selected, focusedKey, openKey, compact, onToggle,
  onToggleAll, onOpen, blockedKeys, selectMode, cards,
  sortK, sortDir, onSort, groupLabel, grouping, rowNote
}: PageProps) {
  // Sort indicator, inline after the label: the active column shows an
  // accent arrow that ROTATES between directions; inactive sortable columns
  // reserve the space (no layout shift) and reveal a faint hint on hover.
  const arrow = (k: SortKey, before = false) => (
    <ArrowDown aria-hidden size={14}
      className={`${before ? "mr-1" : "ml-1"} shrink-0 transition-all duration-200 ${
        sortK === k
          ? `text-accent ${sortDir > 0 ? "rotate-180" : ""}`
          : "opacity-0 group-hover/th:opacity-50 group-focus-within/th:opacity-50"}`} />
  );
  const ariaSort = (k: SortKey) =>
    sortK === k ? (sortDir < 0 ? "descending" as const
      : "ascending" as const) : undefined;
  // Header cell with a real <button>; the sorted column reads in body
  // colour, the others stay muted.
  // Right-aligned columns put the arrow BEFORE the label, so the label
  // (not the reserved arrow space) lines up with the values below.
  const sortBtn = (k: SortKey, label: string, title?: string,
                   right = false) => (
    <button type="button" title={title} onClick={() => onSort(k)}
      className={`inline-flex cursor-pointer items-center whitespace-nowrap
        font-semibold hover:text-body ${sortK === k ? "text-body" : ""}`}>
      {right && arrow(k, true)}{label}{!right && arrow(k)}
    </button>
  );
  const allChecked =
    slice.length > 0 && slice.every((g) => selected.has(g.key));
  const showChecks = !!cards || !!selectMode || selected.size > 0;
  // Hidden checkboxes stay in the layout (no shift): the mouse reveals them
  // on hover / focus; on touch they are inert until select mode.
  const hiddenCls = `opacity-0 coarse:pointer-events-none
    focus-within:opacity-100`;
  // (The strip above the sticky header, inside body's top padding, is
  // covered by body::before in index.css.)
  const th = "px-2 py-2 align-bottom type-meta font-semibold";
  const sortableTh = `${th} group/th`;
  // Row click opens the detail, except on things with their own action.
  const rowClick = (g: Group) => (e: MouseEvent<HTMLTableRowElement>) => {
    if (window.getSelection()?.toString()) return;   // drag-selecting text
    if ((e.target as HTMLElement).closest(
      "button, a, input, label, [data-no-open]")) return;
    onOpen(g);
  };
  // Hairlines start after the avatar (inset list), so the first two cells
  // carry none.
  const td = "border-b border-line";
  // table-fixed: column widths come from the header cells, so they are
  // content-independent and identical in every grouping mode.
  return (
    <div className="group/table overflow-clip rounded-card bg-panel">
    <table className="w-full table-fixed border-collapse type-body">
      <thead>
        <tr className="sticky top-0 z-(--z-sticky) bg-panel text-left text-muted">
          <th className={`${th} w-10`}>
            <Checkbox checked={allChecked} className={`-mx-2 -my-1 ${showChecks
              ? "" : `${hiddenCls} hoverable:group-hover/table:opacity-100`}`}
              aria-label={t("Select all")}
              onChange={(e) => onToggleAll(e.target.checked,
                slice.map((g) => g.key))} />
          </th>
          <th className="w-10" />
          <th className={sortableTh} aria-sort={ariaSort("label")}>
            {sortBtn("label", groupLabel)}
          </th>
          <th className={`${th} ${compact ? "w-36" : "w-44"}`} />
          <th className={`${th} w-32 text-right`}
            aria-sort={ariaSort(sortK === "size" ? "size" : "count")}>
            <span className="group/th inline-flex items-center gap-3">
              {sortBtn("count", t("Mails"), undefined, true)}
              {sortBtn("size", t("Size"), undefined, true)}
            </span>
          </th>
          <th className="w-11" />
        </tr>
      </thead>
      <tbody>
        {slice.map((g, i) => {
          const on = g.key === openKey || selected.has(g.key);
          return (
          <tr key={g.key} data-gidx={baseIdx + i}
            aria-current={g.key === openKey || undefined}
            onClick={rowClick(g)}
            className={`group/row cursor-pointer hover:bg-panel2
              ${on ? ROW_ON : g.key === focusedKey ? "bg-panel2/60" : ""}
              ${g.key === focusedKey ? "outline outline-1 -outline-offset-1 outline-accent/60" : ""}`}>
            {/* Open row: 2 px accent left edge (§4.11 selected row). */}
            <td className={`px-2 py-2.5 align-middle ${g.key === openKey
              ? "shadow-open-edge" : ""}`}
              {...(showChecks ? { "data-no-open": true } : {})}>
              <Checkbox checked={selected.has(g.key)}
                className={`-mx-2 -my-1 ${showChecks ? "" : `${hiddenCls}
                  hoverable:group-hover/row:opacity-100`}`}
                aria-label={t("Select {label}", { label: g.label || g.key })}
                onChange={() => onToggle(g.key)} />
            </td>
            <td className="py-2.5 pl-0 pr-2 align-middle">
              <RowAvatar g={g} grouping={grouping} />
            </td>
            <td className={`min-w-0 px-2 py-2.5 ${td}`}>
              <button
                className="block w-full cursor-pointer truncate text-left
                  type-body font-medium hover:underline"
                onClick={() => onOpen(g)}>
                {g.label}
              </button>
              {rowNote?.(g) && (
                <div className="truncate type-meta text-muted"
                  title={rowNote(g)}>{rowNote(g)}</div>
              )}
              <MetaLine g={g} />
            </td>
            <td className={`px-2 py-2.5 text-right ${td}`}>
              {rowPill(g, !!blockedKeys?.has(g.key))}
            </td>
            <td className={`whitespace-nowrap px-2 py-2.5 text-right
              tabular-nums ${td}`}>
              <div className="font-semibold">{g.count}</div>
              <div className="type-meta text-muted">{fmtSize(g.size)}</div>
            </td>
            <td className={`px-1 py-2.5 text-right ${td}`}>
              <Button variant="quiet" size="icon" label={t("View details")}
                className="text-faint" onClick={() => onOpen(g)}>
                <ChevronRight size={18} />
              </Button>
            </td>
          </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

/* Mobile: a card list - no table semantics, no horizontal squeeze. The
   round checks only exist in select mode (a tap on a card opens it). */
function MobileCards({ slice, baseIdx, selected, focusedKey, onToggle,
  onOpen, blockedKeys, selectMode, cards, grouping, rowNote
}: PageProps) {
  const showChecks = !!cards || !!selectMode || selected.size > 0;
  return (
    <div className="overflow-clip rounded-card bg-panel">
      {slice.map((g, i) => {
        const pill = rowPill(g, !!blockedKeys?.has(g.key));
        return (
        <div key={g.key} data-gidx={baseIdx + i}
          className={`flex items-stretch
            ${selected.has(g.key) ? ROW_ON
              : g.key === focusedKey ? "bg-panel2/60" : ""}`}>
          {/* The whole left gutter (44 px, full card height) is the
              check's hit area; it never overlaps the open-detail area. */}
          {showChecks && (
            <Checkbox round checked={selected.has(g.key)}
              className="w-11 shrink-0 self-stretch coarse:min-h-0"
              aria-label={t("Select {label}", { label: g.label || g.key })}
              onChange={() => onToggle(g.key)} />
          )}
          {/* Taps anywhere on the card open the detail; the title is the
              real <button>, so keyboard and screen-reader users can too. */}
          <div className={`flex min-w-0 flex-1 cursor-pointer items-center
            gap-3 py-2.5 pr-1 ${showChecks ? "" : "pl-3"}`}
            onClick={() => onOpen(g)}>
            <RowAvatar g={g} grouping={grouping} />
            <div className={`min-w-0 flex-1 pb-2.5 pt-0.5
              ${i < slice.length - 1 ? "border-b border-line" : ""}`}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <button type="button" data-no-open
                    className="block w-full cursor-pointer truncate text-left
                      type-body-mobile"
                    onClick={(e) => { e.stopPropagation(); onOpen(g); }}>
                    {g.label}
                  </button>
                  {rowNote?.(g) && (
                    <div className="type-meta text-muted">{rowNote(g)}</div>
                  )}
                  <MetaLine g={g} />
                </div>
                <div className="shrink-0 whitespace-nowrap text-right
                  tabular-nums">
                  <div className="font-semibold">{g.count}</div>
                  <div className="type-meta text-muted">{fmtSize(g.size)}</div>
                </div>
                <ChevronRight aria-hidden size={18}
                  className="shrink-0 text-faint" />
              </div>
              {pill && <div className="mt-1 flex">{pill}</div>}
            </div>
          </div>
        </div>
        );
      })}
    </div>
  );
}

export function GroupTable(props: Props) {
  const { groups, focusedKey, resetSignal } = props;
  const [page, setPage] = useState(0);
  // Focus that sat on a row which then vanished (Trash all removes it) would
  // drop to <body>: remember whether focus was last inside the list and, when
  // the rows change under it, park focus on the list itself.
  const root = useRef<HTMLDivElement>(null);
  const focusInside = useRef(false);
  const focusIdx = useRef(-1);     // absolute index of the row focus was in
  useEffect(() => {
    const onIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      focusInside.current = !!root.current?.contains(el);
      const row = focusInside.current ? el.closest("[data-gidx]") : null;
      if (row) focusIdx.current = Number(row.getAttribute("data-gidx"));
    };
    document.addEventListener("focusin", onIn);
    return () => document.removeEventListener("focusin", onIn);
  }, []);
  useEffect(() => {
    const a = document.activeElement;
    if (!focusInside.current || (a && a !== document.body) || isModalOpen())
      return;
    // The row that took the removed row's place (the previous one if it was
    // the last); the list itself if there is no visible row to land on.
    const want = Math.min(focusIdx.current, groups.length - 1);
    const rows = want < 0 ? [] : [...root.current!.querySelectorAll(
      `[data-gidx="${want}"]`)] as HTMLElement[];
    // (the table and card twins: only one is laid out; jsdom has no layout)
    const laidOut = document.documentElement.getClientRects().length > 0;
    const row = laidOut ? rows.find((r) => r.getClientRects().length > 0)
      : rows[0];
    (row?.querySelector<HTMLElement>("button") ?? root.current)
      ?.focus({ preventScroll: true });
  }, [groups]);
  const [perPage, setPerPage] = useState(() =>
    Number(localStorage.getItem("pmc_page_size")) || 50);

  const maxPage = Math.max(0, Math.ceil(groups.length / perPage) - 1);

  useEffect(() => { setPage(0); }, [resetSignal]);
  useEffect(() => { if (page > maxPage) setPage(maxPage); }, [page, maxPage]);
  // Keyboard navigation (j/k in App) follows the focused row across pages.
  useEffect(() => {
    if (!focusedKey) return;
    const idx = groups.findIndex((g) => g.key === focusedKey);
    if (idx >= 0) {
      const p = Math.floor(idx / perPage);
      if (p !== page) setPage(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedKey]);

  const baseIdx = page * perPage;
  const slice = groups.slice(baseIdx, baseIdx + perPage);

  return (
    // Focus falls back here when a dialog's opener row is gone (Modal).
    <div ref={root} data-focus-return tabIndex={-1}
      className="outline-none">
      {!props.cards && (
        <div className="hidden md:block">
          <DesktopTable {...props} slice={slice} baseIdx={baseIdx} />
        </div>
      )}
      <div className={props.cards ? "" : "md:hidden"}>
        <MobileCards {...props} slice={slice} baseIdx={baseIdx} />
      </div>
      {(groups.length > Math.min(perPage, ...PAGE_SIZES)) && (
        <div className="flex flex-wrap items-center justify-center gap-2
          py-3 type-meta text-muted">
          <Button variant="secondary" size="sm"
              aria-label={t("page.first")} title={t("page.first")}
              disabled={page === 0} onClick={() => setPage(0)}>
            <ChevronsLeft size={16} />
          </Button>
          <Button variant="secondary" size="sm"
              aria-label={t("page.prev")} title={t("page.prev")}
              disabled={page === 0} onClick={() => setPage(page - 1)}>
            <ChevronLeft size={16} />
          </Button>
          <span className="tabular-nums">
            {t("page.of", { p: page + 1, n: maxPage + 1 })}
          </span>
          <Button variant="secondary" size="sm"
              aria-label={t("page.next")} title={t("page.next")}
              disabled={page >= maxPage} onClick={() => setPage(page + 1)}>
            <ChevronRight size={16} />
          </Button>
          <Button variant="secondary" size="sm"
              aria-label={t("page.last")} title={t("page.last")}
              disabled={page >= maxPage} onClick={() => setPage(maxPage)}>
            <ChevronsRight size={16} />
          </Button>
          <Select
            value={perPage}
            onChange={(e) => {
              const n = Number(e.target.value);
              setPerPage(n);
              setPage(0);
              localStorage.setItem("pmc_page_size", String(n));
            }}>
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n} {t("per page")}</option>
            ))}
            <option value={ALL}>{t("All")}</option>
          </Select>
        </div>
      )}
    </div>
  );
}
