import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { fmtSize as fmtSmall } from "../lib";

/** Like fmtSize, plus GB - volumes and big indexes outgrow 1000 MB. */
const fmtSize = (b: number): string =>
  b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : fmtSmall(b);
import type { BodySearchMode, IndexEstimate, IndexInfo } from "../types";
import { Button, ProgressBar, Spinner } from "./ui";

/** Settings -> mail-text search = "local index": status of the account's
 *  keyed word index plus build / update / rebuild / cancel / delete. The
 *  panel talks to the SAVED configuration: the mode has to be saved as
 *  "local" before an index can be built. */
export function IndexPanel({ account, savedMode, secretKeySet }: {
  account: string;
  savedMode: BodySearchMode;
  secretKeySet: boolean;
}) {
  const [info, setInfo] = useState<IndexInfo | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);
  // Nothing to ask the server about until the mode is saved as "local".
  const enabled = secretKeySet && savedMode === "local";

  const load = useCallback(() => {
    if (!enabled) return;
    api.indexInfo(account)
      .then((i) => alive.current && setInfo(i))
      .catch((e) => alive.current && setError(String(e.message ?? e)));
  }, [account, enabled]);

  useEffect(() => {
    alive.current = true;
    setInfo(null);
    load();
    return () => { alive.current = false; };
  }, [load]);

  // Follow a running job.
  const running = info?.job.status === "running";
  useEffect(() => {
    if (!running) return;
    const h = setInterval(load, 1500);
    return () => clearInterval(h);
  }, [running, load]);

  const act = async (fn: () => Promise<unknown>) => {
    setError("");
    try { await fn(); } catch (e: any) { setError(String(e.message ?? e)); }
    load();
  };

  const params = (est: IndexEstimate) => ({
    n: est.mails, size: fmtSize(est.bytes), max: fmtSize(est.bytes_max),
    free: fmtSize(est.free) });
  const tight = (est: IndexEstimate) =>
    est.free > 0 && est.bytes_max > est.free * 0.9;

  const build = (rebuild: boolean) => {
    const est = rebuild ? info!.estimate_full : info!.estimate;
    // Nothing to read (e.g. an up-to-date index): nothing to consent to.
    if (est.mails > 0 && !confirm(
      t("index.confirm", params(est))
        + (tight(est) ? "\n\n" + t("index.confirm_tight") : ""))) return;
    act(() => api.indexBuild(account, rebuild));
  };

  if (!secretKeySet) {
    return <p className="mt-2 text-xs text-muted">{t("index.need_key")}</p>;
  }
  if (savedMode !== "local") {
    return <p className="mt-2 text-xs text-muted">{t("index.save_first")}</p>;
  }
  if (!info) return <div className="mt-2"><Spinner /></div>;

  const built = info.built_ts
    ? new Date(info.built_ts * 1000).toLocaleString() : "";
  return (
    <div className="mt-2 flex flex-col gap-2">
      {running && (
        <div className="flex flex-col gap-1">
          <ProgressBar value={info.job.done} max={info.job.total}
            label={t("index.building")} />
          <div className="text-xs text-muted">
            <Spinner /> {t("index.building")} {info.job.progress}
            {info.job.total > 0 && (
              ` (${Math.round(100 * info.job.done / info.job.total)}%)`
            )}
          </div>
        </div>
      )}
      <div className="text-xs text-muted">
        {info.job.status === "running"
          ? null
          : info.usable
            ? t("index.status", { docs: info.docs, ts: built })
            : info.reason === "index_key"
              ? t("index.key_changed") : t("index.none")}
        {info.job.status === "error" && (
          <span className="ml-2 text-rose-400">{info.job.error}</span>
        )}
      </div>
      {info.exists && (
        <div className="text-xs text-muted">
          {t("index.disk", { size: fmtSize(info.bytes) })}
        </div>
      )}
      {!running && info.estimate.mails > 0 && (
        <div className={`text-xs ${tight(info.estimate)
          ? "text-rose-400" : "text-muted"}`}>
          {t("index.estimate", params(info.estimate))}
          {tight(info.estimate) && ` ${t("index.confirm_tight")}`}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {running ? (
          <Button variant="ghost" onClick={() => act(() =>
            api.indexCancel(account))}>{t("cancel")}</Button>
        ) : (<>
          <Button onClick={() => build(false)}>
            {info.usable ? t("index.update") : t("index.build")}
          </Button>
          {info.usable && (
            <Button variant="ghost" onClick={() => build(true)}>
              {t("index.rebuild")}
            </Button>
          )}
          {info.exists && (
            <Button variant="ghost" onClick={() => {
              if (confirm(t("index.confirm_delete")))
                act(() => api.indexDelete(account));
            }}>{t("index.delete")}</Button>
          )}
        </>)}
      </div>
      {error && <div className="text-xs text-rose-400">{error}</div>}
    </div>
  );
}
