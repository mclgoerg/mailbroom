import { useEffect, useState } from "react";
import { api, fmtSize } from "../api";
import { t } from "../i18n";
import type { AuditEntry } from "../types";
import { Button, EmptyState, Loading, PanelHeader, Modal, Toolbar } from "./ui";

const PAGE_SIZE = 50;

const actorLabel = (actor: string): string =>
  actor.startsWith("rule:") ? t("audit.by_rule", { name: actor.slice(5) })
    : t("audit.by", { actor: t(actor) });

/** `t()` with a tiered fallback: a `prefix.<key>` translation, or the raw
 *  key itself when there is no (yet) translated entry for it. */
const tOr = (prefix: string, key: string): string => {
  const full = `${prefix}.${key}`;
  const s = t(full);
  return s === full ? key : s;
};

/** Append-only history of every action Mailbroom took on this mailbox:
 *  bulk/rule trash-archive-move-mark_read, rule runs, unsubscribes, undo,
 *  empty-trash. Paged, newest first, CSV export. */
export function AuditLogPanel({ onClose }: { onClose: () => void }) {
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState("");

  const load = (off: number) => {
    setEntries(null);
    api.audit(off, PAGE_SIZE)
      .then((r) => { setEntries(r.entries); setTotal(r.total); })
      .catch((e) => setError(String(e.message ?? e)));
  };
  useEffect(() => load(offset), [offset]);

  return (
    <Modal onClose={onClose} full>
      <PanelHeader
        title={<>📜 {t("Audit Log")}</>}
        sub={total != null
          ? t("audit.page", {
              from: total ? offset + 1 : 0,
              to: Math.min(offset + PAGE_SIZE, total), total })
          : t("loading…")}
        actions={
          <a href={api.auditExportUrl()} download
            className="min-h-9 rounded-md bg-chip px-3 py-1.5 text-sm
              font-medium text-body hover:bg-chiph"
            title={t("audit.export")}>CSV</a>}
        onClose={onClose}
      />
      <Toolbar>
        <Button variant="ghost" disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          ← {t("Previous")}
        </Button>
        <Button variant="ghost"
          disabled={total == null || offset + PAGE_SIZE >= total}
          onClick={() => setOffset(offset + PAGE_SIZE)}>
          {t("Next")} →
        </Button>
      </Toolbar>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {error && <div className="p-4 text-sm text-rose-400">{error}</div>}
        {!entries && !error && <Loading />}
        {entries && entries.length === 0 && (
          <EmptyState>{t("audit.empty")}</EmptyState>
        )}
        {entries?.map((e, i) => (
          <div key={`${e.ts}-${i}`}
            className="flex flex-wrap items-baseline gap-2 border-b
              border-line/60 px-1 py-2 text-sm">
            <span className="w-36 shrink-0 text-xs whitespace-nowrap
              text-muted">
              {new Date(e.ts * 1000).toLocaleString()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-medium">
                {tOr("audit.act", e.action)}
              </span>
              {e.label && (
                <span className="ml-1 text-muted" title={e.label}>
                  — {e.label}
                </span>
              )}
              <span className="block truncate text-xs text-faint">
                {actorLabel(e.actor)}
              </span>
            </span>
            {e.count > 0 && (
              <span className="text-xs whitespace-nowrap text-muted">
                {e.count} {t("mails")}
                {e.bytes > 0 ? ` · ${fmtSize(e.bytes)}` : ""}
              </span>
            )}
            <span className={`text-xs whitespace-nowrap ${
              e.outcome === "error" || e.outcome === "failed"
                ? "text-rose-400" : "text-faint"}`}
              title={e.error || undefined}>
              {tOr("audit.outcome", e.outcome)}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
