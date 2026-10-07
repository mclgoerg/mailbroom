import { ArrowDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { fmtSize } from "../api";
import type { Group } from "../types";
import { t } from "../i18n";
import { AiTag, Avatar, Button, Checkbox, EngagementMeter, PinBadge, RatingChips, Tag, Select } from "./ui";

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
  resetSignal: string;   // page resets to 1 when this changes (mode/filter)
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
  // fixed w-44, and the full "Open unsubscribe page" text wrapped onto
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
  onAckUnsub, sortK, sortDir, onSort, groupLabel
}: PageProps) {
  // Sort indicator: the active column shows an accent arrow that ROTATES
  // between directions; inactive sortable columns reserve the space
  // (no layout shift) and reveal a faint hint on hover.
  const arrow = (k: SortKey) => (
    <ArrowDown aria-hidden size={14}
      className={`ml-0.5 inline-block transition-all duration-200 ${
        sortK === k
          ? `text-accent ${sortDir > 0 ? "rotate-180" : ""}`
          : "opacity-0 group-hover/th:opacity-50"}`} />
  );
  const ariaSort = (k: SortKey) =>
    sortK === k ? (sortDir < 0 ? "descending" as const
      : "ascending" as const) : undefined;
  const allChecked =
    slice.length > 0 && slice.every((g) => selected.has(g.key));
  const th = "px-2 py-2 type-meta font-semibold";
  const sortableTh = `${th} group/th cursor-pointer select-none
    hover:text-body`;
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
          <th className={`${th} w-10`} />
          <th className={sortableTh} aria-sort={ariaSort("label")}
            onClick={() => onSort("label")}>
            {groupLabel}{arrow("label")}
          </th>
          <th className={`${th} hidden w-44 lg:table-cell`}>{t("Type")}</th>
          <th className={`${th} w-24`}>{t("AI")}</th>
          <th className={`${sortableTh} w-14`} aria-sort={ariaSort("engagement")}
            title={t("eng.col_tip")} onClick={() => onSort("engagement")}>
            {t("Eng.")}{arrow("engagement")}
          </th>
          <th className={`${sortableTh} w-16 text-right`}
            aria-sort={ariaSort("count")}
            onClick={() => onSort("count")}>
            {t("Mails")}{arrow("count")}
          </th>
          <th className={`${sortableTh} w-20 text-right`}
            aria-sort={ariaSort("size")}
            onClick={() => onSort("size")}>
            {t("Size")}{arrow("size")}
          </th>
          <th className={`${sortableTh} hidden w-24 text-right md:table-cell`}
            aria-sort={ariaSort("last")}
            onClick={() => onSort("last")}>
            {t("Last")}{arrow("last")}
          </th>
          <th className="w-16" />
        </tr>
      </thead>
      <tbody>
        {slice.map((g, i) => (
          <tr key={g.key} data-gidx={baseIdx + i}
            className={`border-b border-line hover:bg-panel
              ${g.key === focusedKey ? "bg-panel outline outline-1 -outline-offset-1 outline-accent/60" : ""}`}>
            <td className="px-2 py-2 align-top">
              <Checkbox checked={selected.has(g.key)} className="-mx-2 -my-1"
                onChange={() => onToggle(g.key)} />
            </td>
            <td className="px-2 py-2 align-top">
              <Avatar name={g.label || g.key} size="md" />
            </td>
            <td className="min-w-0 px-2 py-2">
              <button
                className="block w-full cursor-pointer truncate text-left
                  type-body font-medium hover:underline"
                title={g.samples.length ? `e.g. ${g.samples.join(" • ")}` : ""}
                onClick={() => onOpen(g)}>
                {g.label}
              </button>
              {g.sub && (
                <div className="truncate type-meta text-muted">{g.sub}</div>
              )}
              <div className="truncate type-meta text-muted">
                {g.first} → {g.last} · {unreadPct(g)}% {t("unread")}
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
            <td className="px-2 py-2 text-right align-top tabular-nums">
              {g.count}
            </td>
            <td className="px-2 py-2 text-right align-top tabular-nums
              text-muted">
              {fmtSize(g.size)}
            </td>
            <td className="hidden px-2 py-2 text-right align-top tabular-nums
              text-muted md:table-cell">
              {g.last}
            </td>
            <td className="px-2 py-2 text-right align-top">
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
  onOpen, blockedKeys, onAckUnsub
}: PageProps) {
  return (
    <div>
      {slice.map((g, i) => (
        <div key={g.key} data-gidx={baseIdx + i}
          className={`flex items-center gap-3 border-b border-line px-1
            py-2.5 ${g.key === focusedKey ? "bg-panel" : ""}`}>
          <Checkbox checked={selected.has(g.key)} className="-ml-2 -mr-1 coarse:-ml-3 coarse:-mr-4"
            onChange={() => onToggle(g.key)} />
          <div className="flex min-w-0 flex-1 cursor-pointer items-center
            gap-3" onClick={() => onOpen(g)}>
            <Avatar name={g.label || g.key} size="md" />
            <div className="min-w-0 flex-1">
              <div className="truncate type-body-mobile">{g.label}</div>
              {g.sub && (
                <div className="truncate type-meta text-muted">{g.sub}</div>
              )}
              <div className="truncate type-meta text-muted">
                {g.count} {t("mails")} · {fmtSize(g.size)} · {unreadPct(g)}%{" "}
                {t("unread")} · {g.last}
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
      <div className="hidden sm:block">
        <DesktopTable {...props} slice={slice} baseIdx={baseIdx} />
      </div>
      <div className="sm:hidden">
        <MobileCards {...props} slice={slice} baseIdx={baseIdx} />
      </div>
      {(groups.length > Math.min(perPage, ...PAGE_SIZES)) && (
        <div className="flex flex-wrap items-center justify-center gap-2
          py-3 type-meta text-muted">
          <Button variant="secondary" size="sm"
              disabled={page === 0} onClick={() => setPage(0)}>«</Button>
          <Button variant="secondary" size="sm"
              disabled={page === 0} onClick={() => setPage(page - 1)}>‹</Button>
          <span className="tabular-nums">
            {t("page.of", { p: page + 1, n: maxPage + 1 })}
          </span>
          <Button variant="secondary" size="sm"
              disabled={page >= maxPage} onClick={() => setPage(page + 1)}>›</Button>
          <Button variant="secondary" size="sm"
              disabled={page >= maxPage} onClick={() => setPage(maxPage)}>»</Button>
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
