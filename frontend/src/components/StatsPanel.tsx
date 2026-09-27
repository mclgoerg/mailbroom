import { useEffect, useState, type ReactNode } from "react";
import { api, fmtSize } from "../api";
import { t } from "../i18n";
import type { StatsResp } from "../types";
import { Loading, Modal, PanelHeader, SectionLabel, Tag } from "./ui";

const month = () => new Date().toISOString().slice(0, 7);
const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);

function Card({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="rounded-lg bg-panel2 p-3">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function Bars({ rows }: {
  rows: { label: string; count: number; size: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <>
      {rows.map((r) => (
        <div key={r.label} className="mb-1 flex items-center gap-2">
          <span className="w-20 truncate text-xs tabular-nums text-muted">
            {r.label}
          </span>
          <div className="h-4 rounded bg-accent/70"
            style={{ width: `${(100 * r.count) / max}%`, minWidth: 2 }} />
          <span className="text-xs whitespace-nowrap text-faint">
            {r.count} · {fmtSize(r.size)}
          </span>
        </div>
      ))}
    </>
  );
}

/** Mailbox statistics: highlights, volume histograms, categories, top
 *  domains/senders, AI coverage, cleanup progress and scan history. */
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

  const thisMonth = stats?.actions?.[month()];
  const months = Object.keys(stats?.actions ?? {}).sort().reverse();
  const ratedTotal = stats
    ? stats.rated_mails.delete_safe + stats.rated_mails.review
      + stats.rated_mails.keep
    : 0;

  return (
    <Modal onClose={onClose}>
      <PanelHeader title={<>📊 {t("Statistics")}</>} onClose={onClose} />
      <div className="space-y-5 p-5 text-sm">
        {error && <div className="text-rose-400">{error}</div>}
        {!stats && !error && <Loading />}
        {stats && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Card value={stats.mails.toLocaleString()} label={t("mails")} />
              <Card value={fmtSize(stats.size)} label={t("stats.total_size")} />
              <Card value={stats.senders.toLocaleString()}
                label={t("stats.senders")} />
              <Card value={stats.mails
                  ? fmtSize(Math.round(stats.size / stats.mails)) : "—"}
                label={t("stats.avg_size")} />
              <Card value={`${pct(stats.unread, stats.mails)}%`}
                label={`${t("stats.unread")} (${stats.unread.toLocaleString()})`} />
              <Card value={`${pct(stats.bulk, stats.mails)}%`}
                label={`${t("stats.newsletters")} (${stats.bulk.toLocaleString()})`} />
              <Card value={stats.replied_senders}
                label={t("stats.replied_senders",
                  { total: stats.senders })} />
              <Card value={stats.oldest || "—"} label={t("stats.oldest")} />
            </div>
            {thisMonth && (
              <div className="text-xs text-muted">
                {t("stats.this_month", { n: thisMonth.trash,
                  size: fmtSize(thisMonth.freed) })}
              </div>
            )}

            {stats.months.length > 1 && (
              <div>
                <SectionLabel className="mb-2">
                  {t("stats.per_month")}
                </SectionLabel>
                <Bars rows={stats.months.map((m) => ({
                  label: m.month, count: m.count, size: m.size }))} />
              </div>
            )}

            {stats.years.length > 1 && (
              <div>
                <SectionLabel className="mb-2">
                  {t("stats.per_year")}
                </SectionLabel>
                <Bars rows={stats.years.map((y) => ({
                  label: y.year, count: y.count, size: y.size }))} />
              </div>
            )}

            {stats.categories.length > 0 && (
              <div>
                <SectionLabel className="mb-2">
                  {t("stats.categories")}
                </SectionLabel>
                <Bars rows={stats.categories.map((c) => ({
                  label: c.tag, count: c.count, size: c.size }))} />
              </div>
            )}

            <div>
              <SectionLabel className="mb-2">
                {t("stats.top_senders")}
              </SectionLabel>
              {stats.top_senders.map((s) => (
                <div key={s.key}
                  className="flex items-baseline gap-2 border-b
                    border-line/60 py-1">
                  <span className="min-w-0 flex-1 truncate" title={s.key}>
                    {s.label}
                  </span>
                  <span className="text-xs text-muted">
                    {s.count} {t("mails")}
                  </span>
                  <span className="w-20 text-right text-xs tabular-nums
                    text-faint">{fmtSize(s.size)}</span>
                </div>
              ))}
            </div>

            <div>
              <SectionLabel className="mb-2">
                {t("stats.top_domains")}
              </SectionLabel>
              {stats.top_domains.map((d) => (
                <div key={d.domain}
                  className="flex items-baseline gap-2 border-b
                    border-line/60 py-1">
                  <span className="min-w-0 flex-1 truncate">{d.domain}</span>
                  <span className="text-xs text-muted">
                    {d.count} {t("mails")}
                  </span>
                  <span className="w-20 text-right text-xs tabular-nums
                    text-faint">{fmtSize(d.size)}</span>
                </div>
              ))}
            </div>

            <div>
              <SectionLabel className="mb-2">{t("stats.ai")}</SectionLabel>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <Tag className="!bg-emerald-950 !text-emerald-300">
                  {t("v.delete_safe")}: {stats.ai_groups.delete_safe}
                </Tag>
                <Tag className="!bg-amber-950 !text-amber-300">
                  {t("v.review")}: {stats.ai_groups.review}
                </Tag>
                <Tag className="!bg-rose-950 !text-rose-300">
                  {t("v.keep")}: {stats.ai_groups.keep}
                </Tag>
                <Tag>{t("v.unrated")}: {stats.ai_groups.unrated}</Tag>
                <span className="text-muted">
                  {t("stats.rated_mails", { n: ratedTotal,
                    safe: stats.rated_mails.delete_safe })}
                </span>
              </div>
            </div>

            {months.length > 0 && (
              <div>
                <SectionLabel className="mb-2">
                  {t("stats.cleanup")}
                </SectionLabel>
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
