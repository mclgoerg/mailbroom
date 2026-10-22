import { RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, fmtSize, mailKey } from "../api";
import { t } from "../i18n";
import type { AppState, FolderRole, Mail, SenderGroup, TrashResp }
  from "../types";
import { MessageView } from "./MailList";
import { Button, confirmDialog, EmptyState, Input, Loading, MailRow, Modal,
  PanelHeader, Segmented, Select, Spinner, Toolbar, useMediaQuery, useToast } from "./ui";

type Grouping = "sender" | "mails";

/** Folders panel: the special folders Mailbroom manages (Junk, Trash) in one
 *  place - live contents (also mail that arrived or was deleted elsewhere),
 *  search, a by-sender view, and per-folder actions: Junk "Not junk" (to the
 *  Inbox, undoable, then offers Protect) and "Move to Trash"; Trash
 *  "Restore to…" and the Empty Trash footer. */
export function FoldersPanel({ state, initialRole = "trash", onClose,
  onChanged, onEmptyTrash, onUndo, onProtect }: {
  state: AppState;
  initialRole?: FolderRole;
  onClose: () => void;
  onChanged: () => void;
  /** The shared "Empty Trash" flow (confirm + permanent delete), given the
   *  live total this panel just listed; resolves true once emptied. */
  onEmptyTrash: (listing: TrashResp) => Promise<boolean>;
  /** Undo the recorded move (the App's confirmed undo). */
  onUndo: (entry: { ts: number; label: string; count: number }) => void;
  /** Protect these senders (the App's one-tap protect). */
  onProtect: (addrs: string[]) => Promise<boolean>;
}) {
  const toast = useToast();
  const wide = useMediaQuery("(min-width: 640px)");   // phones: own full row
  const [role, setRole] = useState<FolderRole>(initialRole);
  const [list, setList] = useState<TrashResp | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  // Junk is reviewed by sender (rescue false alarms), Trash as a mail list
  const [grouping, setGrouping] = useState<Grouping>(
    initialRole === "junk" ? "sender" : "mails");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [view, setView] = useState<Mail | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Only the newest request may land (switching Junk | Trash quickly).
  const req = useRef(0);
  const load = (r: FolderRole = role) => {
    const mine = ++req.current;
    setList(null);
    setError("");
    setSel(new Set());
    api.foldersPanel(r)
      .then((l) => { if (mine === req.current) setList(l); })
      .catch((e) => {
        if (mine === req.current) setError(String(e.message ?? e));
      });
  };
  useEffect(() => load(role), [role]);

  const needle = q.trim().toLowerCase();
  const shownMails = useMemo(() => {
    if (!list) return null;
    if (!needle) return list.mails;
    return list.mails.filter((m) =>
      m.subject.toLowerCase().includes(needle) || m.addr.includes(needle));
  }, [list, needle]);
  const shownSenders = useMemo(() => {
    if (!list) return null;
    const all = list.senders ?? [];
    return needle ? all.filter((g) => g.addr.includes(needle)) : all;
  }, [list, needle]);
  const shown = grouping === "sender" ? shownSenders : shownMails;

  const toggle = (uids: number[]) => {
    const next = new Set(sel);
    const all = uids.every((u) => next.has(u));
    for (const u of uids) all ? next.delete(u) : next.add(u);
    setSel(next);
  };

  const dropped = (uids: Set<number>, n: number) => {
    setList((l) => l && {
      ...l, total: l.total - n,
      mails: l.mails.filter((m) => !uids.has(m.uid)),
      senders: (l.senders ?? []).map((g) => {
        const uidList = g.uids.filter((u) => !uids.has(u));
        const gone = g.uids.length - uidList.length;
        return gone ? { ...g, uids: uidList, count: g.count - gone } : g;
      }).filter((g) => g.count > 0),
    });
    setSel(new Set());
  };

  const restore = async (dest: string) => {
    if (!list || !dest || sel.size === 0) return;
    setBusy(true);
    setNote("");
    try {
      const uids = [...sel];
      const r = await api.trashRestore(uids, dest, list.uv);
      setNote(t(r.rescan ? "trash.restored_refreshing" : "trash.restored",
        { n: r.restored }));
      dropped(sel, r.restored);
      onChanged();
    } catch (e: any) {
      setNote(t("err.generic", { msg: e.message ?? e }));
    }
    setBusy(false);
  };

  // Junk -> Inbox ("Not junk", the primary action) or -> Trash. Both are
  // plain undoable moves; nothing is protected or blocked silently.
  const moveJunk = async (action: "not_junk" | "trash") => {
    if (!list || sel.size === 0) return;
    setBusy(true);
    setNote("");
    const uids = [...sel];
    try {
      let r;
      try {
        r = await api.folderMove("junk", action, uids, list.uv);
      } catch (e: any) {
        // protected senders / pinned mails need an explicit yes (same as
        // every other Trash move)
        if (action !== "trash" || !e.code) throw e;
        if (!await confirmDialog({
          title: t("fp.confirm_protected_title"),
          body: String(e.message), tone: "danger",
          confirmLabel: t("fp.confirm_protected_btn") })) {
          setBusy(false);
          return;
        }
        r = await api.folderMove("junk", action, uids, list.uv, true);
      }
      dropped(new Set(uids), r.moved);
      const undo = r.undo ? { label: t("Undo"),
        onClick: () => onUndo(r.undo!) } : undefined;
      if (action === "not_junk") {
        toast.show(t("fp.not_junk_done", { n: r.moved }), {
          variant: "success", action: undo, duration: 12000,
          action2: r.senders.length ? {
            label: t("fp.protect_sender", { n: r.senders.length }),
            onClick: () => { void onProtect(r.senders); },
          } : undefined,
        });
      } else {
        toast.show(t("toast.moved_trash", { n: r.moved }),
          { variant: "success", action: undo });
      }
      onChanged();
    } catch (e: any) {
      setNote(t("err.generic", { msg: e.message ?? e }));
    }
    setBusy(false);
  };

  const title = role === "junk" ? t("Junk") : t("Trash");
  const hasRows = !!list && (list.mails.length > 0 || !!note);
  return (
    <Modal onClose={onClose} size="lg"
      full={!!view || !shown || shown.length > 0 || !!q}>
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          {role === "junk" ? <ShieldAlert size={18} /> : <Trash2 size={18} />}
          {title}
        </span>}
        sub={list
          ? t("n.mails", { n: list.total })
            + (list.total > list.mails.length
               ? ` (${t("trash.newest_shown", { n: list.mails.length })})`
               : "")
          : t("loading…")}
        actions={<Button variant="secondary" size="icon" label={t("Refresh")}
          onClick={() => load()}><RefreshCw size={18} /></Button>}
        onClose={onClose}
      />

      {view ? (
        <MessageView mail={view} onBack={() => setView(null)} />
      ) : (
        <>
          {/* Own full-width row (phones) / left-aligned segments (desktop) */}
          <div className="border-b border-line px-4 py-2">
            <Segmented value={role} label={t("fp.which")} fill={!wide} tall={!wide}
              onChange={(r) => {
                setRole(r); setQ(""); setNote("");
                setGrouping(r === "junk" ? "sender" : "mails");
              }}
              options={[
                { value: "junk", label: t("Junk") },
                { value: "trash", label: t("Trash") },
              ]} />
          </div>
          {hasRows && (
            <Toolbar>
              <Input className="w-full sm:w-auto sm:min-w-32 sm:flex-1"
                placeholder={t("search.placeholder")}
                value={q} onChange={(e) => setQ(e.target.value)} />
              <Segmented value={grouping} label={t("fp.grouping")} tall={!wide}
                onChange={setGrouping}
                options={[
                  { value: "sender", label: t("fp.by_sender") },
                  { value: "mails", label: t("fp.mails") },
                ]} />
              {sel.size > 0 && role === "trash" && (
                <Select value="" disabled={busy}
                  className="max-sm:min-h-11 max-sm:coarse:min-h-11"
                  onChange={(e) => restore(e.target.value)}>
                  <option value="" disabled>
                    {t("trash.restore_to")} ({sel.size})
                  </option>
                  {(state.folders_raw ?? []).map((f, i) => (
                    <option key={f} value={f}>{state.folders[i] ?? f}</option>
                  ))}
                </Select>
              )}
              {sel.size > 0 && role === "junk" && (
                <>
                  <Button disabled={busy} className="max-sm:min-h-11 max-sm:coarse:min-h-11"
                    onClick={() => moveJunk("not_junk")}>
                    {t("fp.not_junk")} ({sel.size})
                  </Button>
                  <Select value="" disabled={busy} aria-label={t("fp.action")}
                    className="max-sm:min-h-11 max-sm:coarse:min-h-11"
                    onChange={(e) => e.target.value === "trash"
                      && moveJunk("trash")}>
                    <option value="" disabled>{t("fp.action")}</option>
                    <option value="trash">{t("fp.to_trash")}</option>
                  </Select>
                </>
              )}
              {busy && <Spinner />}
              {note && <span className="w-full type-meta text-muted">{note}</span>}
            </Toolbar>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto pb-4">
            {error && <div className="p-4 type-body text-danger-fg">{error}</div>}
            {!shown && !error && <Loading />}
            {shown && shown.length === 0 && (
              <EmptyState
                icon={role === "junk" ? <ShieldAlert size={18} />
                  : <Trash2 size={18} />}
                title={t(list?.mails.length ? "trash.no_match"
                  : role === "junk" ? "fp.junk_empty" : "trash.empty")}
                hint={list?.mails.length ? undefined
                  : t(role === "junk" ? "fp.junk_empty_hint"
                    : "trash.empty_hint")} />
            )}
            {grouping === "sender"
              ? shownSenders?.map((g: SenderGroup) => (
                <MailRow key={g.addr}
                  checked={g.uids.every((u) => sel.has(u))}
                  onToggle={() => toggle(g.uids)}
                  onOpen={() => { setQ(g.addr); setGrouping("mails"); }}
                  unread={g.unread > 0} subject={g.addr}
                  dateIso={g.date || ""}
                  selectLabel={t("select.named", { subject: g.addr })}
                  meta={[t("n.mails", { n: g.count }), fmtSize(g.size)]
                    .join(" · ")} />
              ))
              : shownMails?.map((m) => (
                <MailRow key={mailKey(m)} checked={sel.has(m.uid)}
                  onToggle={() => toggle([m.uid])} onOpen={() => setView(m)}
                  unread={!m.seen} subject={m.subject || t("(no subject)")}
                  dateIso={m.date || ""}
                  selectLabel={t("select.named",
                    { subject: m.subject || t("(no subject)") })}
                  meta={[m.addr, fmtSize(m.size)].join(" · ")} />
              ))}
          </div>
          {role === "trash" && list && list.total > 0 && (
            <div className="flex justify-end border-t border-line px-4 py-2
              max-sm:pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
              <Button variant="danger-quiet" disabled={busy}
                className="max-sm:min-h-11 max-sm:coarse:min-h-11"
                onClick={async () => {
                  if (await onEmptyTrash(list)) load();
                }}>
                {t("Empty Trash")} ({list.total})…
              </Button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
