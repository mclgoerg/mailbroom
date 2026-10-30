import { ChevronDown, ChevronRight, X, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import { fmtSize } from "../lib";
import { computeQuickWins, isDismissed, loadDismissed, saveDismissed,
  TOP_CARDS, unionTotals, type Dismissed, type QuickWinCard }
  from "../quickwins";
import type { Group } from "../types";
import { Button } from "./ui";

const COLLAPSED_KEY = "pmc_qw_collapsed";

/** The "Quick wins" strip above the Sender list: a few ready-made cleanups
 *  with what each frees. Review shows the list, Clean up goes through the
 *  caller's normal confirm - nothing here touches the mailbox itself. */
export function QuickWins({ groups, account, onReview, onCleanUp }: {
  groups: Group[];
  account: string;
  onReview: (c: QuickWinCard) => void;
  onCleanUp: (c: QuickWinCard) => void;
}) {
  const [dismissed, setDismissed] = useState<Dismissed>(
    () => loadDismissed(account));
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === "1");
  const [more, setMore] = useState(false);
  useEffect(() => setDismissed(loadDismissed(account)), [account]);

  const cards = useMemo(
    () => computeQuickWins(groups)
      .filter((c) => !isDismissed(dismissed, c.def.id, c.mails)),
    [groups, dismissed]);
  if (!cards.length) return null;

  const shown = more ? cards : cards.slice(0, TOP_CARDS);
  const total = unionTotals(shown, groups);
  const toggle = () => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "0" : "1");
    setCollapsed(!collapsed);
  };
  const moreToggle = cards.length > TOP_CARDS
    ? (cls: string) => (
      <Button variant="quiet" size="sm" className={cls}
        onClick={() => setMore(!more)}>
        {more ? t("qw.less") : t("qw.more", { n: cards.length - TOP_CARDS })}
      </Button>)
    : null;
  const dismiss = (c: QuickWinCard) => {
    const next = { ...dismissed, [c.def.id]: c.mails };
    saveDismissed(account, next);
    setDismissed(next);
  };

  return (
    <section aria-label={t("qw.title")}
      className="mb-3 rounded-card border border-line bg-panel p-3">
      <div className="flex items-center gap-2">
        <Zap size={16} className="shrink-0 text-accent" aria-hidden />
        <h2 className="min-w-0 flex-1 type-heading">
          {t("qw.title")}
          <span className="type-meta text-muted">
            {" - "}{t("qw.free_up", { size: fmtSize(total.size) })}
          </span>
        </h2>
        <Button variant="quiet" size="icon" aria-expanded={!collapsed}
          label={collapsed ? t("qw.show") : t("qw.hide")} onClick={toggle}>
          {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
        </Button>
      </div>
      {!collapsed && (
        <>
          {/* Phones: one compact row - no hint line, dismiss as an icon in the
              card head, More as the row's last tile - so the strip stays short. */}
          <ul className="mt-2 flex snap-x snap-mandatory gap-2
            overflow-x-auto pb-1 md:grid md:grid-cols-3 md:overflow-visible">
            {shown.map((c) => (
              <li key={c.def.id} data-testid="qw-card"
                className="flex w-72 shrink-0 snap-start flex-col gap-1.5
                  rounded-card border border-line bg-panel2 p-2.5
                  md:w-auto md:gap-2 md:p-3">
                <div className="flex items-start gap-1">
                  <div className="min-w-0 flex-1">
                    <div className="type-body">{t(c.def.titleKey)}</div>
                    <div className="type-meta text-muted">
                      {t("qw.card_meta", { mails: c.mails,
                        size: fmtSize(c.size) })}
                      {c.protectedSkipped > 0 && (
                        <> · {t("qw.protected_skipped",
                          { n: c.protectedSkipped })}</>
                      )}
                    </div>
                    <div data-testid="qw-hint"
                      className="hidden type-caption text-faint md:block">
                      {t(c.def.hintKey)}
                    </div>
                  </div>
                  <Button variant="quiet" size="icon" label={t("qw.not_now")}
                    className="-mr-1 -mt-1 shrink-0" onClick={() => dismiss(c)}>
                    <X size={16} />
                  </Button>
                </div>
                <div className="mt-auto flex items-center gap-2">
                  <Button variant="secondary" size="sm"
                    onClick={() => onReview(c)}>{t("qw.review")}</Button>
                  <Button size="sm" onClick={() => onCleanUp(c)}>
                    {t("qw.clean_up")}
                  </Button>
                </div>
              </li>
            ))}
            {moreToggle && (
              <li className="flex shrink-0 snap-start items-center md:hidden">
                {moreToggle("h-full")}
              </li>
            )}
          </ul>
          {moreToggle && (
            <div className="mt-1 hidden md:block">{moreToggle("")}</div>
          )}
        </>
      )}
    </section>
  );
}
