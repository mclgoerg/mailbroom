import { Eye } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, fmtSize } from "../api";
import { t } from "../i18n";
import type { TrackerReport } from "../types";
import { Button, confirmDialog, EmptyState, Loading, Modal, PanelHeader,
  ProgressBar, SectionLabel, Spinner, Tag } from "./ui";

const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);

function Card({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="rounded-card bg-panel2 p-3">
      <div className="type-heading tabular-nums">{value}</div>
      <div className="type-meta text-muted">{label}</div>
    </div>
  );
}

/** Tools -> Trackers: which senders put tracking pixels or click-tracking
 *  links in their mail. Everything comes from the local body index (the
 *  detection runs while it is built), so without an index the panel says
 *  so and offers the build; mails indexed before this feature get a
 *  "Check older mails" rebuild. */
export function TrackersPanel({ account, onClose, onPickSender }: {
  account: string;
  onClose: () => void;
  /** A sender row was tapped: the caller filters the list to it. */
  onPickSender: (key: string) => void;
}) {
  const [rep, setRep] = useState<TrackerReport | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);

  const load = useCallback(() => {
    api.trackers()
      .then((r) => alive.current && setRep(r))
      .catch((e) => alive.current && setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    return () => { alive.current = false; };
  }, [load]);

  // Follow a running index job.
  const running = rep?.job.status === "running";
  useEffect(() => {
    if (!running) return;
    const h = setInterval(load, 1500);
    return () => clearInterval(h);
  }, [running, load]);

  const build = async (rebuild: boolean) => {
    if (!rep) return;
    const est = rep.estimate_full;
    if (est.mails > 0 && !await confirmDialog({
      title: t(rebuild ? "tracker.check_older" : "tracker.build"),
      bullets: [
        t("index.confirm_read", { n: est.mails }),
        t("tracker.confirm_note"),
        t("index.confirm_disk", { size: fmtSize(est.bytes),
          max: fmtSize(est.bytes_max), free: fmtSize(est.free) }),
        t("index.confirm_time"),
      ],
      confirmLabel: t(rebuild ? "tracker.check_older" : "tracker.build"),
    })) return;
    setError("");
    try { await api.indexBuild(account, rebuild); }
    catch (e: any) { setError(String(e.message ?? e)); }
    load();
  };

  const body = () => {
    if (!rep) return error ? null : <Loading />;
    if (!rep.scanned) {
      return <EmptyState icon={<Eye size={18} />}
        title={t("tracker.scan_first")} />;
    }
    if (running) {
      return (
        <div className="flex flex-col gap-1 p-4">
          <ProgressBar value={rep.job.done} max={rep.job.total}
            label={t("tracker.checking")} />
          <div className="type-meta text-muted">
            <Spinner /> {t("tracker.checking")} {rep.job.progress}
          </div>
        </div>
      );
    }
    if (!rep.usable) {
      const hint = !rep.secret_key_set ? t("index.need_key")
        : rep.mode !== "local" ? t("tracker.enable_local")
        : rep.reason === "index_key" ? t("index.key_changed")
        : t("tracker.none_hint");
      return (
        <EmptyState icon={<Eye size={18} />} title={t("tracker.none_title")}
          hint={hint}
          action={rep.secret_key_set && rep.mode === "local" ? (
            <Button onClick={() => build(false)}>{t("tracker.build")}</Button>
          ) : undefined} />
      );
    }
    const missing = Math.max(0, rep.docs - rep.checked);
    const checkOlder = missing > 0 && (
      <Button variant="secondary" onClick={() => build(true)}>
        {t("tracker.check_older")}
      </Button>
    );
    if (rep.checked === 0) {
      return (
        <EmptyState icon={<Eye size={18} />}
          title={t("tracker.unchecked_title")}
          hint={t("tracker.unchecked_hint")} action={checkOlder || undefined} />
      );
    }
    return (
      <div className="space-y-6 p-4 type-body sm:p-5">
        <div>
          <div className="type-heading">
            {rep.pixel > 0
              ? t("tracker.headline", { pct: pct(rep.pixel, rep.checked) })
              : t("tracker.headline_none")}
          </div>
          <p className="mt-1 type-meta text-muted">{t("tracker.explainer")}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Card value={rep.pixel.toLocaleString()}
            label={t("tracker.with_pixel")} />
          <Card value={rep.click.toLocaleString()}
            label={t("tracker.with_click")} />
          <Card value={rep.senders.toLocaleString()}
            label={t("tracker.senders")} />
        </div>
        <div className="flex flex-wrap items-center gap-2 type-meta text-muted">
          <span>{t("tracker.checked",
            { n: rep.checked.toLocaleString(),
              total: rep.docs.toLocaleString() })}</span>
          {checkOlder}
        </div>

        {rep.top_senders.length > 0 && (
          <div>
            <SectionLabel className="mb-2">
              {t("tracker.top_senders")}
            </SectionLabel>
            <ul className="-mx-4 border-y border-line sm:-mx-5">
              {rep.top_senders.map((s) => (
                <li key={s.key} className="border-b border-line last:border-0">
                  <button type="button" onClick={() => onPickSender(s.key)}
                    aria-label={t("tracker.pick", { name: s.label })}
                    className="flex w-full cursor-pointer items-center gap-3
                      px-4 py-2 text-left hover:bg-chip sm:px-5
                      coarse:min-h-11">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{s.label}</span>
                      <span className="block truncate type-meta text-muted">
                        {s.key}
                      </span>
                      <span className="block type-meta text-muted">
                        {t("tracker.sender_meta",
                          { n: s.tracked, of: s.checked })}
                        {s.hosts.length > 0 && ` · ${s.hosts.join(", ")}`}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      {s.pixel > 0 && (
                        <Tag tone="info">{t("tracker.tag_pixel")}</Tag>
                      )}
                      {s.click > 0 && (
                        <Tag tone="info">{t("tracker.tag_click")}</Tag>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {rep.top_hosts.length > 0 && (
          <div>
            <SectionLabel className="mb-2">{t("tracker.top_hosts")}</SectionLabel>
            <ul className="space-y-1">
              {rep.top_hosts.map((h) => (
                <li key={h.host} className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate">{h.host}</span>
                  <span className="shrink-0 type-meta text-muted">
                    {t("n.mails", { n: h.mails })} ·{" "}
                    {t("tracker.n_senders", { n: h.senders })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {rep.top_senders.length === 0 && (
          <div className="type-meta text-muted">
            {t("tracker.nothing_found", { n: rep.checked })}
          </div>
        )}
      </div>
    );
  };

  return (
    <Modal onClose={onClose} size="lg">
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <Eye size={18} /> {t("tracker.title")}
        </span>}
        sub={t("tracker.sub")} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <div className="p-4 type-body text-danger-fg">{error}</div>}
        {body()}
      </div>
    </Modal>
  );
}
