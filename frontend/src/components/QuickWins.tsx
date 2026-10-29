import { ChevronDown, ChevronRight, Zap } from "lucide-react";
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
          <ul className="mt-2 flex snap-x snap-mandatory gap-2
            overflow-x-auto pb-1 md:grid md:grid-cols-3 md:overflow-visible">
            {shown.map((c) => (
              <li key={c.def.id} data-testid="qw-card"
                className="flex w-72 shrink-0 snap-start flex-col gap-2
                  rounded-card border border-line bg-panel2 p-3
                  md:w-auto">
                <div className="min-w-0">
                  <div className="type-body">{t(c.def.titleKey)}</div>
                  <div className="type-meta text-muted">
                    {t("qw.card_meta", { mails: c.mails,
                      size: fmtSize(c.size) })}
                  </div>
                  <div className="type-caption text-faint">
                    {t(c.def.hintKey)}
                    {c.protectedSkipped > 0 && (
                      <> · {t("qw.protected_skipped",
                        { n: c.protectedSkipped })}</>
                    )}
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm"
                    onClick={() => onReview(c)}>{t("qw.review")}</Button>
                  <Button size="sm" onClick={() => onCleanUp(c)}>
                    {t("qw.clean_up")}
                  </Button>
                  <Button variant="quiet" size="sm" onClick={() => dismiss(c)}>
                    {t("qw.not_now")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {cards.length > TOP_CARDS && (
            <Button variant="quiet" size="sm" className="mt-1"
              onClick={() => setMore(!more)}>
              {more ? t("qw.less")
                : t("qw.more", { n: cards.length - TOP_CARDS })}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
