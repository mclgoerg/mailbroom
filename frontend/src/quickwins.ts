/* Quick wins: a few ready-made cleanup suggestions after a scan. Every card
 * is a plain filter-box query, so "what does this card mean" has ONE
 * definition (the same parseFilter + matchGroup the list uses) and Review
 * can hand the user the very same list. Pure, dependency-free helpers.
 * Cards that need data (att: needs the attachment pass, ai: needs verdicts)
 * need no extra gate: without the data nothing matches, so they stay
 * under the minimum and are hidden. */

import { matchGroup, parseFilter } from "./lib";
import type { Group } from "./types";

export interface QuickWinDef {
  id: string;
  titleKey: string;
  hintKey: string;
  query: string;
}

export const QUICK_WINS: QuickWinDef[] = [
  { id: "old_newsletters", titleKey: "qw.old_newsletters",
    hintKey: "qw.old_newsletters_hint",
    query: "tag:newsletter unread:>90 age:>6m" },
  { id: "quiet_low", titleKey: "qw.quiet_low", hintKey: "qw.quiet_low_hint",
    query: "eng:low age:>1y" },
  { id: "unsubscribed", titleKey: "qw.unsubscribed",
    hintKey: "qw.unsubscribed_hint", query: "is:unsubscribed" },
  { id: "big_attachments", titleKey: "qw.big_attachments",
    hintKey: "qw.big_attachments_hint", query: "att:>10m age:>2y" },
  { id: "ai_safe", titleKey: "qw.ai_safe", hintKey: "qw.ai_safe_hint",
    query: "ai:safe" },
];

/** A card with fewer mails AND less size than this is not worth showing. */
export const MIN_MAILS = 10;
export const MIN_BYTES = 5 * 1048576;
/** Cards shown before "More". */
export const TOP_CARDS = 3;
/** A dismissed card returns once it covers this much more mail. */
export const GROWTH_FACTOR = 1.25;

export interface QuickWinCard {
  def: QuickWinDef;
  /** Matching, non-protected group keys: what Review selects and Clean up
   *  acts on. */
  keys: string[];
  mails: number;
  size: number;
  /** Matching groups left out because they are protected. */
  protectedSkipped: number;
}

/** What a trash of this group would actually move: pinned mails are always
 *  kept (the confirm says "N pinned kept"). The group record has no
 *  per-pinned size, so the size is scaled by the share of mails that move
 *  - an approximation, hence "free up to". */
const movable = (g: Group): { mails: number; size: number } => {
  const mails = Math.max(0, g.count - (g.pinned ?? 0));
  return { mails, size: g.count ? g.size * mails / g.count : 0 };
};

/** Visible cards (above the minimum), biggest first. */
export function computeQuickWins(groups: Group[], now = Date.now()):
    QuickWinCard[] {
  const cards: QuickWinCard[] = [];
  for (const def of QUICK_WINS) {
    const f = parseFilter(def.query);
    const hits = groups.filter((g) => matchGroup(g, f, now));
    const live = hits.filter((g) => !g.protected);
    const mails = live.reduce((n, g) => n + movable(g).mails, 0);
    const size = Math.round(live.reduce((n, g) => n + movable(g).size, 0));
    if (mails < MIN_MAILS && size < MIN_BYTES) continue;
    cards.push({ def, keys: live.map((g) => g.key), mails, size,
      protectedSkipped: hits.length - live.length });
  }
  return cards.sort((a, b) => b.size - a.size);
}

/** Mails and bytes of the UNION of the cards' groups: a sender matching
 *  two cards counts once. */
export function unionTotals(cards: QuickWinCard[],
    groups: Group[]): { mails: number; size: number } {
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const seen = new Set(cards.flatMap((c) => c.keys));
  let mails = 0;
  let size = 0;
  for (const k of seen) {
    const g = byKey.get(k);
    if (g) { mails += movable(g).mails; size += movable(g).size; }
  }
  return { mails, size: Math.round(size) };
}

/** Per-account dismissals: card id -> its mail count when dismissed. */
export type Dismissed = Record<string, number>;

export const dismissKey = (account: string): string =>
  `pmc_qw_dismissed:${account}`;

export function loadDismissed(account: string): Dismissed {
  try {
    const v = JSON.parse(localStorage.getItem(dismissKey(account)) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function saveDismissed(account: string, d: Dismissed): void {
  localStorage.setItem(dismissKey(account), JSON.stringify(d));
}

/** Hidden until a later scan finds at least 25 % more mails for it. */
export const isDismissed = (d: Dismissed, id: string, mails: number):
    boolean => id in d && mails < d[id] * GROWTH_FACTOR;
