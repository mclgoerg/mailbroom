import { BookmarkPlus, ChevronDown, ListFilter, Pencil, Sparkles, X }
  from "lucide-react";
import { t } from "../i18n";
import type { FilterPreset } from "../types";
import { Button, ChipGroup, ChipSegment, Menu, MenuDivider, MenuGroup,
  MenuItem, useMediaQuery } from "./ui";

/** Quick filters of the Filter menu (keys go through App's selectPreset). */
export const QUICK_FILTERS: { key: string; label: string }[] = [
  { key: "aisafe", label: "AI-safe groups" },
  { key: "unsub_pending", label: "sel.unsub_pending" },
];
/** The three "Inactive" presets share one 6 mo | 1 yr | 2 yr row. */
export const INACTIVE_FILTERS: { key: string; label: string }[] = [
  { key: "older6", label: "chip.inactive_6m" },
  { key: "older12", label: "chip.inactive_1y" },
  { key: "older24", label: "chip.inactive_2y" },
];

/** What the filter box currently equals: a quick filter or a saved filter
 *  (null for anything typed by hand). `quick` maps a preset key to its
 *  query; `counts` are the New / Still mailing sender counts. */
export function activeFilterLabel(filter: string, presets: FilterPreset[],
  quick: (key: string) => string,
  counts: { new: number; still: number }): string | null {
  if (!filter.trim()) return null;
  const hit = [...QUICK_FILTERS, ...INACTIVE_FILTERS]
    .find((p) => quick(p.key) === filter);
  if (hit) {
    const label = t(hit.label);
    return INACTIVE_FILTERS.includes(hit)
      ? `${t("chip.inactive")} ${label}` : label;
  }
  if (counts.new && filter === quick("new"))
    return t("chip.new_count", { n: counts.new });
  if (counts.still && filter === quick("still"))
    return t("chip.still_count", { n: counts.still });
  return presets.find((p) => p.query === filter)?.name ?? null;
}

/** The Filter menu of the Senders toolbar: quick filters, saved filters
 *  (apply / edit / delete) and the two ways to make a new one. Selecting
 *  the active entry again clears it - the same toggling the chips had. The
 *  trigger turns `tinted` with a dot while a filter is applied. */
