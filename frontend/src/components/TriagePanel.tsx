import { Check, Layers, ShieldCheck, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtSize } from "../api";
import { t } from "../i18n";
import {
  buildDeck, can, dragDecision, planOf, summarize, type Decision,
  type TriagePlan,
} from "../triage";
import type { Group, Grouping } from "../types";
import { localizedSub } from "./GroupTable";
import {
  AiTag, Avatar, Button, confirmDialog, EngagementMeter, Modal, PanelHeader,
  ProgressBar, SectionLabel, ShortDate, Tag, useMediaQuery,
} from "./ui";

const EXIT_MS = 180;
const REDUCED = "(prefers-reduced-motion: reduce)";

const unreadPct = (g: Group) =>
  g.count ? Math.round((100 * g.unread) / g.count) : 0;

/** What the stamp over a dragged card says. */
const STAMP: Record<Exclude<Decision, "protect">, string> = {
  trash: "text-danger-fg", keep: "text-safe-fg", unsub: "text-accent",
};

function Card({ g, grouping, reduced, onCommit }: {
  g: Group; grouping: Grouping; reduced: boolean;
  onCommit: (d: Decision) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [leaving, setLeaving] = useState<{ dx: number; dy: number } | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const allowed = (d: Decision) => can(d, g, grouping);

  const down = (e: React.PointerEvent) => {
    if (leaving || (e.button ?? 0) !== 0) return;
    if ((e.target as HTMLElement).closest("button, a")) return;
    start.current = { x: e.clientX, y: e.clientY, at: Date.now() };
    el.current?.setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!start.current) return;
    setDrag({ dx: e.clientX - start.current.x, dy: e.clientY - start.current.y });
  };
  const up = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    const width = el.current?.offsetWidth || 300;
    const d = dragDecision(dx, dy, width, Date.now() - s.at, allowed);
    setDrag(null);
    if (!d) return;
    if (reduced) { onCommit(d); return; }
    // Fly out along the dominant axis, then hand the decision on.
    setLeaving(d === "unsub" ? { dx: 0, dy: -width * 2 }
      : { dx: (d === "trash" ? -1 : 1) * width * 2, dy: 0 });
    timer.current = setTimeout(() => onCommit(d), EXIT_MS);
  };
  const cancel = () => { start.current = null; setDrag(null); };

  const pos = leaving ?? drag;
  const intent: Exclude<Decision, "protect"> | null = !pos ? null
    : Math.abs(pos.dx) >= Math.abs(pos.dy)
      ? (pos.dx < 0 ? "trash" : pos.dx > 0 ? "keep" : null)
      : (pos.dy < 0 ? "unsub" : null);
  const progress = pos ? Math.min(1, Math.max(Math.abs(pos.dx),
    Math.abs(pos.dy)) / ((el.current?.offsetWidth || 300) * 0.3)) : 0;
  const style = pos ? {
    transform: `translate(${pos.dx}px, ${pos.dy}px) rotate(${pos.dx / 25}deg)`,
    transition: leaving ? `transform ${EXIT_MS}ms ease-out, opacity ${EXIT_MS}ms`
      : "none",
    opacity: leaving ? 0 : 1,
  } : {
    transition: reduced ? "none" : "transform 150ms ease-out",
  };

  return (
    <div ref={el} data-testid="triage-card" style={style}
      onPointerDown={down} onPointerMove={move} onPointerUp={up}
      onPointerCancel={cancel}
      className="relative w-full max-w-sm touch-none select-none rounded-card
        border border-line bg-panel2 p-4 shadow-popover">
      {intent && allowed(intent) && (
        <div aria-hidden style={{ opacity: progress }}
          className={`absolute right-3 top-3 rounded-badge border-2
            border-current px-2 py-0.5 type-heading uppercase ${STAMP[intent]}`}>
          {t(`triage.${intent}`)}
        </div>
      )}
      <div className="flex items-start gap-3">
        <Avatar name={g.label || g.key} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="min-w-0 truncate type-heading">{g.label}</h2>
            {g.protected && (
              <ShieldCheck size={16} aria-label={t("triage.protected_label")}
                className="shrink-0 text-accent" />
            )}
          </div>
          {g.sub && (
            <div className="truncate type-meta text-muted">
              {localizedSub(g.sub)}
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="type-heading tabular-nums">{g.count}</div>
          <div className="type-meta text-muted">{t("triage.mails")}</div>
        </div>
        <div>
          <div className="type-heading tabular-nums">{fmtSize(g.size)}</div>
          <div className="type-meta text-muted">{t("triage.size")}</div>
        </div>
        <div>
          <div className="type-heading tabular-nums">{unreadPct(g)}%</div>
          <div className="type-meta text-muted">{t("unread")}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <EngagementMeter g={g} />
        {g.ai && <AiTag ai={g.ai} />}
        {g.unsubscribed?.status === "done" && (
          <Tag tone="safe" className="whitespace-nowrap">
            ✓ {t("Unsubscribed")}
          </Tag>
        )}
        {g.new && <Tag tone="new">🆕 {t("New")}</Tag>}
        {g.tags.slice(0, 3).map((x) => <Tag key={x}>{x}</Tag>)}
        <span className="ml-auto type-meta text-muted">
          <ShortDate iso={g.last} />
        </span>
      </div>
      {g.samples.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line pt-3">
          {g.samples.slice(0, 3).map((s, i) => (
            <li key={i} className="truncate type-meta text-muted">{s}</li>
          ))}
        </ul>
      )}
      {g.protected && (
        <div className="mt-3 type-meta text-accent">
          {t("triage.protected_kept")}
        </div>
      )}
    </div>
  );
}

