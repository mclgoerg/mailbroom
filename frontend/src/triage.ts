/* Swipe triage: the pure parts. The deck is a snapshot of the current list;
 * a decision per group is only ever recorded here - nothing touches the
 * mailbox until the user applies the summary (App.applyTriage). */

import { isPooled } from "./smart";
import type { Group, Grouping } from "./types";

export type Decision = "trash" | "keep" | "unsub" | "protect";

/** Cards per session: a deck is a sitting, not the whole mailbox. */
export const DECK_MAX = 50;

/** A drag commits past this share of the card width... */
export const COMMIT_RATIO = 0.3;
/** ...or when released as a fling: px per ms and a minimum distance. */
export const FLING_SPEED = 0.6;
export const FLING_MIN_PX = 40;

export const buildDeck = (groups: Group[], max = DECK_MAX): Group[] =>
  groups.slice(0, max);

/** Protected groups stay: Trash is not offered for them. */
export const canTrash = (g: Group): boolean => !g.protected;

/** Only where there is a List-Unsubscribe header, the sender is not already
 *  unsubscribed, and a single sender stands behind the row (a Smart pool
 *  is unsubscribed one sender at a time). A protected sender is skipped by
 *  the backend, so the card does not offer it either. */
export const canUnsub = (g: Group): boolean =>
  g.unsub && !isPooled(g) && !g.protected && g.unsubscribed?.status !== "done";

/** Protect (and the address it stores) exists for Sender / Domain rows. */
export const canProtect = (g: Group, grouping: Grouping): boolean =>
  (grouping === "sender" || grouping === "domain") && !g.protected;

/** The entry /api/protect takes: the address, or `@domain` for a domain row. */
export const protectEntry = (grouping: Grouping, g: Group): string =>
  grouping === "domain" ? `@${g.key}` : g.key;

export const can = (d: Decision, g: Group, grouping: Grouping): boolean =>
  d === "trash" ? canTrash(g)
    : d === "unsub" ? canUnsub(g)
      : d === "protect" ? canProtect(g, grouping) : true;

/** Where a pointer drag ends up: the decision it commits, or null (spring
 *  back). Left = Trash, right = Keep, up = Unsubscribe; the dominant axis
 *  wins, and a decision the group does not allow never commits. */
export function dragDecision(dx: number, dy: number, width: number,
    elapsedMs: number, allowed: (d: Decision) => boolean): Decision | null {
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const dist = horizontal ? Math.abs(dx) : -dy;
  if (dist <= 0) return null;
  const speed = dist / Math.max(1, elapsedMs);
  const far = dist >= width * COMMIT_RATIO
    || (dist >= FLING_MIN_PX && speed >= FLING_SPEED);
  if (!far) return null;
  const d: Decision = horizontal ? (dx < 0 ? "trash" : "keep") : "unsub";
  return allowed(d) ? d : null;
}

export interface TriageSummary {
  trash: { groups: number; mails: number; size: number };
  unsub: number;
  protect: number;
  keep: number;
  /** Decisions that change something once applied. */
  actions: number;
}

/** Per-decision totals. Mails exclude pinned ones (never moved); the size is
 *  the groups' full size, so it reads as "up to". */
export function summarize(decisions: Record<string, Decision>,
    byKey: Record<string, Group>): TriageSummary {
  const s: TriageSummary = {
    trash: { groups: 0, mails: 0, size: 0 }, unsub: 0, protect: 0, keep: 0,
    actions: 0,
  };
  for (const [key, d] of Object.entries(decisions)) {
    const g = byKey[key];
    if (!g) continue;
    if (d === "trash") {
      if (!canTrash(g)) continue;
      s.trash.groups++;
      s.trash.mails += Math.max(0, g.count - (g.pinned ?? 0));
      s.trash.size += g.size;
    } else if (d === "unsub") s.unsub++;
    else if (d === "protect") s.protect++;
    else s.keep++;
  }
  s.actions = s.trash.groups + s.unsub + s.protect;
  return s;
}

export interface TriagePlan {
  protect: string[];
  unsub: string[];
  trash: string[];
}

/** The keys each step applies to, in deck order. Re-checks every group's own
 *  rules so a stale decision can never widen what is applied: protected
 *  groups are never in the trash set, and neither is a group that is being
 *  protected (one decision per group). */
export function planOf(decisions: Record<string, Decision>, deck: Group[],
    grouping: Grouping): TriagePlan {
  const plan: TriagePlan = { protect: [], unsub: [], trash: [] };
  for (const g of deck) {
    const d = decisions[g.key];
    if (d === "protect" && canProtect(g, grouping)) plan.protect.push(g.key);
    else if (d === "unsub" && canUnsub(g)) plan.unsub.push(g.key);
    else if (d === "trash" && canTrash(g)) plan.trash.push(g.key);
  }
  return plan;
}
