import { useEffect, useState } from "react";
import { api, fmtSize } from "../api";
import { t } from "../i18n";
import type { StatsResp } from "../types";
import { Loading, Modal, PanelHeader, SectionLabel } from "./ui";

const month = () => new Date().toISOString().slice(0, 7);

/** Mailbox statistics: per-year histogram, top domains by size, cleanup
 *  progress (per-month action tallies + scan history). */
export function StatsPanel({ onClose }: { onClose: () => void }) {
  const [stats, setStats] = useState<StatsResp | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api.stats()
      .then((s) => alive && setStats(s))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, []);

  const maxYear = Math.max(1, ...(stats?.years ?? []).map((y) => y.count));
  const thisMonth = stats?.actions?.[month()];
  const months = Object.keys(stats?.actions ?? {}).sort().reverse();

  return (
    <Modal onClose={onClose}>
      <PanelHeader title={<>📊 {t("Statistics")}</>} onClose={onClose} />
      <div className="space-y-5 p-5 text-sm">
        {error && <div className="text-rose-400">{error}</div>}
        {!stats && !error && <Loading />}
        {stats && (
          <>
            <div className="text-muted">
              {t("stats.current", { mails: stats.mails,
                size: fmtSize(stats.size) })}
              {thisMonth && (
                <> — {t("stats.this_month", { n: thisMonth.trash,
                  size: fmtSize(thisMonth.freed) })}</>
              )}
            </div>

            <div>
              <SectionLabel className="mb-2">{t("stats.per_year")}</SectionLabel>
              {stats.years.map((y) => (
                <div key={y.year} className="mb-1 flex items-center gap-2">
                  <span className="w-14 text-xs tabular-nums text-muted">
                    {y.year}
                  </span>
                  <div className="h-4 rounded bg-accent/70"
                    style={{ width: `${(100 * y.count) / maxYear}%`,
                             minWidth: 2 }} />
                  <span className="text-xs whitespace-nowrap text-faint">
                    {y.count} · {fmtSize(y.size)}
                  </span>
                </div>
              ))}
            </div>

            <div>
              <SectionLabel className="mb-2">{t("stats.top_domains")}</SectionLabel>
              {stats.top_domains.map((d) => (
                <div key={d.domain}
                  className="flex items-baseline gap-2 border-b
                    border-line/60 py-1">
                  <span className="min-w-0 flex-1 truncate">{d.domain}</span>
                  <span className="text-xs text-muted">{d.count} {t("mails")}</span>
                  <span className="w-20 text-right text-xs tabular-nums
                    text-faint">{fmtSize(d.size)}</span>
                </div>
              ))}
            </div>

            {months.length > 0 && (
              <div>
                <SectionLabel className="mb-2">{t("stats.cleanup")}</SectionLabel>
                {months.slice(0, 6).map((m) => {
                  const a = stats.actions[m];
                  return (
                    <div key={m} className="flex items-baseline gap-2 py-0.5
                      text-xs text-muted">
                      <span className="w-16 tabular-nums">{m}</span>
                      <span>
                        {t("stats.actions_line", { trash: a.trash,
                          archive: a.archive, move: a.move,
                          read: a.mark_read, size: fmtSize(a.freed) })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {stats.scans.length > 1 && (
              <div>
                <SectionLabel className="mb-2">{t("stats.scans")}</SectionLabel>
                {stats.scans.slice(-8).reverse().map((s) => (
                  <div key={s.ts} className="flex items-baseline gap-2 py-0.5
                    text-xs text-muted">
                    <span className="w-32 tabular-nums">
                      {new Date(s.ts * 1000).toLocaleString()}
                    </span>
                    <span>{s.mails} {t("mails")} · {s.senders}{" "}
                      {t("groups")} · {fmtSize(s.size)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
