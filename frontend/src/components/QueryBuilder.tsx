import { SlidersHorizontal } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { t } from "../i18n";
import { Button, Chip, Input, Modal, SectionLabel, Select, useMediaQuery }
  from "./ui";

/* Interactive helper for the filter/rule query DSL: instead of
 * remembering the syntax, users click conditions together - each one
 * appends its token to the query (tokens AND together). Renders as a
 * toggle button plus a panel: a dropdown anchored to the (relative!) parent
 * on >=sm, but a bottom sheet (Modal) on phones, where an absolute panel
 * would overflow the viewport. Parents must set `relative`. */

const TAGS = ["newsletter", "shipping", "finance", "shopping", "social",
  "travel", "dev/cloud", "automated"];

export function QueryBuilder({ value, onChange, className = "" }: {
  value: string;
  onChange: (q: string) => void;
  className?: string;                    // extra classes for the trigger
}) {
  const [open, setOpen] = useState(false);
  const phone = useMediaQuery("(max-width: 639px)");
  const [tag, setTag] = useState("newsletter");
  const [ai, setAi] = useState("safe");
  const [age, setAge] = useState("1");
  const [ageUnit, setAgeUnit] = useState<"m" | "y">("y");
  const [unread, setUnread] = useState("80");
  const [att, setAtt] = useState("10");

  const add = (tok: string) => {
    const q = value.trim();
    if (q.split(/\s+/).includes(tok)) return;      // no duplicate tokens
    onChange(q ? `${q} ${tok}` : tok);
  };
  const addBtn = (tok: string) => (
    <Button variant="secondary" size="sm" className="shrink-0"
      onClick={() => add(tok)}>
      {t("qb.add")}
    </Button>
  );
  const flag = (tok: string, label: string) => (
    <Chip key={tok} on={value.split(/\s+/).includes(tok)}
      onClick={() => add(tok)}>
      {label}
    </Chip>
  );

  // One row: label | control | Add. The grid is shared by all rows so the
  // Add buttons always sit in the third column.
  const row = (label: string, control: ReactNode, tok: string) => (
    <>
      <span className="type-meta text-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-2">{control}</div>
      {addBtn(tok)}
    </>
  );
  const titleId = useId();
  const panel = (
    <>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div id={titleId} className="type-heading">{t("qb.title")}</div>
          <div className="type-meta text-muted">{t("qb.hint")}</div>
        </div>
        <Button variant="quiet" size="sm" onClick={() => onChange("")}>
          {t("qb.clear")}
        </Button>
        <Button size="sm" onClick={() => setOpen(false)}>{t("qb.done")}</Button>
      </div>
      {phone && value.trim() && (
        <div className="mt-2 break-words rounded-control bg-panel2 px-2 py-1
          font-mono type-meta text-body">{value}</div>
      )}
      <div className="mt-3 grid grid-cols-[5.5rem_1fr_auto] sm:grid-cols-[7rem_1fr_auto] items-center
        gap-x-2 gap-y-2">
        {row(t("qb.tag"),
          <Select className="min-w-0 flex-1" value={tag}
            onChange={(e) => setTag(e.target.value)}>
            {TAGS.map((x) => <option key={x}>{x}</option>)}
          </Select>, `tag:${tag}`)}
        {row(t("qb.ai"),
          <Select className="min-w-0 flex-1" value={ai}
            onChange={(e) => setAi(e.target.value)}>
            <option value="safe">{t("qb.ai_safe")}</option>
            <option value="review">{t("qb.ai_review")}</option>
            <option value="keep">{t("qb.ai_keep")}</option>
          </Select>, `ai:${ai}`)}
        {row(t("qb.age"), <>
          <Input className="w-16 shrink-0 sm:w-20" type="number" min="1"
            value={age} onChange={(e) => setAge(e.target.value)} />
          <Select className="min-w-0 flex-1" value={ageUnit}
            onChange={(e) => setAgeUnit(e.target.value as "m" | "y")}>
            <option value="m">{t("qb.months")}</option>
            <option value="y">{t("qb.years")}</option>
          </Select>
        </>, `age:>${+age || 1}${ageUnit}`)}
        {row(t("qb.unread"), <>
          <Input className="w-16 shrink-0 sm:w-20" type="number"
            min="1" max="100" value={unread}
            onChange={(e) => setUnread(e.target.value)} />
          <span className="type-meta text-muted">%</span>
        </>, `unread:>${+unread || 1}`)}
        {row(t("qb.att"), <>
          <Input className="w-16 shrink-0 sm:w-20" type="number" min="1"
            value={att} onChange={(e) => setAtt(e.target.value)} />
          <span className="type-meta text-muted">MB</span>
        </>, `att:>${+att || 1}m`)}
      </div>
      <SectionLabel className="mb-1.5 mt-4">{t("qb.flags")}</SectionLabel>
      <div className="flex flex-wrap items-center gap-1.5">
        {flag("is:unsub", t("qb.is_unsub"))}
        {flag("is:unsubscribed", t("qb.is_unsubscribed"))}
        {flag("is:not-unsubscribed", t("qb.is_not_unsubscribed"))}
        {flag("is:noreply-ever", t("qb.is_noreply"))}
        {flag("is:replied", t("qb.is_replied"))}
        {flag("is:protected", t("qb.is_protected"))}
        {flag("is:new", t("qb.is_new"))}
        {flag("has:pinned", t("qb.has_pinned"))}
        {flag("eng:low", t("qb.eng_low"))}
        {flag("eng:medium", t("qb.eng_medium"))}
        {flag("eng:high", t("qb.eng_high"))}
      </div>
    </>
  );

  return (
    <>
      <Button variant="secondary" size="icon" className={className}
        label={t("qb.tip")} aria-expanded={open}
        onClick={() => setOpen(!open)}>
        <SlidersHorizontal size={18} />
      </Button>
      {open && phone && (
        <Modal size="sm" labelledBy={titleId} onClose={() => setOpen(false)}>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{panel}</div>
        </Modal>
      )}
      {/* z-dropdown: must cover the group table's sticky header (z-sticky). */}
      {open && !phone && (
        <div className={`absolute left-0 right-0 top-full z-(--z-dropdown) mt-1
          w-full max-w-2xl rounded-card border border-line bg-panel2 p-3 shadow-popover
          ${className}`}>
          {panel}
        </div>
      )}
    </>
  );
}
