import { useEffect, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { FILE_KINDS, filedKindName, smartReason } from "../smart";
import type { Group, KnowledgeEntry } from "../types";
import type { FileEntry } from "./SenderList";
import { LINK, Select, Tag } from "./ui";

/** "How Mailbroom files this sender": where the sender sits and why, a kind
 *  select to file it yourself (or back to Automatic), who filed it (you, or
 *  an AI answer you kept) and - when a filing of yours has no effect right
 *  now - why not. Filing never moves mail; it only decides the Smart row.
 *  The entries come from /api/knowledge and are reloaded whenever the
 *  mailbox state changes (`rev`). */
export function SenderFiling({ sender, rowLabel, categories, rev, onFile,
  onReset }: {
  sender: Group;                       // the live sender record
  rowLabel: string;                    // the Smart row it sits in now
  categories: string[];                // the user's own categories
  rev: number;                         // state revision: reload on change
  onFile: (entries: FileEntry[], senders: number) => Promise<boolean>;
  onReset: (keys: string[]) => Promise<boolean>;
}) {
  const [entries, setEntries] = useState<Map<string, KnowledgeEntry>>(new Map());
  const [busy, setBusy] = useState(false);       // one change at a time
  useEffect(() => {
    let alive = true;
    api.knowledge()
      .then((r) => alive && setEntries(new Map(r.entries.map((e) => [e.key, e]))))
      .catch(() => { /* the box still shows where the sender sits */ });
    return () => { alive = false; };
  }, [rev]);

  const why = sender.smart_why;
  const own = entries.get(`a:${sender.key}`);
  const decided = why?.r === "rule" || why?.r === "kept_ai";
  const deciding = decided && why?.entry ? entries.get(why.entry) : undefined;
  const byCompany = decided && why?.by === "co";
  // What the select shows: the user's own filing of THIS sender, else Auto.
  // (Until the entries are loaded - or when they cannot be - the sender's
  // own reason says it: a filing by its own entry is `rule` / `by: a`.)
  const ownKind = why?.r === "rule" && why.by === "a"
    ? (why.k === "category" ? `cat:${why.name ?? ""}` : why.k) : undefined;
  const mine = own ? (own.src === "user" ? own.kind : "auto") : (ownKind ?? "auto");
  const source = (deciding ?? own)?.src;
  // A filing of this sender (or its company) that does not decide right now.
  const idle = [own, deciding].find((e) => e && e.status !== "active");
  const known = new Set<string>([...FILE_KINDS, ...categories.map((c) => `cat:${c}`)]);
  // Reset what decides right now (so the sender visibly changes): the
  // company's rule when that is what decides, else the sender's own entry.
  const reset = byCompany && deciding
    ? { keys: [deciding.key], label: t("know.reset_company") }
    : own ? { keys: [own.key], label: t("know.reset") }
      : why?.r === "rule" && why.by === "a" && why.entry
        ? { keys: [why.entry], label: t("know.reset") } : null;

  const guarded = async (task: () => Promise<boolean | void>) => {
    if (busy) return;
    setBusy(true);
    try { await task(); } finally { setBusy(false); }
  };
  const choose = (v: string) => guarded(async () => {
    if (v === "auto") { if (own) await onReset([own.key]); }
    else await onFile([{ key: `a:${sender.key}`, kind: v }], 1);
  });

  return (
    <section aria-label={t("know.box_title")}
      className="space-y-2 border-b border-line bg-panel2 px-4 py-3">
      <div className="type-heading">{t("know.box_title")}</div>
      <p className="type-meta text-muted">
        {t("know.box_now", { row: rowLabel })} {smartReason(why)}
        {byCompany && ` ${t("know.box_company")}`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={mine} className="min-w-0 flex-1 sm:flex-none sm:w-64"
          aria-label={t("know.box_select")} disabled={busy}
          onChange={(e) => choose(e.target.value)}>
          <option value="auto">{t("know.box_auto")}</option>
          {FILE_KINDS.map((k) => (
            <option key={k} value={k}>{filedKindName(k)}</option>
          ))}
          {categories.map((c) => (
            <option key={c} value={`cat:${c}`}>{filedKindName(`cat:${c}`)}</option>
          ))}
          {mine !== "auto" && !known.has(mine) && (
            <option value={mine}>{filedKindName(mine)}</option>
          )}
        </Select>
        {source && (
          <Tag tone={source === "user" ? "info" : "neutral"}>
            {source === "user" ? t("know.src_user") : t("know.src_ai")}
          </Tag>
        )}
        {reset && (
          <button className={`${LINK} type-meta`} disabled={busy}
            onClick={() => guarded(() => onReset(reset.keys))}>
            {reset.label}
          </button>
        )}
      </div>
      {idle && idle.reason && (
        <p className="type-meta text-muted">
          {t(idle.src === "user" ? "know.no_effect" : "know.no_effect_ai",
            { why: t(`know.reason.${idle.reason}`) })}
        </p>
      )}
    </section>
  );
}
