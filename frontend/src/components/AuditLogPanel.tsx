import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { api, downloadFile, fmtSize } from "../api";
import { t } from "../i18n";
import type { AuditEntry, Rule } from "../types";
import { Button, EmptyState, Loading, PanelHeader, Modal } from "./ui";

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
    <Modal onClose={onClose} full={!entries || entries.length > 0}>
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <ScrollText size={18} /> {t("Audit Log")}
        </span>}
        sub={total == null ? t("loading…") : total === 0 ? "" : t("audit.page", {
          from: offset + 1, to: Math.min(offset + PAGE_SIZE, total), total })}
        actions={!!total && (
          <Button variant="secondary"
            onClick={() => downloadFile(api.auditExportUrl())}
            title={t("audit.export")}>CSV</Button>)}
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {error && <div className="p-4 type-body text-danger-fg">{error}</div>}
        {!entries && !error && <Loading />}
        {entries && entries.length === 0 && (
          <EmptyState icon={<ScrollText size={18} />}
            title={t("audit.empty")} hint={t("audit.empty_hint")} />
        )}
        {entries?.map((e, i) => (
          <div key={`${e.ts}-${i}`}
            className="flex flex-wrap items-baseline gap-2 border-b
              border-line/60 px-1 py-2 type-body">
            <span className="w-36 shrink-0 type-meta whitespace-nowrap
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
              <span className="block truncate type-meta text-muted">
                {actorLabel(e.actor, rules)}
              </span>
            </span>
            {e.count > 0 && (
              <span className="type-meta whitespace-nowrap text-muted">
                {e.count} {t("mails")}
                {e.bytes > 0 ? ` · ${fmtSize(e.bytes)}` : ""}
              </span>
            )}
            <span className={`type-meta whitespace-nowrap ${
              e.outcome === "error" || e.outcome === "failed"
                ? "text-danger-fg" : "text-muted"}`}
              title={e.error || undefined}>
              {tOr("audit.outcome", e.outcome)}
            </span>
          </div>
        ))}
      </div>
      {!!total && (
        <div className="flex justify-end gap-2 border-t border-line px-4 py-2">
          <Button variant="secondary" size="sm" disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            <ChevronLeft size={16} className="mr-1 inline align-text-bottom" />
            {t("Previous")}
          </Button>
          <Button variant="secondary" size="sm"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}>
            {t("Next")}
            <ChevronRight size={16} className="ml-1 inline align-text-bottom" />
          </Button>
        </div>
      )}
    </Modal>
  );
}
