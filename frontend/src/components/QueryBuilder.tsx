import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { t } from "../i18n";
import { Button, Chip, Input, LINK, SectionLabel, Select } from "./ui";

/* Interactive helper for the filter/rule query DSL: instead of
 * remembering the syntax, users click conditions together - each one
 * appends its token to the query (tokens AND together). Renders as a
 * toggle button plus a panel: a dropdown anchored to the (relative!) parent
 * on >=sm, but IN-FLOW full-width on phones, where an absolute panel
 * would overflow the viewport. Parents must set `relative`. */

const TAGS = ["newsletter", "shipping", "finance", "shopping", "social",
  "travel", "dev/cloud", "automated"];

export function QueryBuilder({ value, onChange, className = "" }: {
  value: string;
  onChange: (q: string) => void;
  className?: string;                    // extra classes for the trigger
}) {
  const [open, setOpen] = useState(false);
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

  return (
    <>
      <Button variant="secondary" size="icon" className={className}
        label={t("qb.tip")} aria-expanded={open}
        onClick={() => setOpen(!open)}>
        <SlidersHorizontal size={18} />
      </Button>
      {/* z-dropdown: must cover the group table's sticky header (z-sticky). */}
      {open && (
        <div className={`w-full rounded-card border border-line bg-panel2 p-3
          sm:absolute sm:left-0 sm:right-0 sm:top-full sm:z-(--z-dropdown) sm:mt-1
          sm:shadow-popover ${className}`}>
          <div className="mb-2 flex items-center gap-2 type-meta text-muted">
            <SectionLabel>{t("qb.title")}</SectionLabel>
            <span>{t("qb.hint")}</span>
            <button className={`ml-auto ${LINK}`}
              onClick={() => onChange("")}>{t("qb.clear")}</button>
            <button className={LINK}
              onClick={() => setOpen(false)}>{t("qb.done")}</button>
          </div>
          <div className="grid gap-2">
            <div className="flex min-w-0 items-center gap-2 type-body">
              <span className="w-24 shrink-0 type-meta text-muted">
                {t("qb.tag")}</span>
              <Select className="min-w-0 flex-1" value={tag}
                onChange={(e) => setTag(e.target.value)}>
                {TAGS.map((x) => <option key={x}>{x}</option>)}
              </Select>
              {addBtn(`tag:${tag}`)}
            </div>
            <div className="flex min-w-0 items-center gap-2 type-body">
              <span className="w-24 shrink-0 type-meta text-muted">
                {t("qb.ai")}</span>
              <Select className="min-w-0 flex-1" value={ai}
                onChange={(e) => setAi(e.target.value)}>
                <option value="safe">{t("qb.ai_safe")}</option>
                <option value="review">{t("qb.ai_review")}</option>
                <option value="keep">{t("qb.ai_keep")}</option>
              </Select>
              {addBtn(`ai:${ai}`)}
            </div>
            <div className="flex min-w-0 items-center gap-2 type-body">
              <span className="w-24 shrink-0 type-meta text-muted">
                {t("qb.age")}</span>
              <Input className="w-20" type="number" min="1"
                value={age} onChange={(e) => setAge(e.target.value)} />
              <Select className="min-w-0 flex-1" value={ageUnit}
                onChange={(e) => setAgeUnit(e.target.value as "m" | "y")}>
                <option value="m">{t("qb.months")}</option>
                <option value="y">{t("qb.years")}</option>
              </Select>
              {addBtn(`age:>${+age || 1}${ageUnit}`)}
            </div>
            <div className="flex min-w-0 items-center gap-2 type-body">
              <span className="w-24 shrink-0 type-meta text-muted">
                {t("qb.unread")}</span>
              <Input className="w-20" type="number"
                min="1" max="100" value={unread}
                onChange={(e) => setUnread(e.target.value)} />
              <span className="type-meta text-muted">%</span>
              {addBtn(`unread:>${+unread || 1}`)}
            </div>
            <div className="flex min-w-0 items-center gap-2 type-body">
              <span className="w-24 shrink-0 type-meta text-muted">
                {t("qb.att")}</span>
              <Input className="w-20" type="number" min="1"
                value={att} onChange={(e) => setAtt(e.target.value)} />
              <span className="type-meta text-muted">MB</span>
              {addBtn(`att:>${+att || 1}m`)}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-24 shrink-0 type-meta text-muted">
                {t("qb.flags")}</span>
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
          </div>
        </div>
      )}
    </>
  );
}
