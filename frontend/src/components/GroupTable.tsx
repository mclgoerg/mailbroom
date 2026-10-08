import { ArrowDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  MessagesSquare } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { fmtSize } from "../api";
import type { Group, Grouping } from "../types";
import { t } from "../i18n";
import { AiTag, Avatar, Button, Checkbox, EngagementMeter, PinBadge, RatingChips, ShortDate, Tag, Select } from "./ui";

export type SortKey = "count" | "size" | "label" | "last" | "unreadPct"
  | "engagement";

const PAGE_SIZES = [25, 50, 100, 200];
const ALL = 1_000_000;

interface Props {
  groups: Group[];
  selected: Set<string>;
  focusedKey: string | null;
  onToggle: (key: string) => void;
  onToggleAll: (checked: boolean, keys: string[]) => void;
  // Opens DetailPanel, which is where single-group actions (Trash/Block/
  // Protect) now live - rows themselves are selection + navigation only.
  onOpen: (g: Group) => void;
  blockedKeys?: Map<string, string>;   // group key -> blocking rule id
  onAckUnsub: (addr: string) => void;
  sortK: SortKey;
  sortDir: number;
  onSort: (k: SortKey) => void;
  groupLabel: string;
  grouping?: Grouping;   // "thread" rows show a sender / neutral avatar
  resetSignal: string;   // page resets to 1 when this changes (mode/filter)
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

/** The row's avatar. A thread's label is its subject, and a subject's
 *  first letter says nothing - so thread rows show their first sender, or a
 *  neutral icon avatar when there is none. */
function RowAvatar({ g, grouping }: { g: Group; grouping?: Grouping }) {
  if (grouping !== "thread") {
    return <Avatar name={g.label || g.key} size="md" />;
  }
  const first = g.samples[0];
  return first ? <Avatar name={first} size="md" /> : (
    <span aria-hidden className="inline-flex size-8 shrink-0 items-center
      justify-center rounded-full bg-chip text-faint">
      <MessagesSquare size={16} />
    </span>
  );
}

interface PageProps extends Props {
  slice: Group[];
  baseIdx: number;
}

const unreadPct = (g: Group) =>
  g.count ? Math.round((100 * g.unread) / g.count) : 0;

/* Unsubscribe outcome, shown next to the other per-group tags. "pending"
   (some senders done, the rest never tried - only possible for domain/
   subject groupings with several senders) and "failed" are informational
   only; "link" additionally offers the stashed URL plus a way to confirm
   it without re-running the whole bulk job. */
function UnsubBadge({ g, onAck }: { g: Group; onAck: (addr: string) => void }) {
  const u = g.unsubscribed;
  if (!u) return null;
  if (u.status === "done") {
    return (
      <Tag tone="safe" className="whitespace-nowrap">
        ✓ {t("Unsubscribed")}
      </Tag>
    );
  }
  if (u.status === "failed") {
    return (
      <Tag tone="keep" className="whitespace-nowrap">
        ⚠ {t("unsub.badge_failed")}
      </Tag>
    );
  }
  if (u.status === "pending") {
    return (
      <Tag tone="review" className="whitespace-nowrap">
        {t("unsub.badge_pending", { n: u.n, of: u.of })}
      </Tag>
    );
  }
  // "link": needs a manual confirmation page. Label stays short (unlike
  // the DetailPanel's own button) - the desktop table's Type column is a
  // fixed w-40, and the full "Open unsubscribe page" text wrapped onto
  // two lines there and blew up the row height (390px + 1440px screenshot
  // check against scripts/demo.py, 2026-09-28).
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <a href={u.link} target="_blank" rel="noopener noreferrer"
        title={t("unsub.open_link")}
        onClick={(e) => e.stopPropagation()}
        className="cursor-pointer whitespace-nowrap rounded-badge bg-review-bg
          px-1.5 py-0.5 type-caption text-review-fg underline
          hover:opacity-80">
        ✉ {t("unsub.badge_link")}
      </a>
      <button title={t("unsub.mark_done")} aria-label={t("unsub.mark_done")}
        className="rounded-badge bg-chip px-1.5 py-0.5 type-caption
          text-chiptext hover:bg-chiph"
        onClick={(e) => { e.stopPropagation(); onAck(u.addr); }}>
        ✓
      </button>
    </span>
  );
}

