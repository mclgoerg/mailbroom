import { useEffect, useState } from "react";
import { fmtSize } from "../api";
import type { Group } from "../types";
import { t } from "../i18n";
import { AiTag, Button, RatingChips, Tag } from "./ui";

export type SortKey = "count" | "size" | "label" | "last" | "unreadPct";

const PAGE_SIZES = [25, 50, 100, 200];
const ALL = 1_000_000;

interface Props {
  groups: Group[];
  selected: Set<string>;
  focusedKey: string | null;
  onToggle: (key: string) => void;
  onToggleAll: (checked: boolean, keys: string[]) => void;
  onOpen: (g: Group) => void;
  onTrash: (g: Group) => void;
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

/* Desktop: fixed-layout table so column widths never change when the
   grouping mode (and with it the content) changes. */
function DesktopTable({ slice, baseIdx, selected, focusedKey, onToggle,
  onToggleAll, onOpen, onTrash, sortK, sortDir, onSort, groupLabel
}: PageProps) {
  const arrow = (k: SortKey) =>
    sortK === k ? (sortDir < 0 ? " ↓" : " ↑") : "";
  const allChecked =
    slice.length > 0 && slice.every((g) => selected.has(g.key));
  const th = "px-2 py-2 font-semibold";
  // table-fixed: column widths come from the header cells, so they are
  // content-independent and identical in every grouping mode.
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <thead>
        <tr className="sticky top-0 z-10 bg-surface text-left text-muted">
          <th className={`${th} w-8`}>
            <input type="checkbox" checked={allChecked}
              onChange={(e) => onToggleAll(e.target.checked,
                slice.map((g) => g.key))} />
          </th>
          <th className={`${th} cursor-pointer select-none`}
            onClick={() => onSort("label")}>
            {groupLabel}{arrow("label")}
          </th>
          <th className={`${th} hidden w-44 lg:table-cell`}>{t("Type")}</th>
          <th className={`${th} w-24`}>{t("AI")}</th>
          <th className={`${th} w-16 cursor-pointer select-none text-right`}
            onClick={() => onSort("count")}>
            {t("Mails")}{arrow("count")}
          </th>
          <th className={`${th} w-20 cursor-pointer select-none text-right`}
            onClick={() => onSort("size")}>
            {t("Size")}{arrow("size")}
          </th>
          <th className={`${th} hidden w-24 cursor-pointer select-none
            text-right md:table-cell`}
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
              <input type="checkbox" checked={selected.has(g.key)}
                onChange={() => onToggle(g.key)} />
            </td>
            <td className="min-w-0 px-2 py-2">
              <button
                className="block w-full cursor-pointer truncate text-left
                  font-medium hover:underline"
                title={g.samples.length ? `e.g. ${g.samples.join(" • ")}` : ""}
                onClick={() => onOpen(g)}>
                {g.label}
              </button>
              {g.sub && (
                <div className="truncate text-xs text-muted">{g.sub}</div>
              )}
              <div className="truncate text-[0.7rem] text-faint">
                {g.first} → {g.last} · {unreadPct(g)}% {t("unread")}
              </div>
            </td>
            <td className="hidden px-2 py-2 align-top lg:table-cell">
              <div className="flex flex-wrap gap-1 overflow-hidden">
                {g.tags.map((t) => <Tag key={t}>{t}</Tag>)}
              </div>
            </td>
            <td className="px-2 py-2 align-top">
              <div className="flex flex-col items-start gap-0.5">
                {g.ai && <AiTag ai={g.ai} />}
                {g.ratings && <RatingChips ratings={g.ratings} />}
              </div>
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
              <Button variant="danger"
                className="!min-h-7 !px-2 !py-0.5 !text-xs"
                onClick={() => onTrash(g)}>
                {t("Trash")}
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* Mobile: a card list — no table semantics, no horizontal squeeze. */
function MobileCards({ slice, baseIdx, selected, focusedKey, onToggle,
  onOpen, onTrash }: PageProps) {
  return (
    <div>
      {slice.map((g, i) => (
        <div key={g.key} data-gidx={baseIdx + i}
          className={`flex gap-3 border-b border-line px-1 py-2.5
            ${g.key === focusedKey ? "bg-panel" : ""}`}>
          <input type="checkbox" className="mt-1 shrink-0"
            checked={selected.has(g.key)} onChange={() => onToggle(g.key)} />
          <div className="min-w-0 flex-1" onClick={() => onOpen(g)}>
            <div className="truncate font-medium">{g.label}</div>
            {g.sub && (
              <div className="truncate text-xs text-muted">{g.sub}</div>
            )}
            <div className="text-[0.7rem] text-faint">
              {g.count} {t("mails")} · {fmtSize(g.size)} · {unreadPct(g)}%{" "}
              {t("unread")} · {g.last}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {g.tags.map((t) => <Tag key={t}>{t}</Tag>)}
              {g.ai && <AiTag ai={g.ai} />}
              {g.ratings && <RatingChips ratings={g.ratings} />}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end justify-between">
            <Button variant="danger" className="!min-h-7 !px-2 !py-0.5 !text-xs"
              onClick={() => onTrash(g)}>
              {t("Trash")}
            </Button>
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

  const nav = `min-h-8 rounded-md bg-chip px-2.5 py-1 text-sm text-body
    hover:bg-chiph disabled:cursor-default disabled:opacity-40`;

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
          py-3 text-sm text-muted">
          <button className={nav} disabled={page === 0}
            onClick={() => setPage(0)}>«</button>
          <button className={nav} disabled={page === 0}
            onClick={() => setPage(page - 1)}>‹</button>
          <span className="tabular-nums">
            {t("page.of", { p: page + 1, n: maxPage + 1 })}
          </span>
          <button className={nav} disabled={page >= maxPage}
            onClick={() => setPage(page + 1)}>›</button>
          <button className={nav} disabled={page >= maxPage}
            onClick={() => setPage(maxPage)}>»</button>
          <select
            className="min-h-8 rounded-md border border-line bg-panel2 px-2
              py-1 text-sm"
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
          </select>
        </div>
      )}
    </>
  );
}
