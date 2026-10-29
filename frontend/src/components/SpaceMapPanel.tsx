import { Check, ChevronRight, LayoutGrid, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import { fmtBig, heatOf, levelTiles, buildDomains, senderIndex, tickState,
  toggleItem, type ColorBy, type Heat, type MapItem } from "../spacemap";
import { squarify } from "../treemap";
import type { Group, Verdict } from "../types";
import { Button, Checkbox, Chip, EmptyState, Modal, PanelHeader, SectionLabel,
  Segmented, useMediaQuery } from "./ui";

const HEAT: Record<Heat, string> = {
  0: "bg-chip text-body",
  1: "bg-accent/45 text-body",
  2: "bg-accent text-white",
};
const VERDICT_CLS: Record<Verdict, string> = {
  delete_safe: "bg-safe-bg text-safe-fg",
  review: "bg-review-bg text-review-fg",
  keep: "bg-keep-bg text-keep-fg",
};
const VERDICT_KEY: Record<Verdict, string> = {
  delete_safe: "space.ai_safe", review: "space.ai_review",
  keep: "space.ai_keep",
};

const tileClass = (it: MapItem, by: ColorBy): string =>
  by === "ai"
    ? (it.verdict ? VERDICT_CLS[it.verdict] : "bg-chip text-muted")
    : HEAT[heatOf(it, by)];

const nameOf = (it: MapItem): string =>
  it.kind === "other" ? t("space.other", { n: it.children.length }) : it.label;

const MAX_LIST = 20;
const MAP_W_FALLBACK = 600;

/** Treemap of the mailbox by size: domains first, tap one to see its
 *  senders. A "Select" mode ticks tiles; Done hands the ticked sender keys
 *  to the main list (the usual bulk bar, confirm and undo do the rest) -
 *  nothing is moved from in here. */
export function SpaceMapPanel({ groups, onDone, onClose }: {
  groups: Record<string, Group>;
  onDone: (keys: string[]) => void;
  onClose: () => void;
}) {
  const [path, setPath] = useState<string[]>([]);
  const [by, setBy] = useState<ColorBy>("engagement");
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const wide = useMediaQuery("(min-width: 640px)");
  const box = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(MAP_W_FALLBACK);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) setCw(el.clientWidth);
    });
    ro.observe(el);
    if (el.clientWidth > 0) setCw(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const domains = useMemo(() => buildDomains(groups), [groups]);
  const hasAi = useMemo(
    () => Object.values(groups).some((g) => g.ai), [groups]);
  const index = useMemo(() => senderIndex(domains), [domains]);
  const totals = useMemo(() => domains.reduce(
    (a, d) => ({ size: a.size + d.size, count: a.count + d.count }),
    { size: 0, count: 0 }), [domains]);
  // The drilled-into items, resolved by id on every render so a refreshed
  // mailbox never leaves a stale tile behind (a vanished one ends the trail).
  const { trail, level } = useMemo(() => {
    const trail: MapItem[] = [];
    let level = levelTiles(domains);
    for (const id of path) {
      const hit = level.find((i) => i.id === id);
      if (!hit) break;
      trail.push(hit);
      level = levelTiles(hit.children, hit.kind === "domain");
    }
    return { trail, level };
  }, [domains, path]);

  const H = cw * (wide ? 0.6 : 1.15);
  const rects = useMemo(() => new Map(squarify(
    level.map((it) => ({ key: it.id, value: it.size })),
    { x: 0, y: 0, w: cw, h: H }).map((r) => [r.key, r])), [level, cw, H]);

  const drill = (it: MapItem) => setPath([...trail.map((i) => i.id), it.id]);
  const tick = (it: MapItem) => setSel((s) => toggleItem(it, s));
  const press = (it: MapItem) => {
    if (selecting) { tick(it); return; }
    if (it.kind === "sender") { setSelecting(true); tick(it); return; }
    drill(it);
  };

  const picked = [...sel].filter((k) => index.has(k));
  const pickedSize = picked.reduce((a, k) => a + index.get(k)!.size, 0);
  const done = () => { if (picked.length) onDone(picked); };
  const protectedHere = level.some((it) => it.protectedSenders > 0);

  const label = (it: MapItem): string => {
    const p = it.protectedSenders;
    return [t("space.tile", { name: nameOf(it), size: fmtBig(it.size),
      mails: it.count.toLocaleString(), n: it.count }),
      ...(p ? [t("space.tile_protected", { n: p })] : []),
      ...(tickState(it, sel) === "all" ? [t("space.tile_selected")] : []),
    ].join(", ");
  };

  const legend: { cls: string; text: string }[] = by === "ai"
    ? [...(["delete_safe", "review", "keep"] as Verdict[]).map((v) =>
        ({ cls: VERDICT_CLS[v], text: t(VERDICT_KEY[v]) })),
      { cls: "bg-chip", text: t("space.ai_none") }]
    : by === "age"
      ? [{ cls: HEAT[2], text: t("space.age_old") },
        { cls: HEAT[1], text: t("space.age_mid") },
        { cls: HEAT[0], text: t("space.age_new") }]
      : [{ cls: HEAT[2], text: t("space.eng_low") },
        { cls: HEAT[1], text: t("space.eng_mid") },
        { cls: HEAT[0], text: t("space.eng_high") }];

  const modes: { value: ColorBy; label: string }[] = [
    { value: "engagement", label: t("space.by_engagement") },
    { value: "age", label: t("space.by_age") },
    ...(hasAi ? [{ value: "ai" as ColorBy, label: t("space.by_ai") }] : []),
  ];
  const mode = modes.some((m) => m.value === by) ? by : "engagement";

  return (
    <Modal full onClose={onClose} label={t("space.title")}>
      <PanelHeader title={<span className="inline-flex items-center gap-2">
        <LayoutGrid size={18} /> {t("space.title")}
      </span>}
        sub={domains.length ? t("space.total", {
          size: fmtBig(totals.size), mails: totals.count.toLocaleString(),
          n: totals.count }) : undefined}
        onClose={onClose} />
      {!domains.length ? (
        <div className="p-4"><EmptyState>{t("space.empty")}</EmptyState></div>
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented label={t("space.color_by")} value={mode}
                options={modes} onChange={setBy} />
              <Chip on={selecting} onClick={() => setSelecting(!selecting)}>
                {t("space.select")}
              </Chip>
            </div>
            <nav aria-label={t("space.crumbs")}
              className="flex flex-wrap items-center gap-x-1 type-meta">
              {trail.length === 0
                ? <span className="font-medium">{t("space.all")}</span>
                : <Button variant="quiet" size="sm" onClick={() => setPath([])}>
                  {t("space.all")}
                </Button>}
              {trail.map((it, i) => (
                <span key={it.id} className="inline-flex items-center gap-1">
                  <ChevronRight size={14} className="text-faint" aria-hidden />
                  {i === trail.length - 1
                    ? <span aria-current="page" className="font-medium">
                      {nameOf(it)}</span>
                    : <Button variant="quiet" size="sm"
                      onClick={() => setPath(path.slice(0, i + 1))}>
                      {nameOf(it)}
                    </Button>}
                </span>
              ))}
            </nav>
            <div ref={box} data-testid="space-map" role="group"
              aria-label={t("space.map")}
              className="relative w-full overflow-hidden rounded-card
                border border-line bg-panel2" style={{ height: H }}>
              {level.map((it) => {
                const r = rects.get(it.id);
                if (!r || r.w < 1 || r.h < 1) return null;
                const ts = tickState(it, sel);
                const full = r.w >= 84 && r.h >= 48;
                const mini = r.w >= 56 && r.h >= 28;
                const locked = selecting && it.keys.length === 0;
                return (
                  <button key={it.id} type="button"
                    aria-label={label(it)}
                    aria-pressed={selecting
                      ? (ts === "some" ? "mixed" : ts === "all") : undefined}
                    aria-disabled={locked || undefined}
                    onClick={() => { if (!locked) press(it); }}
                    style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
                    className={`absolute box-border overflow-hidden border
                      border-panel p-1.5 text-left transition-colors
                      hover:brightness-110 enabled:active:translate-y-px
                      focus-visible:z-(--z-sticky)
                      focus-visible:-outline-offset-2
                      ${tileClass(it, mode)}
                      ${ts !== "none" ? "ring-2 ring-inset ring-body" : ""}
                      ${locked ? "cursor-not-allowed" : ""}`}>
                    {ts !== "none" && (
                      <Check size={14} aria-hidden
                        className="absolute right-1 top-1" />
                    )}
                    {it.protectedSenders > 0 && mini && (
                      <ShieldCheck size={14} aria-hidden
                        className={`absolute right-1
                          ${ts !== "none" ? "top-5" : "top-1"}`} />
                    )}
                    {mini && (
                      <span className="block truncate pr-4 type-meta
                        font-medium">{nameOf(it)}</span>
                    )}
                    {full && (
                      <span className="block truncate type-meta
                        tabular-nums opacity-80">{fmtBig(it.size)}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 type-meta text-muted"
              aria-label={t("space.legend")}>
              {legend.map((l) => (
                <li key={l.text} className="inline-flex items-center gap-1.5">
                  <span className={`size-3 rounded-badge border border-line
                    ${l.cls}`} aria-hidden />
                  {l.text}
                </li>
              ))}
            </ul>
            {selecting && protectedHere && (
              <p className="type-meta text-muted">
                <ShieldCheck size={14} aria-hidden
                  className="mr-1 inline align-text-bottom" />
                {t("space.protected_note")}
              </p>
            )}
            <div>
              <SectionLabel>{t("space.top")}</SectionLabel>
              <ol className="divide-y divide-line">
                {level.slice(0, MAX_LIST).map((it) => (
                  <li key={it.id} className="flex items-center gap-2 py-1">
                    {selecting && (
                      <Checkbox aria-label={t("space.tick", { name:
                        nameOf(it) })}
                        disabled={it.keys.length === 0}
                        checked={tickState(it, sel) === "all"}
                        ref={(el) => {
                          if (el) el.indeterminate = tickState(it, sel) === "some";
                        }}
                        onChange={() => tick(it)} />
                    )}
                    {it.kind === "sender"
                      ? <span className="min-w-0 flex-1 truncate type-body">
                        {it.label}</span>
                      : <button type="button" onClick={() => drill(it)}
                        className="min-h-8 coarse:min-h-11 min-w-0 flex-1
                          truncate text-left type-body underline
                          hover:text-body">
                        {nameOf(it)}
                      </button>}
                    {it.protectedSenders > 0 && (
                      <ShieldCheck size={14} className="shrink-0 text-muted"
                        aria-label={t("space.tile_protected",
                          { n: it.protectedSenders })} />
                    )}
                    <span className="shrink-0 type-meta tabular-nums
                      text-muted">
                      {it.count.toLocaleString()} · {fmtBig(it.size)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          {selecting && (
            <div className="flex items-center gap-3 border-t border-line
              bg-panel px-4 py-3 shadow-bar max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]
              sm:px-5">
              <span className="min-w-0 flex-1 type-body" aria-live="polite">
                {t("space.selected", { n: picked.length,
                  size: fmtBig(pickedSize) })}
              </span>
              {picked.length > 0 && (
                <Button variant="quiet" onClick={() => setSel(new Set())}>
                  {t("bar.clear")}
                </Button>
              )}
              <Button disabled={!picked.length} onClick={done}>
                {t("qb.done")}
              </Button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