export function FilterMenu({ filter, quick, newCount, stillCount, presets,
  onQuick, onApply, onEdit, onDelete, onSave, onAi }: {
  filter: string;
  /** Preset key -> filter query (App's presetFilterQuery). */
  quick: (key: string) => string;
  newCount: number;
  stillCount: number;
  presets: FilterPreset[];
  onQuick: (key: string) => void;
  onApply: (p: FilterPreset) => void;
  onEdit: (p: FilterPreset) => void;
  onDelete: (p: FilterPreset) => void;
  onSave: () => void;
  /** Absent = no AI filter entry; `disabled` = shown but off (demo). */
  onAi?: { disabled?: boolean; hint?: string; run: () => void };
}) {
  const phone = useMediaQuery("(width < 48rem)");
  const active = !!filter.trim();
  const label = t("filter.menu");
  const variant = active ? "tinted" : "secondary";
  const dot = active && (
    <span aria-hidden data-testid="filter-dot"
      className="size-1.5 rounded-full bg-accent" />
  );
  const on = (key: string) => filter === quick(key);
  const item = (p: { key: string; label: string }) => (
    <MenuItem key={p.key} active={on(p.key)} onClick={() => onQuick(p.key)}>
      {t(p.label)}
    </MenuItem>
  );

  const body = (<>
    <MenuGroup label={t("filter.quick")}>
      {QUICK_FILTERS.slice(0, 1).map(item)}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="min-w-0 flex-1 type-body text-body">
          {t("chip.inactive").replace(/:$/, "")}
        </span>
        <ChipGroup>
          {INACTIVE_FILTERS.map((p) => (
            <ChipSegment key={p.key} on={on(p.key)}
              role="menuitemradio" aria-checked={on(p.key)}
              aria-pressed={undefined}
              onClick={() => onQuick(p.key)}>
              {t(p.label)}
            </ChipSegment>
          ))}
        </ChipGroup>
      </div>
      {QUICK_FILTERS.slice(1).map(item)}
      {newCount > 0 && (
        <MenuItem active={on("new")} onClick={() => onQuick("new")}>
          {t("chip.new_count", { n: newCount })}
        </MenuItem>
      )}
      {stillCount > 0 && (
        <MenuItem active={on("still")} onClick={() => onQuick("still")}>
          {t("chip.still_count", { n: stillCount })}
        </MenuItem>
      )}
    </MenuGroup>
    {presets.length > 0 && (
      <MenuGroup label={t("filter.saved")}>
        {presets.map((p) => (
          // User-defined: accent bookmark + accent name, with edit / delete
          // beside it (built-ins above have neither).
          <div key={p.id} className="flex items-center">
            <button role="menuitemradio" aria-checked={filter === p.query}
              title={p.query}
              className="flex min-w-0 flex-1 items-center gap-2
                rounded-control px-3 py-2 text-left type-body text-accent
                hover:bg-chip"
              onClick={() => onApply(p)}>
              <BookmarkPlus size={16} aria-hidden className="shrink-0" />
              <span className="max-w-64 truncate">{p.name}</span>
            </button>
            <button role="menuitem" title={t("saved_filter.edit_tip")}
              aria-label={`${t("Edit")}: ${p.name}`}
              className={ROW_ICON} onClick={() => onEdit(p)}>
              <Pencil size={14} aria-hidden />
            </button>
            <button role="menuitem" title={t("Delete")}
              aria-label={`${t("Delete")}: ${p.name}`}
              className={ROW_ICON} onClick={() => onDelete(p)}>
              <X size={14} aria-hidden />
            </button>
          </div>
        ))}
      </MenuGroup>
    )}
    <MenuDivider />
    <MenuItem disabled={!active} onClick={onSave}>
      <BookmarkPlus size={16} className="mr-1 inline align-text-bottom" />
      {t("filter.save_current")}
    </MenuItem>
    {onAi && (
      <MenuItem disabled={onAi.disabled} sub={onAi.hint}
        onClick={onAi.run}>
        <Sparkles size={16} className="mr-1 inline align-text-bottom" />
        {t("filter.describe")}
      </MenuItem>
    )}
  </>);

  return phone ? (
    <Menu variant={variant} icon label={label}
      trigger={<span className="relative">
        <ListFilter size={18} aria-hidden />
        {active && <span aria-hidden data-testid="filter-dot"
          className="absolute -right-1 -top-1 size-2 rounded-full
            bg-accent" />}
      </span>}>
      {body}
    </Menu>
  ) : (
    <Menu variant={variant} label={label}
      trigger={<>
        <ListFilter size={16} aria-hidden />
        {label}
        {dot}
        <ChevronDown size={16} aria-hidden className="text-muted" />
      </>}>
      {body}
    </Menu>
  );
}

// Edit / delete next to a saved filter: 32 px visual, hit area to 44 on touch.
const ROW_ICON = `relative flex size-8 shrink-0 items-center justify-center
  rounded-control text-muted hover:bg-chip hover:text-body
  after:absolute after:-inset-1 after:content-[''] coarse:size-10`;

/** The removable token left of the filter input: names the quick or saved
 *  filter the box currently equals. */
export function FilterToken({ label, onRemove }: {
  label: string; onRemove: () => void;
}) {
  return (
    <span data-testid="filter-token" className="inline-flex min-h-9
      max-w-full items-center gap-1 rounded-full bg-accent-tint pl-3 pr-1
      type-meta text-accent coarse:min-h-10">
      <span className="truncate">{label}</span>
      <button type="button" aria-label={t("filter.remove", { name: label })}
        className="relative flex size-7 shrink-0 items-center justify-center
          rounded-full hover:bg-accent-tint after:absolute after:-inset-1
          after:content-['']"
        onClick={onRemove}>
        <X size={14} aria-hidden />
      </button>
    </span>
  );
}
