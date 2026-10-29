/* Space map model: the Sender grouping folded into domains, with the
 * tail of tiny items merged into an "Other" tile. Pure and client-side;
 * the panel (components/SpaceMapPanel.tsx) renders it. */

import { engagementTier, fmtSizeGb } from "./lib";

/** Size with a GB step (fmtSize stops at MB). */
export const fmtBig = fmtSizeGb;
import type { Group, Verdict } from "./types";

/** Items below this share of their level merge into one "Other" tile. */
export const OTHER_SHARE = 0.005;
/** Most tiles on one level (the "Other" tile included). */
export const MAX_TILES = 60;

export interface MapItem {
  id: string;
  kind: "domain" | "sender" | "other";
  /** Domain name / sender address; empty for "other". */
  label: string;
  size: number;
  count: number;
  last: string;             // newest mail, YYYY-MM-DD ("" = unknown)
  engagement: number;       // mail-weighted mean score, 0-100
  verdict: Verdict | null;  // the AI verdict covering most mails, if any
  senders: number;          // sender groups inside
  /** Sender keys a tick selects: everything inside except protected. */
  keys: string[];
  protectedSenders: number;
  /** domain -> its senders; other -> its members; sender -> none. */
  children: MapItem[];
}

export const domainOf = (addr: string): string =>
  addr.includes("@") ? addr.slice(addr.lastIndexOf("@") + 1).toLowerCase()
    : addr.toLowerCase();

/** Verdict that covers the most mails; ties go to the more cautious one. */
const TIE: Verdict[] = ["keep", "review", "delete_safe"];
export function dominantVerdict(
    votes: Partial<Record<Verdict, number>>): Verdict | null {
  let best: Verdict | null = null;
  for (const v of TIE) {
    const n = votes[v] ?? 0;
    if (n > 0 && (best === null || n > (votes[best] ?? 0))) best = v;
  }
  return best;
}

const senderItem = (g: Group): MapItem => ({
  id: `s:${g.key}`, kind: "sender", label: g.key,
  size: g.size, count: g.count, last: g.last || "",
  engagement: g.engagement ?? 0,
  verdict: g.ai?.verdict ?? null,
  senders: 1,
  keys: g.protected ? [] : [g.key],
  protectedSenders: g.protected ? 1 : 0,
  children: [],
});

/** Combine items under one parent tile (domain or other). */
function parent(id: string, kind: "domain" | "other", label: string,
                kids: MapItem[]): MapItem {
  let size = 0, count = 0, eng = 0, last = "";
  const votes: Partial<Record<Verdict, number>> = {};
  for (const k of kids) {
    size += k.size; count += k.count; eng += k.engagement * k.count;
    if (k.last > last) last = k.last;
    if (k.verdict) votes[k.verdict] = (votes[k.verdict] ?? 0) + k.count;
  }
  return {
    id, kind, label, size, count, last,
    engagement: count ? eng / count : 0,
    verdict: dominantVerdict(votes),
    senders: kids.reduce((a, k) => a + k.senders, 0),
    keys: kids.flatMap((k) => k.keys),
    protectedSenders: kids.reduce((a, k) => a + k.protectedSenders, 0),
    children: kids,
  };
}

/** Top level: one item per domain, each holding its senders (biggest
 *  first). Senders without any size are left out - they have no area. */
export function buildDomains(groups: Record<string, Group>): MapItem[] {
  const byDomain = new Map<string, MapItem[]>();
  for (const g of Object.values(groups)) {
    if (!(g.size > 0)) continue;
    const d = domainOf(g.key);
    const list = byDomain.get(d);
    if (list) list.push(senderItem(g)); else byDomain.set(d, [senderItem(g)]);
  }
  const bySize = (a: MapItem, b: MapItem) =>
    b.size - a.size || a.label.localeCompare(b.label);
  return [...byDomain].map(([d, kids]) =>
    parent(`d:${d}`, "domain", d, kids.sort(bySize))).sort(bySize);
}

/** The tiles of one level: biggest first, the small tail folded into one
 *  "Other" tile, never more than MAX_TILES. `merge` = fold items under
 *  OTHER_SHARE (off inside an Other tile, whose members are all small by
 *  construction; the cap still applies there). A lone leftover stays what
 *  it is - an "Other (1)" tile would only hide it. */
export function levelTiles(items: MapItem[], merge = true): MapItem[] {
  const sorted = [...items].sort((a, b) =>
    b.size - a.size || a.label.localeCompare(b.label));
  const total = sorted.reduce((a, it) => a + it.size, 0);
  let keep = sorted.length;
  if (merge && total > 0) {
    keep = sorted.filter((it) => it.size >= total * OTHER_SHARE).length;
  }
  if (sorted.length > MAX_TILES) keep = Math.min(keep, MAX_TILES - 1);
  const rest = sorted.slice(keep);
  if (rest.length === 0 || (rest.length === 1 && sorted.length <= MAX_TILES)) {
    return sorted;
  }
  return [...sorted.slice(0, keep),
    parent(`o:${rest.length}:${rest[0].id}`, "other", "", rest)];
}

/** Every sender in the tree by key (leaf items), for the selection bar. */
export function senderIndex(domains: MapItem[]): Map<string, MapItem> {
  const out = new Map<string, MapItem>();
  for (const d of domains) for (const s of d.children) {
    out.set(s.label, s);
  }
  return out;
}

/** 0..2: how much of an item's selectable keys are ticked. */
export const tickState = (it: MapItem, sel: Set<string>): "none" | "some"
    | "all" => {
  if (!it.keys.length) return "none";
  const n = it.keys.filter((k) => sel.has(k)).length;
  return n === 0 ? "none" : n === it.keys.length ? "all" : "some";
};

/** Toggle: all ticked -> untick them; otherwise tick all. Protected
 *  senders are never part of `keys`, so they can never get in. */
export function toggleItem(it: MapItem, sel: Set<string>): Set<string> {
  const next = new Set(sel);
  const all = tickState(it, sel) === "all";
  for (const k of it.keys) { if (all) next.delete(k); else next.add(k); }
  return next;
}

export type ColorBy = "engagement" | "age" | "ai";
/** 0 = quiet, 1 = middle, 2 = strong (strong = a cleanup candidate). */
export type Heat = 0 | 1 | 2;

export function heatOf(it: MapItem, by: Exclude<ColorBy, "ai">,
                       now = Date.now()): Heat {
  if (by === "engagement") {
    return { low: 2, medium: 1, high: 0 }[engagementTier(it.engagement)] as Heat;
  }
  const cut = (months: number) => new Date(now - months * 30.44 * 86400e3)
    .toISOString().slice(0, 10);
  if (!it.last) return 1;
  return it.last < cut(24) ? 2 : it.last < cut(6) ? 1 : 0;
}