const DECISION_BTN: {
  d: Decision; icon: typeof Trash2; key: string;
}[] = [
  { d: "trash", icon: Trash2, key: "triage.trash" },
  { d: "keep", icon: Check, key: "triage.keep" },
  { d: "unsub", icon: X, key: "triage.unsub" },
  { d: "protect", icon: ShieldCheck, key: "triage.protect" },
];

/** One group per card: Trash / Keep / Unsubscribe / Protect. Decisions only
 *  accumulate here; `onApply` (the parent's single confirm + the existing
 *  protect / unsubscribe / trash paths) is the only thing that acts. */
export function TriagePanel({ groups, grouping, onApply, onClose }: {
  groups: Group[]; grouping: Grouping;
  /** Resolves true when applied (the panel then closes itself). */
  onApply: (plan: TriagePlan) => Promise<boolean>;
  onClose: () => void;
}) {
  // The deck is fixed when the panel opens; a refresh behind it never
  // reshuffles the cards.
  const [deck] = useState(() => buildDeck(groups));
  const byKey = useMemo(
    () => Object.fromEntries(deck.map((g) => [g.key, g])), [deck]);
  const [idx, setIdx] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [history, setHistory] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const reduced = useMediaQuery(REDUCED);
  const phone = useMediaQuery("(width < 40rem)");

  const finished = idx >= deck.length;
  const summaryOpen = review || finished;
  const g = deck[idx];
  const sum = summarize(decisions, byKey);
  const plan = planOf(decisions, deck, grouping);

  const decide = (d: Decision) => {
    if (!g || summaryOpen || !can(d, g, grouping)) return;
    setDecisions((m) => ({ ...m, [g.key]: d }));
    setHistory((h) => [...h, g.key]);
    setIdx(idx + 1);
  };
  const undo = () => {
    const key = history[history.length - 1];
    if (key === undefined) return;
    setHistory(history.slice(0, -1));
    setDecisions(({ [key]: _gone, ...rest }) => rest);
    setIdx(deck.findIndex((x) => x.key === key));
    setReview(false);
  };
  const close = async () => {
    if (busy) return;
    if (sum.actions > 0 && !await confirmDialog({
      title: t("triage.discard_title", { n: sum.actions }),
      body: t("triage.discard_body"), tone: "danger",
      confirmLabel: t("triage.discard") })) return;
    onClose();
  };
  const apply = async () => {
    setBusy(true);
    try { if (await onApply(plan)) onClose(); }
    finally { setBusy(false); }
  };

  // Keys act on the window (the dialog itself holds focus, not a field).
  const handler = useRef<(e: KeyboardEvent) => void>(undefined);
  handler.current = (e) => {
    if (e.defaultPrevented || summaryOpen || busy || e.ctrlKey || e.metaKey
        || e.altKey) return;
    const map: Record<string, Decision | "undo"> = {
      ArrowLeft: "trash", ArrowRight: "keep", ArrowUp: "unsub",
      Backspace: "undo",
    };
    const act = map[e.key];
    if (!act) return;
    e.preventDefault();
    if (act === "undo") undo(); else decide(act);
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => handler.current?.(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const parts = [
    sum.trash.groups > 0 && t("triage.s_trash",
      { n: sum.trash.groups, size: fmtSize(sum.trash.size) }),
    sum.unsub > 0 && t("triage.s_unsub", { n: sum.unsub }),
    sum.protect > 0 && t("triage.s_protect", { n: sum.protect }),
  ].filter(Boolean);
  const line = parts.length ? parts.join(" · ") : t("triage.nothing_yet");

  return (
    <Modal full label={t("triage.title")} onClose={close}>
      <PanelHeader title={<><Layers size={18} aria-hidden
        className="mr-1.5 inline align-text-bottom" />{t("triage.title")}</>}
        sub={summaryOpen ? t("triage.summary_title")
          : t("triage.progress", { n: idx + 1, total: deck.length })}
        actions={!summaryOpen && (
          <Button variant="secondary" size="sm"
            onClick={() => setReview(true)}>{t("triage.done")}</Button>
        )}
        onClose={close} />
      <ProgressBar thin value={idx} max={deck.length} />
      <div role="status" className="border-b border-line px-4 py-2 type-meta
        text-muted">
        {line}
      </div>
      {summaryOpen ? (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          <SectionLabel>{t("triage.summary_title")}</SectionLabel>
          {sum.actions === 0 ? (
            <p className="type-body text-muted">{t("triage.nothing_to_apply")}</p>
          ) : (
            <ul className="space-y-2 type-body">
              {plan.trash.length > 0 && (
                <li><Trash2 size={16} aria-hidden
                  className="mr-1.5 inline align-text-bottom" />
                  {t("triage.s_trash_mails", { n: sum.trash.groups,
                    mails: sum.trash.mails, size: fmtSize(sum.trash.size) })}
                </li>
              )}
              {plan.unsub.length > 0 && (
                <li><X size={16} aria-hidden
                  className="mr-1.5 inline align-text-bottom" />
                  {t("triage.s_unsub_long", { n: plan.unsub.length })}</li>
              )}
              {plan.protect.length > 0 && (
                <li><ShieldCheck size={16} aria-hidden
                  className="mr-1.5 inline align-text-bottom" />
                  {t("triage.s_protect_long", { n: plan.protect.length })}</li>
              )}
            </ul>
          )}
          <p className="type-meta text-muted">
            {sum.keep > 0 && t("triage.kept_note", { n: sum.keep })}
            {!finished && " " + t("triage.unseen_note",
              { n: deck.length - idx })}
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center
          justify-center gap-3 overflow-hidden p-4">
          <Card key={g.key} g={g} grouping={grouping} reduced={reduced}
            onCommit={decide} />
          <p className="max-w-sm text-center type-meta text-muted">
            {t("triage.hint")}
          </p>
        </div>
      )}
      <div className="border-t border-line px-4 py-3 sm:px-5
        max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {summaryOpen ? (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy}
              onClick={() => (finished ? undo() : setReview(false))}>
              {t("triage.back")}
            </Button>
            <Button disabled={busy || sum.actions === 0} onClick={apply}>
              {t("triage.apply")}
            </Button>
          </div>
        ) : (
          <div className="flex items-stretch gap-2">
            <Button variant="secondary" size="icon" label={t("triage.undo")}
              disabled={!history.length} onClick={undo}>
              <Undo2 size={18} />
            </Button>
            <div className="grid flex-1 grid-cols-4 gap-2">
              {DECISION_BTN.map(({ d, icon: Icon, key }) => (
                <Button key={d} variant="secondary"
                  disabled={!can(d, g, grouping)}
                  title={d === "trash" && g.protected
                    ? t("triage.protected_kept") : undefined}
                  className={`flex flex-col items-center justify-center gap-0.5
                    ${phone ? "px-1" : ""}`}
                  onClick={() => decide(d)}>
                  <Icon size={16} aria-hidden />
                  <span className="type-caption">{t(key)}</span>
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
