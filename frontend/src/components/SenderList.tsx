import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import { FILE_KINDS, smartReason } from "../smart";
import type { Group } from "../types";
import { GroupTable } from "./GroupTable";
import { Button, choiceDialog, Input, LINK, Select } from "./ui";

type SenderSort = "count" | "last" | "size" | "label";
// Reasons the panel's own "why" line already says for EVERY sender of the row
// (the same sentence on each card would only be noise); the per-sender
// specifics - "3 of 4 mails are about orders", a category conflict, being
// placed with a small company - stay.
const EXPLAINED_ABOVE = new Set(["company", "protected", "replied", "own"]);
export type SenderAction = "trash" | "archive" | "move" | "mark_read";
/** One thing to file: `a:<address>` for a sender, `co:<company>` for a
 *  whole company, under a fixed kind or `cat:<name>`. */
export type FileEntry = { key: string; kind: string };
// Rows that structure alone decides: filing a sender in them changes nothing.
const NOT_FILEABLE = new Set(["company", "protected", "replied"]);

/** Newest first / biggest first; names A-Z. The address breaks ties, so a
 *  refresh never reshuffles equal rows. */
export function sortSenders(list: Group[], by: SenderSort): Group[] {
  const key = (g: Group) => by === "count" ? g.count : by === "size" ? g.size : 0;
  return [...list].sort((a, b) => {
    if (by === "label") {
      return (a.label || a.key).localeCompare(b.label || b.key)
        || a.key.localeCompare(b.key);
    }
    if (by === "last") {
      return (b.last || "").localeCompare(a.last || "")
        || a.key.localeCompare(b.key);
    }
    return key(b) - key(a) || a.key.localeCompare(b.key);
  });
}

