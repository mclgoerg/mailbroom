import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { api, fmtSize } from "../api";
import { t } from "../i18n";
import type { AuditEntry, Rule } from "../types";
import { Button, EmptyState, Loading, PanelHeader, Modal, Toolbar } from "./ui";

const PAGE_SIZE = 50;

/** Rules are referenced by id (stable across renames); resolve to the
 *  rule's current name for display, falling back to the id if it was
 *  since deleted. */
const actorLabel = (actor: string, rules: Rule[]): string => {
  if (!actor.startsWith("rule:")) return t("audit.by", { actor: t(actor) });
  const id = actor.slice(5);
  const name = rules.find((r) => r.id === id)?.name;
  return t("audit.by_rule", { name: name || id });
};

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
export function AuditLogPanel({ rules, onClose }: {
  rules: Rule[]; onClose: () => void;
}) {
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
        title={<span className="inline-flex items-center gap-2">
          <ScrollText size={18} /> {t("Audit Log")}
        </span>}
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
          <ChevronLeft size={16} className="mr-1 inline align-text-bottom" />
          {t("Previous")}
        </Button>
        <Button variant="ghost"
          disabled={total == null || offset + PAGE_SIZE >= total}
          onClick={() => setOffset(offset + PAGE_SIZE)}>
          {t("Next")}
          <ChevronRight size={16} className="ml-1 inline align-text-bottom" />
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
                {actorLabel(e.actor, rules)}
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