/* Desktop: fixed-layout table so column widths never change when the
   grouping mode (and with it the content) changes. */
function DesktopTable({ slice, baseIdx, selected, focusedKey, onToggle,
  onToggleAll, onOpen, blockedKeys,
  onAckUnsub, sortK, sortDir, onSort, groupLabel, grouping
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
  // table-fixed: column widths come from the header cells, so they are
  // content-independent and identical in every grouping mode.
  return (
    <table className="w-full table-fixed border-collapse type-body">
      <thead>
        <tr className="sticky top-0 z-(--z-sticky) bg-surface text-left text-muted">
          <th className={`${th} w-8`}>
            <Checkbox checked={allChecked} className="-mx-2 -my-1"
              onChange={(e) => onToggleAll(e.target.checked,
                slice.map((g) => g.key))} />
          </th>
          <th className="w-10" />
          <th className={sortableTh} aria-sort={ariaSort("label")}>
            {sortBtn("label", groupLabel)}
          </th>
          <th className={`${th} hidden w-40 lg:table-cell`}>{t("Type")}</th>
          <th className={`${th} w-24`}>{t("AI")}</th>
          <th className={`${sortableTh} w-18`} aria-sort={ariaSort("engagement")}>
            {sortBtn("engagement", t("Eng."), t("eng.col_tip"))}
          </th>
          <th className={`${sortableTh} w-18 text-right`}
            aria-sort={ariaSort("count")}>
            {sortBtn("count", t("Mails"), undefined, true)}
          </th>
          <th className={`${sortableTh} w-20 text-right`}
            aria-sort={ariaSort("size")}>
            {sortBtn("size", t("Size"), undefined, true)}
          </th>
          <th className={`${sortableTh} hidden w-30 text-right md:table-cell`}
            aria-sort={ariaSort("last")}>
            {sortBtn("last", t("Last"), undefined, true)}
          </th>
          <th className="w-11" />
        </tr>
      </thead>
      <tbody>
        {slice.map((g, i) => (
          <tr key={g.key} data-gidx={baseIdx + i}
            onClick={rowClick(g)}
            className={`cursor-pointer border-b border-line hover:bg-panel
              ${g.key === focusedKey ? "bg-panel outline outline-1 -outline-offset-1 outline-accent/60" : ""}`}>
            <td className="px-2 py-2 align-top" data-no-open>
              <Checkbox checked={selected.has(g.key)} className="-mx-2 -my-1"
                aria-label={t("Select {label}", { label: g.label || g.key })}
                onChange={() => onToggle(g.key)} />
            </td>
            <td className="py-2 pl-0 pr-2 align-top">
              <RowAvatar g={g} grouping={grouping} />
            </td>
            <td className="min-w-0 px-2 py-2">
              <button
                className="block w-full cursor-pointer truncate text-left
                  type-body font-medium hover:underline"
                onClick={() => onOpen(g)}>
                {g.label}
              </button>
              {g.sub && (
                <div className="truncate type-meta text-muted">
                  {localizedSub(g.sub)}
                </div>
              )}
              <div className="truncate type-meta text-muted">
                <ShortDate iso={g.first} /> → <ShortDate iso={g.last} /> ·{" "}
                {unreadPct(g)}% {t("unread")}
              </div>
            </td>
            <td className="hidden px-2 py-2 align-top lg:table-cell">
              <div className="flex flex-wrap gap-1 overflow-hidden">
                {g.new && (
                  <Tag tone="new">
                    <span title={t("new_sender.tip")}>🆕 {t("New")}</span>
                  </Tag>
                )}
                {g.replied && (
                  <Tag tone="info">
                    <span title={t("replied.tip")}>↩ {t("replied")}</span>
                  </Tag>
                )}
                {g.att_size > 0 && (
                  <Tag tone="attach">
                    📎 {fmtSize(g.att_size)}
                  </Tag>
                )}
                <PinBadge n={g.pinned} />
                <UnsubBadge g={g} onAck={onAckUnsub} />
                {blockedKeys?.has(g.key) && (
                  <Tag tone="keep">
                    🚫 {t("Blocked")}
                  </Tag>
                )}
                {g.tags.map((t) => <Tag key={t}>{t}</Tag>)}
              </div>
            </td>
            <td className="px-2 py-2 align-top">
              <div className="flex flex-col items-start gap-0.5">
                {g.ai && <AiTag ai={g.ai} />}
                {g.ratings && <RatingChips ratings={g.ratings} />}
              </div>
            </td>
            <td className="px-2 py-2 align-top">
              <EngagementMeter g={g} />
            </td>
            <td className="whitespace-nowrap px-2 py-2 text-right align-top
              tabular-nums">
              {g.count}
            </td>
            <td className="whitespace-nowrap px-2 py-2 text-right align-top
              tabular-nums text-muted">
              {fmtSize(g.size)}
            </td>
            <td className="hidden whitespace-nowrap px-2 py-2 text-right align-top
              tabular-nums text-muted md:table-cell">
              <ShortDate iso={g.last} />
            </td>
            <td className="px-1 py-2 text-right align-top">
              <Button variant="quiet" size="icon" label={t("View details")}
                className="text-faint" onClick={() => onOpen(g)}>
                <ChevronRight size={18} />
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* Mobile: a card list - no table semantics, no horizontal squeeze. */
function MobileCards({ slice, baseIdx, selected, focusedKey, onToggle,
  onOpen, blockedKeys, onAckUnsub, grouping
}: PageProps) {
  return (
    <div>
      {slice.map((g, i) => (
        <div key={g.key} data-gidx={baseIdx + i}
          className={`flex items-stretch border-b border-line
            ${g.key === focusedKey ? "bg-panel" : ""}`}>
          {/* The whole left gutter (44 px, full card height) is the
              checkbox's hit area; it never overlaps the open-detail area. */}
          <Checkbox checked={selected.has(g.key)}
            className="w-11 shrink-0 self-stretch coarse:min-h-0"
            aria-label={t("Select {label}", { label: g.label || g.key })}
            onChange={() => onToggle(g.key)} />
          {/* Taps anywhere on the card open the detail; the title is the
              real <button>, so keyboard and screen-reader users can too. */}
          <div className="flex min-w-0 flex-1 cursor-pointer items-center
            gap-3 py-2.5 pr-1" onClick={() => onOpen(g)}>
            <RowAvatar g={g} grouping={grouping} />
            <div className="min-w-0 flex-1">
              <button type="button" data-no-open
                className="block w-full cursor-pointer truncate text-left
                  type-body-mobile"
                onClick={(e) => { e.stopPropagation(); onOpen(g); }}>
                {g.label}
              </button>
              {g.sub && (
                <div className="truncate type-meta text-muted">
                  {localizedSub(g.sub)}
                </div>
              )}
              <div className="truncate type-meta text-muted">
                {t("n.mails", { n: g.count })} · <ShortDate iso={g.last} /> ·{" "}
                {fmtSize(g.size)} · {unreadPct(g)}% {t("unread")}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <EngagementMeter g={g} />
                {g.new && (
                  <Tag tone="new">
                    <span title={t("new_sender.tip")}>🆕 {t("New")}</span>
                  </Tag>
                )}
                {g.replied && (
                  <Tag tone="info">
                    <span title={t("replied.tip")}>↩ {t("replied")}</span>
                  </Tag>
                )}
                {g.att_size > 0 && (
                  <Tag tone="attach">
                    📎 {fmtSize(g.att_size)}
                  </Tag>
                )}
                <PinBadge n={g.pinned} />
                <UnsubBadge g={g} onAck={onAckUnsub} />
                {blockedKeys?.has(g.key) && (
                  <Tag tone="keep">
                    🚫 {t("Blocked")}
                  </Tag>
                )}
                {g.tags.map((t) => <Tag key={t}>{t}</Tag>)}
                {g.ai && <AiTag ai={g.ai} />}
                {g.ratings && <RatingChips ratings={g.ratings} />}
              </div>
            </div>
            <ChevronRight aria-hidden size={18}
              className="shrink-0 text-faint" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function GroupTable(props: Props) {
  const { groups, focusedKey, resetSignal } = props;
  const [page, setPage] = useState(0);
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
    <>
      <div className="hidden md:block">
        <DesktopTable {...props} slice={slice} baseIdx={baseIdx} />
      </div>
      <div className="md:hidden">
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
    </>
  );
}
