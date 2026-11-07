import { ArrowUpDown, Ban, BellOff, Check, ChevronLeft, ExternalLink,
  FolderInput, MessagesSquare, MoreHorizontal, Pin, PinOff, Shield, Trash2,
  TriangleAlert, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { demoHint, useDemo } from "../demoMode";
import { t } from "../i18n";
import { actionVerb, planMailAction } from "../mailActions";
import { nowDate } from "../clock";
import { getLang } from "../i18n";
import { fmtDate, fmtSize, fmtUsd, mailKey, olderThan, shortcutTarget, sieveSnippet,
  type SieveAction } from "../lib";
import { isPooled, smartContent, smartWhy } from "../smart";
import type { AppState, Group, Grouping, GroupUnsub, Mail } from "../types";
import { RowAvatar, localizedSub } from "./GroupTable";
import { MailRows, MessageView } from "./MailList";
import { SenderList, type FileEntry, type SenderAction } from "./SenderList";
import { ThreadView } from "./ThreadView";
import { ACTION_BTN, ActionButton, ActionFace, AiTag, Button, Chip,
  confirmDialog, DemoHint, EngagementMeter, ensureAiAck, Input, LINK,
  LINK_ACCENT, Loading, Menu, MenuItem, Modal, Notice, PanelHeader, PinButton,
  ProtectButton, RatingChips, Segmented, Select, Spinner, StatTile,
  stillMailingText, Tag, tabPanelProps, TrackerBadge, useMediaQuery }
  from "./ui";

// Rating filter chips: same green/yellow/red/unrated buckets as the
// select they replace, now an exclusive pill row (like the overview's
// quick-select chips) instead of a dropdown.
// One cell of the action row: equal shares, five fit on a 390 px phone.
const CELL = "min-w-0 flex-1 basis-16";

const RATING_FILTERS: { key: string; label: string }[] = [
  { key: "delete_safe", label: "🟢 " + t("v.delete_safe") },
  { key: "review", label: "🟡 " + t("v.review") },
  { key: "keep", label: "🔴 " + t("v.keep") },
  { key: "unrated", label: t("v.unrated") },
];

export function DetailPanel({ grouping, group, aiEnabled, protectedNow,
  unsubscribedNow, onTrash, onMove, onProtect, onBlock, onUnblock, blocked, folders,
  sieve = true, smartMin = 10, onClose, onEmptied, onDeleted, variant = "modal", hideGroupActions = false,
  senders, onSenderAct, onSenderProtect, renderSender, onAckUnsub, backLabel,
  aiSort, onFile, categories, filingBox }: {
  grouping: Grouping;
  group: Group;
  aiEnabled: boolean;
  protectedNow: boolean;                 // live value; `group` is a snapshot
  unsubscribedNow: GroupUnsub | null;     // live value; `group` is a snapshot
  // One-tap whole-group trash (distinct from the mail-list "Trash selected"
  // below, which only acts on individually checked mails). Resolves false
  // if the user declined the confirmation, in which case the panel stays
  // open instead of closing on a no-op.
  onTrash: (g: Group) => Promise<boolean>;
  // Move the whole group to a folder: the same group path as the list's bulk
  // bar (protection, pinned mails, confirm wording, undo). Resolves false if
  // declined or nothing moved. Absent: no Move action.
  onMove?: (g: Group, dest: string) => Promise<boolean>;
  onProtect?: (g: Group) => void;        // rows with a sender/domain only
  onBlock?: (g: Group) => void;          // rows with a sender/domain only
  onUnblock?: (g: Group) => void;
  blocked?: boolean;
  folders: AppState["folders_raw"];
  sieve?: boolean;                       // Sieve export is Proton-only
  smartMin?: number;                     // Smart rows: the account's threshold
  onClose: () => void;
  // The group has been emptied by an action in here (Trash all, or every
  // mail trashed one by one). Defaults to closing; the split pane moves on
  // to the next group instead.
  onEmptied?: () => void;
  onDeleted: () => void;
  // "pane": the same content as a sticky column beside the list (>= 1280 px),
  // with no overlay, focus trap or modal-stack entry. "inline": just the
  // content, for a panel that opens inside another one (one sender inside a
  // pooled Smart row).
  variant?: "modal" | "pane" | "inline";
  // Pane only: the list has a selection, so the bulk bar owns the red button
  // and the group-scoped footer (Trash all, Block) is not shown.
  hideGroupActions?: boolean;
  // Pooled Smart rows: the senders inside the row (live sender records),
  // what can be done to ticked ones, and how one sender opens in place.
  senders?: Group[];
  onSenderAct?: (keys: string[], action: SenderAction, dest?: string) => Promise<boolean>;
  onSenderProtect?: (keys: string[]) => Promise<boolean>;
  renderSender?: (g: Group, back: () => void) => ReactNode;
  onAckUnsub?: (addr: string) => void;
  backLabel?: string;                    // set: the close button goes back
  // Pooled Smart rows: AI sorting of what the rules left in Other. `onSort`
  // only when an AI is configured; `total` = senders the AI sorted so far.
  aiSort?: { total: number; checked: number; busy: boolean;
    onSort?: () => void; onClear: () => void; onKeep?: () => void };
  // Pooled Smart rows: "File in Smart as..." for ticked senders, and the
  // user's own categories they can be filed into. One sender opened inside
  // a pool shows `filingBox` ("How Inboxrake files this sender") on top.
  onFile?: (entries: FileEntry[], senders: number) => Promise<boolean>;
  categories?: string[];
  filingBox?: ReactNode;
}) {
  const demo = useDemo();
  const hasSenders = !!senders && !!onSenderAct && !!onSenderProtect
    && !!renderSender && isPooled(group) && senders.length > 0;
  const [pick, setTab] = useState<"senders" | "mails">(
    hasSenders ? "senders" : "mails");
  // (a pool whose senders are all gone falls back to its mails view)
  const tab = hasSenders ? pick : "mails";
  const [inspect, setInspect] = useState<Group | null>(null);
  const [senderSel, setSenderSel] = useState(0);   // ticked in the sender list
  const [mails, setMails] = useState<Mail[] | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<Mail | null>(null);
  const [reading, setReading] = useState<Mail | null>(null);
  const [sortBy, setSortBy] = useState<"date" | "size">("date");
  const [moveDest, setMoveDest] = useState("");
  const [moveOpen, setMoveOpen] = useState(false);   // whole-group Move picker
  const [vFilter, setVFilter] = useState("all");
  const [sieveOpen, setSieveOpen] = useState(false);
  const [sieveAction, setSieveAction] = useState<SieveAction>("fileinto");
  const [sieveFolder, setSieveFolder] = useState("Archive");
  const cancelAi = useRef(false);
  // Phone: Sort becomes an icon menu (Unsubscribe stays a visible button).
  const phone = useMediaQuery("(width < 40rem)");

  // The sender list of a pooled row needs no mails: load them only when the
  // Mails view is open (a pool can hold thousands).
  useEffect(() => {
    if (tab !== "mails") return;
    let alive = true;   // guard against a slow response for a previous group
    api.group(grouping, group.key)
      .then((m) => alive && setMails(m))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, [grouping, group.key, tab, group.count]);   // (a pooled row's count follows the live row)

  // The folder picker must never be a dead end (same lesson as the
  // overview's bulk-action bar): clearing the selection also resets it.
  useEffect(() => {
    if (!sel.size) setMoveDest("");
  }, [sel.size]);

  const shown = useMemo(() => {
    if (!mails) return null;
    const filtered = vFilter === "all" ? mails
      : vFilter === "unrated" ? mails.filter((m) => !m.ai)
      : mails.filter((m) => m.ai === vFilter);
    return sortBy === "size"
      ? [...filtered].sort((a, b) => b.size - a.size)
      : filtered;
  }, [mails, sortBy, vFilter]);

  // Pinned mails are never part of a bulk selection (select-all, "older
  // than", AI picks) - they can only be ticked by hand, and acting on them
  // then needs its own confirmation (see act()).
  const selectable = useMemo(
    () => (shown ?? []).filter((m) => !m.pinned), [shown]);
  const pinnedCount = useMemo(
    () => (mails ?? []).filter((m) => m.pinned).length, [mails]);

  const vCounts = useMemo(() => {
    const c = { delete_safe: 0, review: 0, keep: 0, unrated: 0 };
    (mails ?? []).forEach((m) =>
      c[(m.ai ?? "unrated") as keyof typeof c]++);
    return c;
  }, [mails]);
  // The rating filter only means something once the AI rated a mail.
  const anyRated = vCounts.delete_safe + vCounts.review + vCounts.keep > 0;

  const toggle = (k: string) => {
    const next = new Set(sel);
    next.has(k) ? next.delete(k) : next.add(k);
    setSel(next);
  };

  // Selection presets operate on the VISIBLE (filtered) mails only.
  const selectPreset = (preset: string) => {
    if (!shown) return;
    if (preset === "all") {
      const allSel = selectable.length > 0
        && selectable.every((m) => sel.has(mailKey(m)));
      setSel(allSel ? new Set() : new Set(selectable.map(mailKey)));
    } else if (preset === "none") {
      setSel(new Set());
    } else if (preset.startsWith("older")) {
      const months = Number(preset.slice(5));
      setSel(new Set(selectable.filter((m) => olderThan(m, months))
        .map(mailKey)));
    }
  };

  const aiSelect = async () => {
    if (!mails || !await ensureAiAck()) return;
    setBusy(true);
    cancelAi.current = false;
    // With an active selection, rate ONLY those mails (and afterward narrow
    // the selection down to the safe ones within it) rather than the whole
    // group - picking "AI rate mails" shouldn't silently replace a
    // selection the user already built by hand.
    const scope = sel.size > 0 ? new Set(sel) : null;
    const pool = (ms: Mail[]) =>
      scope ? ms.filter((m) => scope.has(mailKey(m))) : ms;
    // Rate unrated mails in batches: verdicts land on the rows as they
    // arrive (and are cached server-side by Message-ID), progress is live,
    // and the run can be cancelled between batches.
    let current = mails;
    let done = pool(current).filter((m) => m.ai).length;
    const total = pool(current).length;
    let cost = 0;
    let lastNote = "";
    setNote(t("note.ai_progress", { done, total }));
    try {
      // Small batches: one request must finish well within browser/proxy
      // timeouts (Safari kills fetches around 60s). Rated batches are
      // cached server-side, so a failed run resumes where it stopped.
      for (;;) {
        if (cancelAi.current) break;
        const uids = scope
          ? pool(current).filter((m) => !m.ai)
              .map((m) => [m.folder, m.uid] as [string, number])
          : undefined;
        if (scope && uids!.length === 0) break;
        let r;
        try {
          r = await api.aiGroup(grouping, group.key, 0, 50, uids);
        } catch {
          // retry smaller
          r = await api.aiGroup(grouping, group.key, 0, 25, uids);
        }
        if (r.reviewed === 0) break;
        const map = new Map<string, Mail["ai"]>(r.verdicts.map(
          ([f, u, v]) => [`${f} ${u}`, v]));
        current = current.map((m) =>
          map.has(mailKey(m)) ? { ...m, ai: map.get(mailKey(m))! } : m);
        setMails(current);
        done += r.reviewed;
        cost += r.usage.cost ?? 0;
        lastNote = r.note;
        setNote(t("note.ai_progress", { done, total }));
        if (r.remaining === 0) break;
      }
      const safe = pool(current)
        .filter((m) => m.ai === "delete_safe" && !m.pinned);
      setSel(new Set(safe.map(mailKey)));
      setNote(t("note.ai_selected",
          { note: lastNote, n: safe.length, of: done })
        + (cost ? ` · ${fmtUsd(cost)}` : ""));
    } catch (e: any) {
      setNote(`AI error: ${e.message ?? e} - ${t("note.ai_resume")}`);
    }
    setBusy(false);
  };

  // The demo's links point at a made-up host: explain instead of opening it.
  const openUnsubPage = (link: string): string => {
    if (demo) return t("unsub.demo_hint");
    window.open(link, "_blank", "noopener");
    return t("Opened the sender's unsubscribe page - confirm it there.");
  };

  const unsubscribe = async () => {
    setBusy(true);
    setNote(t("Unsubscribing…"));
    try {
      const r = await api.unsubscribe(grouping, group.key);
      if (r.action === "link") {
        setNote(openUnsubPage(r.detail));
      } else {
        setNote(`${t("Unsubscribed")} (${r.method}).`);
      }
      onDeleted();   // refresh App's state so the persisted status shows up
    } catch (e: any) {
      setNote(t("err.unsub", { msg: e.message ?? String(e) }));
    }
    setBusy(false);
  };

  const ackUnsubscribe = async () => {
    const addr = unsubscribedNow?.addr || group.key;
    setBusy(true);
    try {
      await api.unsubscribeAck(addr);
      setNote(t("Marked as unsubscribed."));
      onDeleted();
    } catch (e: any) {
      setNote(t("err.generic", { msg: e.message ?? e }));
    }
    setBusy(false);
  };

  const togglePin = async (m: Mail) => {
    try {
      await api.pin(m.folder, m.uid, !m.pinned);
      setMails((cur) => cur && cur.map((x) =>
        mailKey(x) === mailKey(m) ? { ...x, pinned: !m.pinned } : x));
      // A freshly pinned mail drops out of the selection: it must not stay
      // ticked unnoticed.
      if (!m.pinned && sel.has(mailKey(m))) {
        const next = new Set(sel);
        next.delete(mailKey(m));
        setSel(next);
      }
      onDeleted();   // refresh App's state so the group row's pin count moves
    } catch (e: any) {
      setNote(`${t("pin.error")}: ${e.message ?? e}`);
    }
  };

  // Pin/unpin every mail currently in the group (the group's own shield
  // covers future mail; this covers what is in it now).
  const pinAll = async (pinned: boolean) => {
    if (!pinned && !await confirmDialog({
      title: t("confirm.unpin_group", { n: pinnedCount }),
      confirmLabel: t("confirm.unpin_btn") })) return;
    try {
      const r = await api.pinGroup(grouping, group.key, pinned);
      setMails(await api.group(grouping, group.key));
      setSel(new Set());
      setNote(r.skipped > 0
        ? t("pin.group_skipped", { n: r.skipped }) : "");
      onDeleted();
    } catch (e: any) {
      setNote(`${t("pin.error")}: ${e.message ?? e}`);
    }
  };

  const act = (action: string, dest = "") => {
    if (!mails || sel.size === 0) return Promise.resolve();
    return actOn(mails.filter((m) => sel.has(mailKey(m))), action, dest);
  };

  // `chosen` is the checked mails, or the single mail open in the reader
  // ("Trash this mail") - both go through the same confirm/pinned flow.
  const actOn = async (chosen: Mail[], action: string, dest = "",
      single = false) => {
    if (!mails) return;
    const verb = actionVerb(action, dest);
    const plan = await planMailAction(chosen, action, verb);
    if (plan.kind === "cancelled") return;
    if (plan.kind === "all_pinned") {
      setNote(t("toast.all_pinned"));
      return;
    }
    const { acting, force } = plan;
    const actingKeys = new Set(acting.map(mailKey));
    const wholeGroup = acting.length === mails.length
      && action !== "mark_read";
    try {
      const items = acting.map((m) => [m.folder, m.uid] as [string, number]);
      await api.deleteMessages(items, action, dest, force);  // background job
      if (wholeGroup) {
        // The group will be empty - go straight back to the overview.
        onDeleted();
        (onEmptied ?? onClose)();
        return;
      }
      if (action !== "mark_read") {
        setMails(mails.filter((m) => !actingKeys.has(mailKey(m))));
        // The mail open in the reader is gone: back to the list.
        setView(null);
        setReading(null);
      } else {
        setMails(mails.map((m) =>
          actingKeys.has(mailKey(m)) ? { ...m, seen: true } : m));
      }
      // A single-mail action (reader) only drops that mail from the
      // selection; the checked-mails flow clears it as before.
      if (single) {
        setSel((cur) => {
          const next = new Set(cur);
          actingKeys.forEach((k) => next.delete(k));
          return next;
        });
      } else setSel(new Set());
      setNote(t("note.background", { verb }));
      onDeleted();
    } catch (e: any) {
      setNote(t("err.generic", { msg: e.message ?? e }));
    }
  };

  const onAction = (v: string) => {
    if (v === "move") setMoveDest("?");   // reveal the folder picker
    else if (v === "ai_review") aiSelect();
    else if (v) act(v);
  };

  // Message-scoped footer actions (reader / thread view): the pin state is
  // read live from `mails`, since `view` / `reading` are snapshots.
  const mailActions = (m: Mail) => {
    const live = mails?.find((x) => mailKey(x) === mailKey(m)) ?? m;
    return <>
      <PinButton showLabel on={!!live.pinned} onClick={() => togglePin(live)} />
      <Button variant="danger-quiet" onClick={() => actOn([live], "trash", "", true)}>
        {t("trash_this.btn")}
      </Button>
    </>;
  };
  // Only mails "Trash all" will really move: protected ones stay untouched.
  const groupCount = mails
    ? mails.filter((m) => !m.pinned).length
    : group.count - (group.pinned ?? 0);

  // The address / domain the Sieve snippet is about (Smart bucket rows,
  // subject and thread rows have none).
  const sieveTarget = shortcutTarget(grouping, group);
  const why = smartWhy(group, smartMin);
  const purposes = smartContent(group);
  const canAiSort = !!aiSort?.onSort && group.kind === "other";
  const canAiClear = !!aiSort && aiSort.total + aiSort.checked > 0
    && (group.kind === "other"
    || (senders ?? []).some((g) => g.smart_why?.r === "ai"));
  // Keeping an answer needs one that applies: the AI PLACED something.
  const canKeep = canAiClear && !!aiSort?.onKeep && aiSort.total > 0;
  // A pooled Smart row has no one sender to unsubscribe from: the endpoint
  // would act on its newest sender only. No button there (DECISIONS
  // 2026-10-12); own rows behave like Sender-tab rows.
  const canUnsub = group.unsub && !isPooled(group);

  // Rating chips + the per-mail controls (sort, Select...) belong to the Mails
  // section; the group-level actions live in the action row.
  const pinnedN = mails ? pinnedCount : (group.pinned ?? 0);
  const opened = group.count
    ? Math.round(100 * (1 - group.unread / group.count)) : 0;
  const sub = group.sub ? localizedSub(group.sub) : "";
  const since = group.first
    ? fmtDate(group.first, nowDate(), { lang: getLang() }) : "";
  const canBlock = !!onBlock && !blocked;
  // One scope at a time: group Move steps aside like the footer button does.
  const canMove = !!onMove && tab === "mails" && group.count > 0
    && sel.size === 0 && !hideGroupActions;
  const aiRate = (aiEnabled || demo) && !busy && sel.size === 0
    && tab === "mails";
  const canRead = grouping === "thread" && !!mails && mails.length > 0;
  const canPinAll = !!mails && mails.length > 0 && pinnedCount < mails.length;
  const canSieve = sieve && !!sieveTarget;
  // Only what works in the current view (a pooled row's Senders view loads no
  // mails); no items, no button.
  const hasMore = (aiEnabled && busy) || aiRate || canRead || canPinAll
    || pinnedCount > 0 || canSieve;

  // Header: who this is, then the quiet signals the rows no longer carry.
  const header = (
    <div className="px-4 pt-4">
      <div className="flex items-start gap-3">
        <RowAvatar g={group} grouping={grouping} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="break-words type-title2">{group.label}</h2>
          {sub && <div className="truncate type-body text-muted">{sub}</div>}
          {(group.tags.length > 0 || since) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1
              type-meta text-muted">
              {group.tags.map((tag) => (
                <Tag key={tag} tone="category">{tag}</Tag>
              ))}
              {since && <span>{t("detail.since", { date: since })}</span>}
            </div>
          )}
        </div>
        <Button variant="secondary" size="icon" label={backLabel ?? t("Close")}
          className="shrink-0" onClick={onClose}>
          {backLabel ? <ChevronLeft size={18} /> : <X size={18} />}
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        {group.ai && <AiTag ai={group.ai} />}
        {group.ratings && <RatingChips ratings={group.ratings} />}
        <EngagementMeter g={group} />
        <TrackerBadge g={group} />
        {group.new && (
          <Tag tone="new">
            <span title={t("new_sender.tip")}>🆕 {t("New")}</span>
          </Tag>
        )}
        {group.replied && (
          <Tag tone="info">
            <span title={t("replied.tip")}>↩ {t("replied")}</span>
          </Tag>
        )}
        {group.att_size > 0 && (
          <Tag tone="attach">📎 {fmtSize(group.att_size)}</Tag>
        )}
        {pinnedN > 0 && (
          <span className="inline-flex items-center gap-1 type-meta text-muted"
            title={t("pin.badge_tip", { n: pinnedN })}>
            <Pin size={14} /> {t("pin.n_protected", { n: pinnedN })}
          </span>
        )}
        {protectedNow && (
          <Tag tone="neutral" className="inline-flex items-center gap-1">
            <Shield size={14} aria-hidden /> {t("protected")}
          </Tag>
        )}
        {blocked && (
          <Tag tone="keep" className="inline-flex items-center gap-1">
            <Ban size={14} aria-hidden /> {t("Blocked")}
          </Tag>
        )}
      </div>
    </div>
  );

  const unsubButtons = !canUnsub ? null
    : unsubscribedNow?.status === "done" ? (
      // (still mailing: the callout says so; no action slot)
      group.still_mailing ? null : (
        <ActionButton disabled icon={<Check size={18} />}
          label={t("Unsubscribed")} className={CELL} />
      )
    ) : unsubscribedNow?.status === "link" ? (
      <>
        <ActionButton className={CELL} disabled={busy} icon={<ExternalLink size={18} />}
          label={t("unsub.open_link")}
          onClick={() => setNote(openUnsubPage(unsubscribedNow.link))} />
        <ActionButton className={CELL} disabled={busy} icon={<Check size={18} />}
          label={t("unsub.mark_done")} onClick={ackUnsubscribe} />
      </>
    ) : (
      <ActionButton className={CELL} disabled={busy} icon={<BellOff size={18} />}
        label={unsubscribedNow?.status === "failed"
          ? t("unsub.retry") : t("Unsubscribe")}
        onClick={unsubscribe} />
    );

  const actionRow = (
    <div className="flex flex-wrap items-start gap-y-2 px-4 pt-4">
      {unsubButtons}
      {canBlock && (
        <ActionButton className={CELL} icon={<Ban size={18} />}
          label={t("detail.block")}
          ariaLabel={t("block.btn")} title={t("block.tip")}
          onClick={() => onBlock!(group)} />
      )}
      {onUnblock && blocked && (
        <ActionButton className={CELL} icon={<Ban size={18} />}
          label={t("Unblock")}
          title={t("unblock.tip")} onClick={() => onUnblock(group)} />
      )}
      {onProtect && (
        <ActionButton className={CELL} on={protectedNow} icon={<Shield size={18} />}
          label={t(protectedNow ? "btn.protected" : "btn.protect")}
          ariaLabel={t(protectedNow ? "unprotect.tip" : "protect.tip")}
          onClick={() => onProtect({ ...group, protected: protectedNow })} />
      )}
      {canMove && (
        <ActionButton className={CELL} icon={<FolderInput size={18} />}
          label={t("detail.move")} on={moveOpen}
          onClick={() => setMoveOpen(!moveOpen)} />
      )}
      {hasMore && (
      <div className={`${CELL} flex justify-center`}>
      <Menu label={t("menu.more")} triggerClass={ACTION_BTN}
        trigger={<ActionFace icon={<MoreHorizontal size={18} />}
          label={t("menu.more")} />}>
        {/* AI rate mails only lives here while nothing is selected
            (rate the whole group - secondary/occasional, like the
            overview's own overflow entry). Once something IS
            selected it promotes to the Action… select instead
            of staying in two places at once - Cancel stays
            reachable here regardless, since a scoped run can still
            be mid-flight while selected. */}
        {aiEnabled && busy && (
          <MenuItem onClick={() => { cancelAi.current = true; }}>
            <Spinner className="mr-1 inline align-text-bottom" />{" "}
            {t("cancel")}
          </MenuItem>
        )}
        {aiRate && (
          <MenuItem onClick={aiSelect} disabled={demo}
            sub={demo ? demoHint() : undefined}>
            <Wand2 size={16} className="mr-1 inline align-text-bottom" />
            {t("ai.rate")}
          </MenuItem>
        )}
        {canRead && (
          <MenuItem onClick={() => setReading(mails![0])}>
            <MessagesSquare size={16}
              className="mr-1 inline align-text-bottom" />
            {t("thread.read")}
          </MenuItem>
        )}
        {canPinAll && (
          <MenuItem onClick={() => pinAll(true)}>
            <Pin size={16} className="mr-1 inline align-text-bottom" />
            {t("pin.group_on")}
          </MenuItem>
        )}
        {pinnedCount > 0 && (
          <MenuItem onClick={() => pinAll(false)}>
            <PinOff size={16}
              className="mr-1 inline align-text-bottom" />
            {t("pin.group_off")}
          </MenuItem>
        )}
        {canSieve && (
          <MenuItem onClick={() => setSieveOpen(!sieveOpen)}>
            {t("sieve.button")}
          </MenuItem>
        )}
      </Menu>
      </div>
      )}
    </div>
  );

  // Move: the whole group to one folder (the selection bar below keeps its
  // own picker for ticked mails). Always with a way back.
  const movePicker = moveOpen && canMove && (
    <div className="flex items-center gap-2 px-4 pt-3">
      <Select value="" className="min-w-0 flex-1"
        onChange={(e) => {
          const dest = e.target.value;
          setMoveOpen(false);
          if (dest) onMove!(group, dest).then((ok) => {
            if (ok) (onEmptied ?? onClose)();
          });
        }}>
        <option value="" disabled>{t("Move to folder…")}</option>
        {folders.map((f) => <option key={f} value={f}>{f}</option>)}
      </Select>
      <Button variant="secondary" size="icon" label={t("Cancel")}
        className="shrink-0" onClick={() => setMoveOpen(false)}>
        <X size={18} />
      </Button>
    </div>
  );

  const stillCallout = group.still_mailing && (
    <div className="px-4 pt-3">
      <Notice tone="warn" icon={<TriangleAlert size={16} />}>
        <div className="font-semibold">{t("still.title")}</div>
        <div>{stillMailingText(group.still_mailing)}</div>
        {group.still_mailing.senders > 1 && (
          <div className="mt-1 break-words">
            {group.still_mailing.addrs.join(", ")}
            {group.still_mailing.senders
              > group.still_mailing.addrs.length && " …"}
          </div>
        )}
        {/* The unsubscribe did not hold: say how bad, offer the block (a
            sender row only - blocking a whole domain from a pooled row
            would be a different, bigger decision). */}
        {onBlock && !blocked && !protectedNow
          && shortcutTarget(grouping, group)?.kind === "sender" && (
          <Button variant="secondary" size="sm" className="mt-2"
            title={t("block.tip")} onClick={() => onBlock(group)}>
            <Ban size={14} className="mr-1 inline align-text-bottom" />
            {t("block.btn")}
          </Button>
        )}
      </Notice>
    </div>
  );

  const sievePanel = sieve && sieveOpen && sieveTarget && (
    <div className="mx-4 mt-3 rounded-card border border-line bg-panel2 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="type-meta text-muted">{t("sieve.intro")}</span>
        <Select value={sieveAction}
          onChange={(e) =>
            setSieveAction(e.target.value as SieveAction)}>
          <option value="fileinto">{t("sieve.fileinto")}</option>
          <option value="discard">{t("sieve.discard")}</option>
          <option value="markread">{t("sieve.markread")}</option>
        </Select>
        {sieveAction === "fileinto" && (
          <Input className="w-40" value={sieveFolder}
            placeholder="Archive"
            onChange={(e) => setSieveFolder(e.target.value)} />
        )}
        <Button variant="secondary" onClick={() => {
          navigator.clipboard?.writeText(sieveSnippet(
            sieveTarget.kind, sieveTarget.value, sieveAction,
            sieveFolder));
          setNote(t("sieve.copied"));
        }}>{t("Copy")}</Button>
        <a className={`type-meta ${LINK_ACCENT}`}
          href="https://account.proton.me/mail/filters"
          target="_blank" rel="noopener">
          {t("sieve.open_proton")}
        </a>
      </div>
      <pre className="overflow-x-auto rounded-control bg-surface p-2
        type-meta leading-relaxed">
        {sieveSnippet(sieveTarget.kind, sieveTarget.value,
          sieveAction, sieveFolder)}
      </pre>
    </div>
  );

  // Smart pools: one plain line on why these senders are together, what a
  // company's mails are about, and the Senders | Mails switch (the senders
  // are the point; the mails stay one tap away).
  const poolBox = (why || purposes || hasSenders || canAiSort || canAiClear) && (
    <div className="flex flex-col gap-2 px-4 pt-3">
      {why && <p className="type-meta text-muted">{why}</p>}
      {purposes && <p className="type-meta text-muted">{purposes}</p>}
      {(canAiSort || canAiClear) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {canAiSort && (<>
            <Button variant="secondary" size="sm"
              disabled={demo || aiSort!.busy} onClick={aiSort!.onSort}
              title={demo ? demoHint() : undefined}>
              <Wand2 size={14} className="mr-1 inline align-text-bottom" />
              {t("aisort.btn")}
            </Button>
            <DemoHint />
          </>)}
          {canAiClear && (
            <span className="type-meta text-muted">
              {aiSort!.total
                ? t("aisort.sorted_n", { n: aiSort!.total })
                : t("aisort.checked_n", { n: aiSort!.checked })}{" "}
              {canKeep && (
                <>
                  <button className={LINK} onClick={aiSort!.onKeep}>
                    {t("know.keep_btn", { n: aiSort!.total })}
                  </button>{" "}
                </>
              )}
              <button className={LINK} onClick={aiSort!.onClear}>
                {t("aisort.clear")}
              </button>
            </span>
          )}
        </div>
      )}
      {hasSenders && (
        <Segmented idPrefix="pool" value={tab} onChange={setTab}
          label={t("senders.view")} fill
          options={[
            { value: "senders",
              label: t("senders.tab", { n: senders!.length }) },
            { value: "mails",
              label: t("senders.mails_tab", { n: group.count }) }]} />
      )}
    </div>
  );

  const head = (
    <>
      {header}
      {actionRow}
      {movePicker}
      {note && <div className="px-4 pt-2 type-meta text-muted">{note}</div>}
      <div className="grid grid-cols-3 gap-2 px-4 pt-4">
        <StatTile label={t("detail.mails")} value={group.count} />
        <StatTile label={t("detail.size")} value={fmtSize(group.size)} />
        <StatTile label={t("detail.opened")} value={`${opened}%`} />
      </div>
      {stillCallout}
      {sievePanel}
      {poolBox}
    </>
  );

  // The mails of this group: heading row with the compact list controls
  // (sort, build-a-selection), rating filter, then the rows.
  const mailsSection = (
    <>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-4">
        <h3 className="type-heading">{t("detail.mails")}</h3>
        {shown && mails && shown.length !== mails.length && (
          <span className="type-meta text-muted">
            {shown.length} / {t("n.mails", { n: mails.length })}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {phone ? (
            <Menu variant="secondary" icon label={t(
              sortBy === "date" ? "Sort: date" : "Sort: size")}
              trigger={<ArrowUpDown size={18} />}>
              <MenuItem active={sortBy === "date"}
                onClick={() => setSortBy("date")}>
                {t("Sort: date")}
              </MenuItem>
              <MenuItem active={sortBy === "size"}
                onClick={() => setSortBy("size")}>
                {t("Sort: size")}
              </MenuItem>
            </Menu>
          ) : (
            <Select value={sortBy} className="w-auto shrink-0"
              onChange={(e) =>
                setSortBy(e.target.value as "date" | "size")}>
              <option value="date">{t("Sort: date")}</option>
              <option value="size">{t("Sort: size")}</option>
            </Select>
          )}
          <Select value="" className="w-auto min-w-0 shrink"
            onChange={(e) => selectPreset(e.target.value)}>
            <option value="" disabled>{t("Select…")}</option>
            <option value="all">{t("All / none")}</option>
            <option value="older6">{t("Older than 6 months")}</option>
            <option value="older12">{t("Older than 1 year")}</option>
            <option value="older24">{t("Older than 2 years")}</option>
            <option value="none">{t("Clear selection")}</option>
          </Select>
        </div>
      </div>
      {(anyRated || vFilter !== "all") && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
          <Chip className="shrink-0" on={vFilter === "all"}
            onClick={() => { setVFilter("all"); setSel(new Set()); }}>
            {t("filter.all")} ({mails ? mails.length : group.count})
          </Chip>
          {RATING_FILTERS.filter((f) =>
            vCounts[f.key as keyof typeof vCounts] > 0).map((f) => (
            <Chip key={f.key} className="shrink-0" on={vFilter === f.key}
              onClick={() => { setVFilter(f.key); setSel(new Set()); }}>
              {f.label} ({vCounts[f.key as keyof typeof vCounts]})
            </Chip>
          ))}
        </div>
      )}
      {/* `relative`: MailRow's absolutely positioned sr-only spans would
          otherwise anchor to the page and stretch it past the pane. */}
      <div className="relative pb-2">
        {error && <div className="p-4 type-body text-danger-fg">{error}</div>}
        {!shown && !error && <Loading />}
        {shown && (
          <MailRows mails={shown} sel={sel} onToggle={toggle}
            onOpen={setView} onPin={togglePin} />
        )}
      </div>
    </>
  );

  const readerHeader = (
    <PanelHeader
      title={group.label}
      sub={<>
        {t("n.mails", { n: mails ? mails.length : group.count })} ·{" "}
        {fmtSize(group.size)}
        {protectedNow && (
          <span className="inline-flex items-center gap-1">
            {" "}· <Shield size={14} /> {t("protected")}
          </span>
        )}
        {blocked && (
          <span className="inline-flex items-center gap-1">
            {" "}· <Ban size={14} /> {t("Blocked")}
          </span>
        )}
      </>}
      actions={onProtect && (
        <ProtectButton showLabel on={protectedNow}
          onClick={() => onProtect({ ...group, protected: protectedNow })} />
      )}
      onClose={onClose}
      closeLabel={backLabel}
      closeIcon={backLabel ? <ChevronLeft size={18} /> : undefined}
    />
  );

  const list = (
    <>
      {reading ? (
        <>
          {readerHeader}
          <ThreadView mail={reading} onBack={() => setReading(null)}
            actions={mailActions(reading)} />
        </>
      ) : view ? (
        <>
          {readerHeader}
          <MessageView mail={view} onBack={() => setView(null)}
            actions={mailActions(view)} />
        </>
      ) : (
        <>
          {tab === "senders" && hasSenders ? (
            <>
              {/* (55%: the header may take at most that much of the pane, the
                  sender list below keeps the rest) */}
              <div className="max-h-[55%] shrink-0 overflow-y-auto pb-3">
                {filingBox}
                {head}
              </div>
              <div {...tabPanelProps("pool", "senders")}
                className="flex min-h-0 flex-1 flex-col">
                <SenderList senders={senders!} folders={folders}
                  rowKind={group.kind} categories={categories} onFile={onFile}
                  onAct={onSenderAct!} onProtect={onSenderProtect!}
                  onInspect={setInspect} onSelectedChange={setSenderSel}
                  onAckUnsub={onAckUnsub ?? (() => {})} />
              </div>
            </>
          ) : (
            <>
              {/* One scroll for header, actions and mails: the tall header
                  must never squeeze the list into a few lines. */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {filingBox}
                {head}
                {mailsSection}
              </div>

              {/* Contextual bulk-action bar: the ONLY bulk-action chrome for
                  the mail list, matching the overview's convention - it does
                  not exist at all until something is selected. The panel is
                  already a bounded flex column (Modal), so this sits as a
                  normal flex child at the bottom rather than needing
                  `fixed`. */}
              {sel.size > 0 && (
                <div className="border-t border-line bg-panel2 px-4 py-2"
                  style={{ paddingBottom:
                    "calc(env(safe-area-inset-bottom) + 0.5rem)" }}>
                  <div className="mb-2 flex items-center gap-2 type-meta text-muted">
                    <span>{t("detail.n_selected", { n: sel.size })}</span>
                    <button className={LINK}
                      onClick={() => setSel(new Set())}>
                      {t("Clear selection")}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* The Action… select stays mounted even once "Move to
                        folder…" is picked (matching the overview's bulk bar) -
                        swapping it out for the folder-picker in place made the
                        native iOS option list occasionally show the wrong
                        (stale) options, since both selects shared one DOM
                        node. The folder picker is a separate, additional
                        control instead. */}
                    <Select value="" className="min-w-0 flex-1" disabled={busy}
                      onChange={(e) => onAction(e.target.value)}>
                      <option value="" disabled>{t("Action…")}</option>
                      <option value="archive">{t("Archive")}</option>
                      <option value="move">{t("Move to folder…")}</option>
                      <option value="mark_read">{t("Mark read")}</option>
                      {(aiEnabled || demo) && (
                        <option value="ai_review" disabled={demo}>
                          {t("ai.rate")}{demo ? ` - ${demoHint()}` : ""}
                        </option>
                      )}
                    </Select>
                    {moveDest === "?" && (
                      <>
                        <Select value="" className="min-w-0 flex-1"
                          onChange={(e) => {
                            if (e.target.value) act("move", e.target.value);
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
                    <Button variant="danger" disabled={busy}
                      className="ml-auto shrink-0"
                      onClick={() => act("trash")}>
                      {t("Trash selected")} ({sel.size})
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* The one group-scoped destructive action. It lives down here
              (not in the header) so "Move N mails to Trash" names its scope
              and sits away from Close. Hidden while a selection exists: the
              selection bar above is then the one place to act (no two red
              buttons stacked). */}
          {sel.size === 0 && !(tab === "senders" && senderSel > 0)
            && !hideGroupActions && groupCount > 0 && (
            <div className="border-t border-line px-4 py-3"
              style={{ paddingBottom:
                "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
              <Button variant="danger-tint"
                className="inline-flex w-full items-center justify-center gap-1.5"
                title={t("trash_all.tip", { n: groupCount })}
                onClick={async () => {
                  if (await onTrash(group)) (onEmptied ?? onClose)();
                }}>
                <Trash2 size={16} aria-hidden />
                {t("detail.trash_all", { n: groupCount })}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );

  // One sender of a pooled row opens in the same panel, with its own header
  // that goes back to the list (the selection here is kept meanwhile).
  // The list stays MOUNTED (hidden) meanwhile, so the ticks, search and sort
  // are still there when the user comes back.
  const inspecting = !!inspect && !!renderSender;
  const content = (
    <>
      {inspecting && renderSender!(inspect!, () => setInspect(null))}
      <div className={inspecting ? "hidden" : "contents"}>{list}</div>
    </>
  );

  // Pane: `h-full` fills the sticky wrapper App sizes to the viewport. It is
  // focusable (tabIndex -1) so a keyboard open can move focus into it.
  return variant === "inline" ? content : variant === "pane" ? (
    <section aria-label={t("detail.region", { label: group.label })}
      data-split-pane tabIndex={-1}
      className="flex h-full outline-none min-h-0 flex-col overflow-hidden border-l
        border-line bg-panel">
      {content}
    </section>
  ) : (
    <Modal onClose={onClose} full>{content}</Modal>
  );
}