/** Free-text filter over the address and display name (every word must hit). */
export function filterSenders(list: Group[], query: string): Group[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((g) => {
    const hay = `${g.key} ${g.label}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The senders inside one pooled Smart row: what each is (mails, last date),
 *  why it is here, and the actions that make sense for a SENDER - trash,
 *  archive / move, mark read, protect. Every action resolves to the exact
 *  sender addresses ticked here (never the row's domain or its parent
 *  bucket). The selection survives refreshes (it is kept by address), drops
 *  senders that are gone, and ends with the panel (so with a group or
 *  account change). Unsubscribe is NOT offered here: it stays an explicit
 *  single-sender action inside one sender's own detail view. */
export function SenderList({ senders, folders, onAct, onProtect, onInspect,
  onAckUnsub, onSelectedChange, rowKind, categories = [], onFile }: {
  senders: Group[];                      // live sender records of this row
  folders: string[];
  onAct: (keys: string[], action: SenderAction, dest?: string) => Promise<boolean>;
  onProtect: (keys: string[]) => Promise<boolean>;
  onInspect: (g: Group) => void;
  onAckUnsub: (addr: string) => void;
  // How many senders are ticked (the panel hides its whole-group red button
  // while this bar owns the destructive action).
  onSelectedChange?: (n: number) => void;
  // "File in Smart as...": the kind of the pooled row these senders are in,
  // the user's own categories (a sender can be filed into one), and the
  // filing itself - given the senders ticked, to word the confirmation.
  rowKind?: string;
  categories?: string[];
  onFile?: (entries: FileEntry[], senders: number) => Promise<boolean>;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SenderSort>("count");
  const [moveDest, setMoveDest] = useState("");
  const [filing, setFiling] = useState(false);        // the kind picker is open
  const [working, setWorking] = useState(false);
  const fileBlocked = NOT_FILEABLE.has(rowKind ?? "");

  // Ordinary refreshes keep the selection by sender identity; a sender that
  // is gone (trashed, protected into another row) drops out of it.
  const present = useMemo(() => new Set(senders.map((g) => g.key)), [senders]);
  useEffect(() => {
    setSel((cur) => {
      const kept = [...cur].filter((k) => present.has(k));
      return kept.length === cur.size ? cur : new Set(kept);
    });
  }, [present]);

  const shown = useMemo(
    () => sortSenders(filterSenders(senders, query), sortBy),
    [senders, query, sortBy]);
  const byKey = useMemo(
    () => new Map(senders.map((g) => [g.key, g])), [senders]);
  const keys = useMemo(() => [...sel].filter((k) => byKey.has(k)), [sel, byKey]);
  const mails = keys.reduce((n, k) => n + (byKey.get(k)?.count ?? 0), 0);
  useEffect(() => {
    if (!keys.length) { setMoveDest(""); setFiling(false); }
  }, [keys.length]);
  useEffect(() => { onSelectedChange?.(keys.length); }, [keys.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k: string) => {
    const next = new Set(sel);
    next.has(k) ? next.delete(k) : next.add(k);
    setSel(next);
  };
  const run = async (task: Promise<boolean>) => {
    setWorking(true);
    try { if (await task) setSel(new Set()); }
    finally { setWorking(false); }
  };
  // File the ticked senders under `kind`. A ticked sender that belongs to a
  // small company group asks first: just the ticked ones (they leave the
  // group) or the whole company.
  const fileAs = async (kind: string) => {
    setFiling(false);
    const picked = keys.map((k) => byKey.get(k)!);
    const companies = new Set(picked.map((g) => g.smart_why?.co)
      .filter((c): c is string => !!c));
    let whole = false;
    if (companies.size) {
      const inGroups = senders.filter((g) => g.smart_why?.co
        && companies.has(g.smart_why.co)).length;
      const choice = await choiceDialog({ title: t("know.scope_title"),
        body: t("know.scope_body"), confirmLabel: t("know.scope_sender"),
        altLabel: t("know.scope_company", { n: inGroups }) });
      if (choice === null) return;
      whole = choice === "alt";
    }
    const entries = new Map<string, string>();
    for (const g of picked) {
      const co = g.smart_why?.co;
      entries.set(whole && co ? `co:${co}` : `a:${g.key}`, kind);
    }
    await run(onFile!([...entries].map(([key, k]) => ({ key, kind: k })),
      picked.length));
  };
  const onAction = (v: string) => {
    if (v === "move") setMoveDest("?");
    else if (v === "file") setFiling(true);
    else if (v === "protect") run(onProtect(keys));
    else if (v) run(onAct(keys, v as SenderAction));
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-line
        px-4 py-2">
        <Input type="search" className="min-w-0 flex-1 sm:w-56 sm:flex-none"
          value={query} placeholder={t("senders.search")}
          aria-label={t("senders.search")}
          onChange={(e) => setQuery(e.target.value)} />
        <Select value={sortBy} className="w-auto shrink-0"
          aria-label={t("senders.sort")}
          onChange={(e) => setSortBy(e.target.value as SenderSort)}>
          <option value="count">{t("senders.sort_count")}</option>
          <option value="last">{t("senders.sort_last")}</option>
          <option value="size">{t("senders.sort_size")}</option>
          <option value="label">{t("senders.sort_label")}</option>
        </Select>
        {shown.length > 0 && keys.length < shown.length && (
          <button className={`${LINK} type-meta`}
            onClick={() => setSel(new Set([...sel, ...shown.map((g) => g.key)]))}>
            {t("senders.select_shown", { n: shown.length })}
          </button>
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto pb-2">
        {shown.length === 0 ? (
          <div className="p-4 type-body text-muted">{t("senders.none")}</div>
        ) : (
          <GroupTable groups={shown} selected={sel} focusedKey={null}
            onToggle={toggle}
            onToggleAll={(checked, ks) => {
              const next = new Set(sel);
              ks.forEach((k) => checked ? next.add(k) : next.delete(k));
              setSel(next);
            }}
            onOpen={onInspect} onAckUnsub={onAckUnsub}
            sortK="count" sortDir={-1} onSort={() => {}}
            groupLabel={t("Sender")} grouping="sender" cards
            resetSignal={`${query}|${sortBy}`}
            rowNote={(g) => EXPLAINED_ABOVE.has(g.smart_why?.r ?? "") ? ""
              : smartReason(g.smart_why)} />
        )}
      </div>

      {keys.length > 0 && (
        <div className="border-t border-line bg-panel2 px-4 py-2"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}>
          <div className="mb-2 flex flex-wrap items-center gap-2 type-meta
            text-muted">
            <span>{t("senders.selected", { n: keys.length,
              total: senders.length, mails })}</span>
            <button className={LINK} onClick={() => setSel(new Set())}>
              {t("Clear selection")}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* The Action… select stays mounted while the folder picker is
                open: swapping one select for another in place left stale
                options in iOS' native list (same lesson as the bulk bar). */}
            <Select value="" className="min-w-28 flex-1" disabled={working}
              onChange={(e) => onAction(e.target.value)}>
              <option value="" disabled>{t("Action…")}</option>
              <option value="archive">{t("Archive")}</option>
              <option value="move">{t("Move to folder…")}</option>
              <option value="mark_read">{t("Mark read")}</option>
              <option value="protect">{t("senders.protect")}</option>
              {onFile && (
                <option value="file" disabled={fileBlocked}>
                  {t("know.file_action")}
                </option>
              )}
            </Select>
            {moveDest === "?" && (
              <>
                <Select value="" className="min-w-0 flex-1"
                  onChange={(e) => {
                    if (e.target.value) run(onAct(keys, "move", e.target.value));
                    setMoveDest("");
                  }}>
                  <option value="" disabled>{t("Move to folder…")}</option>
                  {folders.map((f) => <option key={f} value={f}>{f}</option>)}
                </Select>
                <Button variant="secondary" size="icon" label={t("Cancel")}
                  className="shrink-0" onClick={() => setMoveDest("")}>
                  <X size={18} />
                </Button>
              </>
            )}
            {filing && (
              <>
                <Select value="" className="min-w-28 flex-1"
                  aria-label={t("know.file_action")}
                  onChange={(e) => { if (e.target.value) fileAs(e.target.value); }}>
                  <option value="" disabled>{t("know.file_action")}</option>
                  {FILE_KINDS.map((k) => (
                    <option key={k} value={k}>{t(`smart.kind.${k}`)}</option>
                  ))}
                  {categories.map((c) => (
                    <option key={c} value={`cat:${c}`}>
                      {t("know.kind_category", { name: c })}
                    </option>
                  ))}
                </Select>
                <Button variant="secondary" size="icon" label={t("Cancel")}
                  className="shrink-0" onClick={() => setFiling(false)}>
                  <X size={18} />
                </Button>
              </>
            )}
            <Button variant="danger" disabled={working}
              className="ml-auto shrink-0"
              onClick={() => run(onAct(keys, "trash"))}>
              {t("Trash selected")} ({keys.length})
            </Button>
          </div>
          {onFile && (filing || fileBlocked) && (
            <p className="mt-2 type-meta text-muted">
              {filing ? t("know.file_help") : t(`know.blocked.${rowKind}`)}
            </p>
          )}
        </div>
      )}
    </>
  );
}
