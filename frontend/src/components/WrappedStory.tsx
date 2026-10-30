import { ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode } from "react";
import { api, fmtSize, saveBlob } from "../api";
import { getLang, t } from "../i18n";
import type { WrappedResp, WrappedSender } from "../types";
import {
  buildSummarySvg, paletteFromTheme, senderName, svgToPngBlob,
  type SummaryStrings,
} from "../wrapped";
import { Button, Checkbox, Loading, Modal, Select } from "./ui";

/** How long an auto-advancing card stays up. */
export const CARD_MS = 6000;
const TICK_MS = 100;
const HOLD_MS = 250;

const num = (n: number) => n.toLocaleString(getLang());
const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);
const monthName = (m: number) =>
  new Date(2001, m - 1, 1).toLocaleString(getLang(), { month: "long" });
// 1 Jan 2001 was a Monday; the API counts Monday as 0
const weekdayName = (d: number) =>
  new Date(2001, 0, 1 + d).toLocaleString(getLang(), { weekday: "long" });

type CardKey = "intro" | "senders" | "loudest" | "month" | "rhythm"
  | "ghosts" | "biggest" | "cleanup" | "summary";

/** The cards that have data, in story order. A year without mail is just
 *  the intro (with the year switcher, so another year can be picked). */
export function cardsFor(d: WrappedResp): CardKey[] {
  if (!d.received.mails) return ["intro"];
  const c = d.cleanup;
  const cleaned = c.trashed + c.archived + c.purged + c.unsubscribes
    + c.rule_runs > 0;
  return [
    "intro", "senders",
    ...(d.top_senders.length ? ["loudest" as const] : []),
    ...(d.loudest_month ? ["month" as const] : []),
    ...(d.busiest_weekday && d.busiest_hour ? ["rhythm" as const] : []),
    ...(d.ghosts.count ? ["ghosts" as const] : []),
    ...(d.biggest ? ["biggest" as const] : []),
    ...(cleaned ? ["cleanup" as const] : []),
    "summary",
  ];
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A card: small lead line, one big figure, a unit line, extra content. */
function Slide({ lead, big, unit, children }: {
  lead: string; big: ReactNode; unit?: ReactNode; children?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-3 px-6 py-8
      sm:px-10">
      <div className="type-heading text-muted">{lead}</div>
      <div className="type-display text-accent">{big}</div>
      {unit && <div className="type-title text-body">{unit}</div>}
      {children}
    </div>
  );
}

function Rows({ rows, showNames }: {
  rows: WrappedSender[]; showNames: boolean;
}) {
  return (
    <ol className="mt-3 space-y-1.5">
      {rows.map((s, i) => (
        <li key={s.addr} className="flex items-baseline gap-2 type-body">
          <span className="w-5 shrink-0 text-muted tabular-nums">{i + 1}.</span>
          <span className="min-w-0 flex-1 truncate">
            {senderName(s, showNames)}
          </span>
          <span className="shrink-0 text-muted tabular-nums">
            {t("n.mails", { n: s.mails })}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="rounded-card bg-panel2 p-3">
      <div className="type-title tabular-nums">{value}</div>
      <div className="type-meta text-muted">{label}</div>
    </div>
  );
}

/** The summary tiles: shared by the last card and the saved image. */
export function summaryStats(d: WrappedResp): { value: string; label: string }[] {
  const r = d.received;
  return [
    { value: num(r.senders), label: t("wrapped.stat.senders") },
    { value: `${pct(r.read, r.mails)}%`, label: t("wrapped.stat.read") },
    { value: num(r.new_senders), label: t("wrapped.stat.new") },
    { value: num(d.ghosts.count), label: t("wrapped.stat.ghosts") },
    { value: num(d.cleanup.trashed + d.cleanup.archived + d.cleanup.purged),
      label: t("wrapped.stat.cleaned") },
    { value: num(d.cleanup.unsubscribes),
      label: t("wrapped.stat.unsubscribed") },
  ];
}

function summaryStrings(d: WrappedResp): SummaryStrings {
  return {
    title: t("wrapped.title_year", { year: d.year }),
    lead: t("wrapped.intro.lead"),
    big: num(d.received.mails),
    unit: t(d.partial ? "wrapped.intro.unit_partial" : "wrapped.intro.unit",
      { n: d.received.mails, year: d.year }),
    note: t("wrapped.based_on_short"),
    stats: summaryStats(d),
    topTitle: t("wrapped.loudest.top"),
    topRows: d.top_senders.map((s) => t("n.mails", { n: s.mails })),
    footer: t("wrapped.footer"),
  };
}

function Card({ card, d, showNames, setShowNames, onYear, onSave, saving }: {
  card: CardKey; d: WrappedResp; showNames: boolean;
  setShowNames: (v: boolean) => void; onYear: (y: number) => void;
  onSave: () => void; saving: boolean;
}) {
  const r = d.received;
  const c = d.cleanup;
  const interactive = "pointer-events-auto relative";
  switch (card) {
    case "intro":
      return (
        <Slide lead={t("wrapped.intro.lead")}
          big={num(r.mails)}
          unit={r.mails ? t(
            d.partial ? "wrapped.intro.unit_partial" : "wrapped.intro.unit",
            { n: r.mails, year: d.year })
            : t("wrapped.empty", { year: d.year })}>
          {d.years.length > 1 && (
            <div className={`${interactive} mt-2 max-w-48`}>
              <Select aria-label={t("wrapped.year")} value={d.year}
                className="w-full"
                onChange={(e) => onYear(Number(e.target.value))}>
                {[...d.years].reverse().map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <p className="mt-2 type-meta text-muted">{t("wrapped.based_on")}</p>
        </Slide>
      );
    case "senders":
      return (
        <Slide lead={t("wrapped.senders.lead")} big={num(r.senders)}
          unit={t("wrapped.senders.unit", { n: r.senders })}>
          <p className="type-body text-muted">
            {t("wrapped.senders.sub", { pct: pct(r.read, r.mails),
              new: r.new_senders })}
          </p>
        </Slide>
      );
    case "loudest": {
      const top = d.top_senders[0];
      return (
        <Slide lead={t("wrapped.loudest.lead")} big={top.label || top.addr}
          unit={`${t("n.mails", { n: top.mails })} · ${fmtSize(top.bytes)}`}>
          <Rows rows={d.top_senders} showNames />
        </Slide>
      );
    }
    case "month":
      return (
        <Slide lead={t("wrapped.month.lead")}
          big={monthName(d.loudest_month!.month)}
          unit={t("wrapped.month.unit", { n: d.loudest_month!.mails })} />
      );
    case "rhythm":
      return (
        <Slide lead={t("wrapped.rhythm.lead")}
          big={weekdayName(d.busiest_weekday!.weekday)}
          unit={t("wrapped.rhythm.unit", { n: d.busiest_weekday!.mails })}>
          <p className="type-body text-muted">
            {t("wrapped.rhythm.hour", {
              hour: `${d.busiest_hour!.hour}:00`, n: d.busiest_hour!.mails })}
          </p>
        </Slide>
      );
    case "ghosts":
      return (
        <Slide lead={t("wrapped.ghosts.lead")} big={num(d.ghosts.count)}
          unit={t("wrapped.ghosts.unit", { n: d.ghosts.count })}>
          <Rows rows={d.ghosts.top} showNames />
        </Slide>
      );
    case "biggest":
      return (
        <Slide lead={t("wrapped.biggest.lead")}
          big={fmtSize(d.biggest!.bytes)}
          unit={t("wrapped.biggest.unit",
            { sender: d.biggest!.label || d.biggest!.addr })} />
      );
    case "cleanup":
      return (
        <Slide lead={t("wrapped.cleanup.lead")}
          big={num(c.trashed + c.archived + c.purged)}
          unit={t("wrapped.cleanup.unit", {
            n: c.trashed + c.archived + c.purged })}>
          <ul className="space-y-1 type-body text-muted">
            <li>{t("wrapped.cleanup.trashed", { n: c.trashed })}</li>
            <li>{t("wrapped.cleanup.archived", { n: c.archived })}</li>
            {c.purged > 0 && (
              <li>{t("wrapped.cleanup.purged",
                { n: c.purged, size: fmtSize(c.freed_bytes) })}</li>
            )}
            {c.unsubscribes > 0 && (
              <li>{t("wrapped.cleanup.unsubs", { n: c.unsubscribes })}</li>
            )}
            {c.rule_runs > 0 && (
              <li>{t("wrapped.cleanup.rules", { n: c.rule_runs })}</li>
            )}
            {c.top_rule && (
              <li>{c.top_rule.deleted
                ? t("wrapped.cleanup.top_rule_gone", { n: c.top_rule.mails })
                : t("wrapped.cleanup.top_rule", {
                  name: c.top_rule.name, n: c.top_rule.mails })}</li>
            )}
          </ul>
        </Slide>
      );
    case "summary":
      return (
        <Slide lead={t("wrapped.summary.lead")} big={num(r.mails)}
          unit={t(d.partial ? "wrapped.intro.unit_partial"
            : "wrapped.intro.unit", { n: r.mails, year: d.year })}>
          <div className="grid grid-cols-2 gap-2">
            {summaryStats(d).map((s) => (
              <Stat key={s.label} value={s.value} label={s.label} />
            ))}
          </div>
          <Rows rows={d.top_senders} showNames={showNames} />
          <div className={`${interactive} mt-2 flex flex-wrap items-center
            gap-3`}>
            <Checkbox label={t("wrapped.show_names")} checked={showNames}
              onChange={(e) => setShowNames(e.target.checked)} />
            <Button disabled={saving} onClick={onSave}>
              {t("wrapped.save")}
            </Button>
          </div>
          <p className="type-meta text-muted">
            {showNames ? t("wrapped.names_shown") : t("wrapped.names_hidden")}
            {" "}{t("wrapped.local_only")}
          </p>
        </Slide>
      );
  }
}

/** "Your year in mail": a full-screen, story-style walk through one
 *  calendar year. Tap the right / left half (or arrow keys) for next /
 *  back, hold to pause, Esc closes. Cards advance by themselves unless the
 *  user prefers reduced motion. */
export function WrappedStory({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<WrappedResp | null>(null);
  const [error, setError] = useState("");
  const [year, setYear] = useState<number | undefined>(undefined);
  const [idx, setIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showNames, setShowNames] = useState(false);
  const [saving, setSaving] = useState(false);
  const held = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasHeld = useRef(false);
  const motion = useMemo(() => !reducedMotion(), []);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    api.wrapped(year)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, [year]);

  const cards = useMemo(() => (data ? cardsFor(data) : []), [data]);
  const last = Math.max(0, cards.length - 1);
  const go = (to: number) => {
    setIdx(Math.min(last, Math.max(0, to)));
    setElapsed(0);
  };
  const next = () => go(idx + 1);
  const back = () => go(idx - 1);

  // The intro (year switcher) and the summary (save) wait for the user.
  const timed = motion && !!data && idx > 0 && idx < last;
  const auto = timed && !paused;
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => setElapsed((e) => e + TICK_MS), TICK_MS);
    return () => clearInterval(id);
  }, [auto]);
  useEffect(() => {
    if (auto && elapsed >= CARD_MS) go(idx + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, auto]);

  // Layout effect, not a passive one: re-registered in the same commit that
  // shows the loaded cards, so a key pressed right then never reaches the
  // loading state's listener (which still sees no cards) - see #147.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // the year select and text fields keep their own arrow keys
      const el = e.target as HTMLInputElement | null;
      if (el?.tagName === "SELECT" || el?.tagName === "TEXTAREA"
        || (el?.tagName === "INPUT" && el.type !== "checkbox")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const pressStart = () => {
    wasHeld.current = false;
    held.current = setTimeout(() => {
      wasHeld.current = true;
      setPaused(true);
    }, HOLD_MS);
  };
  const pressEnd = () => {
    if (held.current) clearTimeout(held.current);
    held.current = null;
    setPaused(false);
  };
  const tap = (fn: () => void) => () => {
    if (wasHeld.current) { wasHeld.current = false; return; }
    fn();
  };

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const svg = buildSummarySvg(data, summaryStrings(data),
        paletteFromTheme(), showNames);
      saveBlob(`mailbroom-wrapped-${data.year}.png`, await svgToPngBlob(svg));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const zone = "absolute inset-y-0 z-0 w-1/2 cursor-pointer";
  return (
    <Modal full onClose={onClose} label={t("wrapped.menu")}>
      <div className="flex items-center gap-3 px-4 pt-4">
        <div role="progressbar" aria-label={t("wrapped.progress")}
          aria-valuemin={1} aria-valuemax={Math.max(1, cards.length)}
          aria-valuenow={idx + 1} className="flex min-w-0 flex-1 gap-1">
          {cards.map((k, i) => (
            <div key={k} aria-hidden className="h-1 flex-1 overflow-hidden
              rounded-full bg-chip">
              <div className="h-full rounded-full bg-accent"
                style={{ width: i < idx || (i === idx && !timed) ? "100%"
                  : i === idx ? `${Math.min(100, (100 * elapsed) / CARD_MS)}%`
                  : "0%" }} />
            </div>
          ))}
        </div>
        <Button variant="secondary" size="icon" label={t("Close")}
          onClick={onClose}>
          <X size={18} />
        </Button>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        {error && <div className="p-6 text-danger-fg">{error}</div>}
        {!data && !error && <Loading />}
        {data && cards[idx] && (
          <>
            {/* The tap zones sit under the content; text lets taps through,
                controls (year, save) opt back in. They are not tab stops:
                the buttons below and the arrow keys do the same. */}
            <button type="button" tabIndex={-1} aria-hidden
              className={`${zone} left-0`}
              onPointerDown={pressStart} onPointerUp={pressEnd}
              onPointerLeave={pressEnd} onPointerCancel={pressEnd}
              onClick={tap(back)} />
            <button type="button" tabIndex={-1} aria-hidden
              className={`${zone} right-0`}
              onPointerDown={pressStart} onPointerUp={pressEnd}
              onPointerLeave={pressEnd} onPointerCancel={pressEnd}
              onClick={tap(next)} />
            <div className="pointer-events-none relative z-10 flex flex-1 flex-col">
              <Card card={cards[idx]} d={data} showNames={showNames}
                setShowNames={setShowNames} saving={saving} onSave={save}
                onYear={(y) => { setYear(y); setIdx(0); setElapsed(0); }} />
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-4 py-3">
        <Button variant="secondary" size="icon" label={t("wrapped.back")}
          disabled={idx === 0} onClick={back}>
          <ChevronLeft size={18} />
        </Button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5
          type-meta text-muted">
          <Sparkles size={14} /> {t("wrapped.menu")}
          {data?.partial && <> · {t("wrapped.so_far")}</>}
        </div>
        <Button variant="secondary" size="icon" label={t("wrapped.next")}
          disabled={!data || idx >= last} onClick={next}>
          <ChevronRight size={18} />
        </Button>
      </div>
    </Modal>
  );
}
