import { ArrowDown, ArrowUp, Building2, Pencil, Trash2, User } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, saveBlob } from "../api";
import { t } from "../i18n";
import { FILE_KINDS, filedKindName } from "../smart";
import type { KnowledgeEntry, KnowledgeList, KnowledgeStored } from "../types";
import { Button, Checkbox, confirmDialog, EmptyState, Input, Loading,
  SectionLabel, Select, Tag, useMediaQuery, useToast } from "./ui";

/* "What Mailbroom knows about your senders" (Settings > Senders): everything
 * the user filed in Smart - by sender address or company - and the AI answers
 * they kept. A searchable, sortable list (a table, cards on a phone) with
 * inline edit, delete (also several at once), "Remove unused", keep / forget
 * of AI answers and download / upload of just this knowledge. Every change
 * applies at once on the server, so there is nothing to Save. */

type SortBy = "key" | "kind" | "src" | "senders" | "status" | "ts";
const PAGE = 50;
const NOTE_MAX = 200;

const isCompany = (e: KnowledgeEntry) => e.key.startsWith("co:");
const nameOf = (e: KnowledgeEntry) => e.key.slice(e.key.indexOf(":") + 1);
/** The status as one plain sentence. */
export function statusText(e: KnowledgeEntry): string {
  if (e.status === "no_effect" || e.status === "inactive"
      || e.status === "inert") {
    return t(`know.status.${e.status}`, { why: t(`know.reason.${e.reason}`) });
  }
  return t(`know.status.${e.status}`);
}
const STATUS_TONE: Record<string, "safe" | "review" | "keep" | "neutral"> = {
  active: "safe", no_effect: "review", inactive: "review", inert: "keep",
  unused: "neutral", unknown: "neutral" };
// "Needs a look" first: entries that do nothing sort before the active ones.
const STATUS_ORDER: Record<string, number> = { inert: 0, inactive: 1,
  unused: 2, no_effect: 3, unknown: 4, active: 5 };

export function sortEntries(list: KnowledgeEntry[], by: SortBy,
    dir: 1 | -1): KnowledgeEntry[] {
  const cmp = (a: KnowledgeEntry, b: KnowledgeEntry): number => {
    switch (by) {
      case "kind": return filedKindName(a.kind).localeCompare(filedKindName(b.kind));
      case "src": return a.src.localeCompare(b.src);
      case "senders": return a.senders - b.senders;
      case "status": return (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
      case "ts": return a.ts - b.ts;
      default: return nameOf(a).localeCompare(nameOf(b));
    }
  };
  return [...list].sort((a, b) => dir * cmp(a, b) || a.key.localeCompare(b.key));
}

/** Free-text search over the address / company, the kind, the note and the
 *  source (every word must hit). */
export function filterEntries(list: KnowledgeEntry[], query: string):
    KnowledgeEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((e) => {
    const hay = `${nameOf(e)} ${filedKindName(e.kind)} ${e.note} `
      + `${e.src === "ai" ? t("know.src_ai") : t("know.src_user")} `
      + `${isCompany(e) ? t("know.company") : ""}`;
    return words.every((w) => hay.toLowerCase().includes(w));
  });
}

