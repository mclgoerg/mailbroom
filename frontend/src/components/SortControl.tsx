import { ArrowDown, ArrowUpDown } from "lucide-react";
import { t } from "../i18n";
import { Button, Menu, MenuDivider, MenuItem, Select, useMediaQuery }
  from "./ui";

/** Sort field + direction. From 768 px: a select with a direction toggle as
 *  one segmented control. On a phone: one icon button opening a Menu with
 *  the sort keys (active one marked) and Ascending / Descending, so the
 *  filter box keeps the row. Shared by the group list and All mails. */
export function SortControl<K extends string>({ options, value, dir,
  onValue, onDir }: {
  options: { k: K; label: string }[];
  value: K;
  dir: "asc" | "desc";
  onValue: (k: K) => void;
  onDir: (d: "asc" | "desc") => void;
}) {
  const phone = useMediaQuery("(max-width: 767px)");
  if (phone) {
    return (
      <Menu variant="secondary" icon label={t("sort.menu")}
        trigger={<ArrowUpDown size={18} />}>
        {options.map((o) => (
          <MenuItem key={o.k} active={o.k === value}
            onClick={() => onValue(o.k)}>
            {t(o.label)}
          </MenuItem>
        ))}
        <MenuDivider />
        <MenuItem active={dir === "asc"} onClick={() => onDir("asc")}>
          {t("sort.ascending")}
        </MenuItem>
        <MenuItem active={dir === "desc"} onClick={() => onDir("desc")}>
          {t("sort.descending")}
        </MenuItem>
      </Menu>
    );
  }
  return (
    <div className="flex shrink-0 items-stretch overflow-hidden
      rounded-control border border-line">
      <Select className="min-w-0 flex-1 !rounded-none !border-0"
        value={value}
        onChange={(e) => onValue(e.target.value as K)}>
        {options.map((o) => (
          <option key={o.k} value={o.k}>{t(o.label)}</option>
        ))}
      </Select>
      {/* !rounded-none: the segment's corners belong to the wrapper. */}
      <Button variant="secondary" size="icon"
        label={t(dir === "desc" ? "sort.desc_tip" : "sort.asc_tip")}
        className="shrink-0 !rounded-none border-l border-line"
        onClick={() => onDir(dir === "desc" ? "asc" : "desc")}>
        <ArrowDown aria-hidden size={16}
          className={`text-accent transition-transform duration-200
            ${dir === "asc" ? "rotate-180" : ""}`} />
      </Button>
    </div>
  );
}