export function KnowledgeSettings({ aiAnswers, onChanged }: {
  aiAnswers: number;               // AI answers of the active account that apply now
  onChanged: () => void;           // Smart rows may have moved: refresh the app
}) {
  const toast = useToast();
  const phone = useMediaQuery("(max-width: 639px)");
  const [data, setData] = useState<KnowledgeList | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("key");
  const [dir, setDir] = useState<1 | -1>(1);
  const [shown, setShown] = useState(PAGE);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ kind: "", note: "" });
  const [busy, setBusy] = useState(false);
  const upload = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.knowledge();
      setData(r);
      setError("");
      // selection follows the entries that still exist
      setSel((cur) => {
        const keys = new Set(r.entries.map((e) => e.key));
        const kept = [...cur].filter((k) => keys.has(k));
        return kept.length === cur.size ? cur : new Set(kept);
      });
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const entries = data?.entries ?? [];
  const list = useMemo(
    () => sortEntries(filterEntries(entries, query), sortBy, dir),
    [entries, query, sortBy, dir]);
  useEffect(() => { setShown(PAGE); }, [query, sortBy, dir]);
  const unused = entries.filter((e) => e.status === "unused");
  const kept = entries.filter((e) => e.src === "ai");
  const categories = data?.categories ?? [];

  /** Run a change, then reload and tell the app. */
  const act = async (task: () => Promise<void>) => {
    setBusy(true);
    try { await task(); }
    catch (e: any) { toast.show(String(e.message ?? e), { variant: "error" }); }
    finally { setBusy(false); await load(); onChanged(); }
  };
  const restore = (previous: Record<string, KnowledgeStored | null>) =>
    act(async () => {
      const back = Object.entries(previous).filter(([, v]) => v)
        .map(([key, v]) => ({ key, ...v! }));
      const gone = Object.entries(previous).filter(([, v]) => !v)
        .map(([key]) => key);
      await api.knowledgePut({ entries: back.length ? back : undefined,
        remove: gone.length ? gone : undefined });
      toast.show(t("know.undone"), { variant: "info" });
    });
  const remove = (keys: string[]) => act(async () => {
    const r = await api.knowledgePut({ remove: keys });
    setSel(new Set());
    toast.show(t("know.deleted", { n: keys.length }), { variant: "success",
      action: { label: t("Undo"), onClick: () => restore(r.previous) } });
  });
  const removeSelected = async () => {
    const keys = [...sel];
    if (!await confirmDialog({
      title: t("know.delete_title", { n: keys.length }),
      body: t("know.delete_body"), confirmLabel: t("know.delete_go",
        { n: keys.length }), tone: "danger" })) return;
    remove(keys);
  };
  const startEdit = (e: KnowledgeEntry) => {
    setEditing(e.key);
    setDraft({ kind: e.kind, note: e.note });
  };
  const saveEdit = (e: KnowledgeEntry) => act(async () => {
    // Choosing another kind is the user's own filing; editing only the note
    // keeps who filed it (a kept AI answer stays one).
    const changed = draft.kind !== e.kind;
    const r = await api.knowledgePut({ entries: [{ key: e.key,
      kind: draft.kind, note: draft.note,
      ...(changed ? {} : { src: e.src }) }] });
    setEditing(null);
    toast.show(t("know.saved"), { variant: "success",
      action: { label: t("Undo"), onClick: () => restore(r.previous) } });
  });
  const removeUnused = async () => {
    if (!await confirmDialog({
      title: t("know.unused_title", { n: unused.length }),
      body: t("know.unused_body"),
      confirmLabel: t("know.unused_go", { n: unused.length }),
      tone: "danger" })) return;
    act(async () => {
      const r = await api.knowledgeRemoveUnused();
      toast.show(t("know.unused_done", { n: r.removed }), { variant: "success" });
    });
  };
  const keepAll = async () => {
    if (!await confirmDialog({
      title: t("know.keep_title", { n: aiAnswers }),
      bullets: [t("know.keep_b_rules"), t("know.keep_b_clearer"),
        t("know.keep_b_only")],
      confirmLabel: t("know.keep_go", { n: aiAnswers }) })) return;
    act(async () => {
      const r = await api.knowledgeKeepAi();
      toast.show(r.kept ? t("know.kept", { n: r.kept }) : t("know.kept_none"),
        { variant: r.kept ? "success" : "info" });
    });
  };
  const forgetKept = async () => {
    if (!await confirmDialog({
      title: t("know.forget_title", { n: kept.length }),
      bullets: [t("know.forget_b_back"), t("know.forget_b_own")],
      confirmLabel: t("know.forget_go", { n: kept.length }),
      tone: "danger" })) return;
    act(async () => {
      const r = await api.knowledgeForgetAi();
      toast.show(t("know.forgot", { n: r.forgotten }), { variant: "success" });
    });
  };
  const download = () => {
    const section = { version: 1, entries: Object.fromEntries(
      entries.map((e) => [e.key, { kind: e.kind, src: e.src, ts: e.ts,
        note: e.note }])) };
    saveBlob("mailbroom-sender-knowledge.json",
      new Blob([JSON.stringify(section, null, 1)],
        { type: "application/json" }));
  };
  const onUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    let section: any;
    try {
      const body = JSON.parse(await file.text());
      section = body?.knowledge ?? body;      // this file, or a full backup
    } catch { section = null; }
    const n = section && typeof section.entries === "object" && section.entries
      ? Object.keys(section.entries).length : 0;
    if (!n) { toast.show(t("know.upload_bad"), { variant: "error" }); return; }
    if (!await confirmDialog({ title: t("know.upload_title"),
      bullets: [t("know.upload_b_n", { n }), t("know.upload_b_merge")],
      confirmLabel: t("know.upload_go") })) return;
    act(async () => {
      const r = await api.knowledgeImport(section);
      toast.show(t("know.uploaded", { n: r.knowledge }), { variant: "success" });
    });
  };

  const toggle = (k: string) => setSel((cur) => {
    const next = new Set(cur);
    next.has(k) ? next.delete(k) : next.add(k);
    return next;
  });
  const sortBy_ = (by: SortBy) => {
    if (by === sortBy) setDir(dir === 1 ? -1 : 1);
    else { setSortBy(by); setDir(1); }
  };
  const visible = list.slice(0, shown);
  const allShown = visible.length > 0 && visible.every((e) => sel.has(e.key));

  // ---- cells shared by the table and the cards ----------------------------
  const editor = (e: KnowledgeEntry) => (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={draft.kind} className="min-w-0 flex-1 sm:flex-none"
        aria-label={t("know.kind_label")}
        onChange={(ev) => setDraft({ ...draft, kind: ev.target.value })}>
        {FILE_KINDS.map((k) => (
          <option key={k} value={k}>{filedKindName(k)}</option>
        ))}
        {categories.map((c) => (
          <option key={c} value={`cat:${c}`}>{filedKindName(`cat:${c}`)}</option>
        ))}
        {![...FILE_KINDS as readonly string[], ...categories.map((c) => `cat:${c}`)]
          .includes(draft.kind) && (
          <option value={draft.kind}>{filedKindName(draft.kind)}</option>
        )}
      </Select>
      <Input className="min-w-0 flex-1" maxLength={NOTE_MAX}
        value={draft.note} aria-label={t("know.note_label")}
        placeholder={t("know.note_placeholder")}
        onChange={(ev) => setDraft({ ...draft, note: ev.target.value })} />
      <Button size="sm" disabled={busy} onClick={() => saveEdit(e)}>
        {t("Save")}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
        {t("Cancel")}
      </Button>
    </div>
  );
  const keyCell = (e: KnowledgeEntry) => (
    <span className="flex min-w-0 items-center gap-1.5">
      {isCompany(e)
        ? <Building2 size={14} aria-label={t("know.company")}
            className="shrink-0 text-muted" />
        : <User size={14} aria-hidden className="shrink-0 text-muted" />}
      <span className="truncate" title={nameOf(e)}>{nameOf(e)}</span>
    </span>
  );
  const srcTag = (e: KnowledgeEntry) => (
    <Tag tone={e.src === "user" ? "info" : "neutral"}>
      {e.src === "user" ? t("know.src_user") : t("know.src_ai")}
    </Tag>
  );
  const rowActions = (e: KnowledgeEntry) => (
    <span className="inline-flex items-center gap-1">
      <Button variant="quiet" size="icon" label={t("know.edit")}
        disabled={busy} onClick={() => startEdit(e)}><Pencil size={16} /></Button>
      <Button variant="quiet" size="icon" label={t("know.delete")}
        disabled={busy} onClick={() => remove([e.key])}>
        <Trash2 size={16} /></Button>
    </span>
  );
  const sortHead = (by: SortBy, label: string, right = false, width = "") => (
    <th scope="col" aria-sort={sortBy === by
      ? (dir === 1 ? "ascending" : "descending") : "none"}
    className={`px-2 py-2 type-meta font-normal text-muted ${width}
      ${right ? "text-right" : "text-left"}`}>
      <button type="button" className="inline-flex cursor-pointer items-center
        gap-1 hover:text-body" onClick={() => sortBy_(by)}>
        {label}
        {sortBy === by && (dir === 1 ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}
      </button>
    </th>
  );

  const unscanned = data?.unscanned.length ?? 0;
  const canRemoveUnused = !!data?.complete && unused.length > 0;

  return (
    <div className="space-y-3">
      <div>
        <SectionLabel>{t("know.table_title")}</SectionLabel>
        <p className="mt-1 type-meta text-muted">{t("know.table_help")}</p>
      </div>

      {!data && !error && <Loading />}
      {error && (
        <p role="alert" className="type-meta text-danger-fg">
          {t("know.load_error", { msg: error })}
        </p>
      )}

      {data && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="search" className="w-full min-w-0 sm:w-64"
              value={query} placeholder={t("know.search")}
              aria-label={t("know.search")}
              onChange={(ev) => setQuery(ev.target.value)} />
            {phone && (
              <Select value={sortBy} className="w-full min-w-0"
                aria-label={t("know.sort_label")}
                onChange={(ev) => { setSortBy(ev.target.value as SortBy); setDir(1); }}>
                <option value="key">{t("know.col_key")}</option>
                <option value="kind">{t("know.col_kind")}</option>
                <option value="src">{t("know.col_src")}</option>
                <option value="senders">{t("know.col_senders")}</option>
                <option value="status">{t("know.col_status")}</option>
                <option value="ts">{t("know.col_ts")}</option>
              </Select>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm"
              disabled={busy || !canRemoveUnused} onClick={removeUnused}>
              {t("know.unused_btn", { n: unused.length })}
            </Button>
            <Button variant="secondary" size="sm"
              disabled={busy || aiAnswers === 0} onClick={keepAll}>
              {t("know.keep_all")}
            </Button>
            <Button variant="secondary" size="sm"
              disabled={busy || kept.length === 0} onClick={forgetKept}>
              {t("know.forget_btn", { n: kept.length })}
            </Button>
            <span className="ml-auto flex items-center gap-2">
              <Button variant="secondary" size="sm" disabled={!entries.length}
                onClick={download}>{t("know.download")}</Button>
              <Button variant="secondary" size="sm" disabled={busy}
                onClick={() => upload.current?.click()}>
                {t("know.upload")}
              </Button>
              <input ref={upload} type="file" accept="application/json"
                className="hidden" aria-label={t("know.upload")}
                onChange={onUpload} />
            </span>
          </div>
          {!data.complete && (
            <p className="type-meta text-muted">
              {t("know.unused_blocked", { n: unscanned })}
            </p>
          )}

          {sel.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-card
              bg-panel2 px-3 py-2 type-meta">
              <span>{t("know.selected", { n: sel.size })}</span>
              <Button variant="danger" size="sm" disabled={busy}
                onClick={removeSelected}>
                {t("know.delete_sel", { n: sel.size })}
              </Button>
              <button type="button" className="cursor-pointer underline"
                onClick={() => setSel(new Set())}>{t("Clear selection")}</button>
            </div>
          )}

          {entries.length === 0 ? (
            <EmptyState title={t("know.empty_title")}
              hint={t("know.empty_hint")} />
          ) : list.length === 0 ? (
            <p className="p-2 type-body text-muted">{t("know.none")}</p>
          ) : phone ? (
            <div>
              {visible.map((e) => (
                <div key={e.key} className="flex items-stretch border-b
                  border-line">
                  <Checkbox checked={sel.has(e.key)}
                    className="w-11 shrink-0 self-stretch coarse:min-h-0"
                    aria-label={t("know.select", { name: nameOf(e) })}
                    onChange={() => toggle(e.key)} />
                  <div className="min-w-0 flex-1 space-y-1 py-2.5 pr-1">
                    <div className="flex items-center gap-2 type-body-mobile">
                      {keyCell(e)}
                      <span className="ml-auto shrink-0">{rowActions(e)}</span>
                    </div>
                    {editing === e.key ? editor(e) : (
                      <>
                        <div className="flex flex-wrap items-center gap-1">
                          <span>{filedKindName(e.kind)}</span>
                          {srcTag(e)}
                        </div>
                        <div className="type-meta text-muted">
                          {t("n.senders", { n: e.senders })} · {statusText(e)}
                        </div>
                        {e.note && (
                          <div className="type-meta text-muted">{e.note}</div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <table className="w-full table-fixed border-collapse type-body">
              <thead>
                <tr className="border-b border-line">
                  <th className="w-9 px-1 py-2">
                    <Checkbox checked={allShown}
                      aria-label={t("know.select_all")}
                      onChange={(ev) => setSel(new Set(ev.target.checked
                        ? [...sel, ...visible.map((e) => e.key)]
                        : [...sel].filter((k) => !visible.some((e) => e.key === k))))} />
                  </th>
                  {sortHead("key", t("know.col_key"), false, "w-4/12")}
                  {sortHead("kind", t("know.col_kind"), false, "w-3/12")}
                  {sortHead("senders", t("know.col_senders"), true, "w-20")}
                  {sortHead("status", t("know.col_status"), false, "w-28")}
                  <th scope="col" className="w-20 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <tr key={e.key} className="border-b border-line align-top">
                    <td className="px-1 py-2">
                      <Checkbox checked={sel.has(e.key)}
                        aria-label={t("know.select", { name: nameOf(e) })}
                        onChange={() => toggle(e.key)} />
                    </td>
                    <td className="min-w-0 overflow-hidden px-2 py-2.5">
                      {keyCell(e)}
                      {e.status !== "active" && (
                        <div className="mt-0.5 type-meta text-muted">
                          {statusText(e)}
                        </div>
                      )}
                    </td>
                    {editing === e.key ? (
                      <td colSpan={3} className="px-2 py-2">{editor(e)}</td>
                    ) : (
                      <>
                        <td className="px-2 py-2.5">
                          {filedKindName(e.kind)}
                          <div className="mt-0.5">{srcTag(e)}</div>
                          {e.note && (
                            <div className="mt-0.5 truncate type-meta text-muted"
                              title={e.note}>{e.note}</div>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-right tabular-nums">
                          {e.senders}
                        </td>
                        <td className="px-2 py-2.5">
                          <Tag tone={STATUS_TONE[e.status] ?? "neutral"}>
                            {t(`know.status_short.${e.status}`)}
                          </Tag>
                        </td>
                      </>
                    )}
                    <td className="px-1 py-1.5 text-right">{rowActions(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {list.length > visible.length && (
            <div className="text-center">
              <Button variant="secondary" size="sm"
                onClick={() => setShown(shown + PAGE)}>
                {t("know.more", { n: list.length - visible.length })}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
