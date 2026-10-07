/* Pure helpers - kept dependency-free so they are unit-testable. */

import type { Group } from "./types";

export const fmtSize = (b: number): string =>
  b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB`
  : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`;

/** Short locale date for display: "6 Oct" / "6. Okt." this year, with the
 *  year ("6 Oct 2024") otherwise; `time` appends the wall-clock HH:MM of
 *  the string ("6 Oct, 21:48") when it has one. Takes the leading
 *  YYYY-MM-DD of an ISO string; anything else (empty, malformed) is
 *  returned unchanged. `lang` is passed in (callers use getLang()) so this
 *  file stays dependency-free. Put the full ISO date in a title - see
 *  ShortDate in ui.tsx. */
export function fmtDate(iso: string, now: Date = new Date(),
                        opts: { lang?: "en" | "de"; time?: boolean } = {}
): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso || "");
  if (!m) return iso;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);   // not Date.UTC: it maps years < 100
  if (dt.getUTCMonth() !== mo - 1) return iso;   // e.g. 2025-02-31
  const withTime = opts.time && m[4] !== undefined;
  if (withTime) dt.setUTCHours(Number(m[4]), Number(m[5]));
  return new Intl.DateTimeFormat(opts.lang === "de" ? "de-DE" : "en-GB", {
    day: "numeric", month: "short", timeZone: "UTC",
    ...(y === now.getFullYear() ? {} : { year: "numeric" }),
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
      : {}),
  }).format(dt);
}

export const fmtUsd = (c: number): string =>
  `$${c < 0.1 ? c.toFixed(4) : c.toFixed(2)}`;

export const mailKey = (m: { folder: string; uid: number }): string =>
  `${m.folder} ${m.uid}`;

/** Compact relative age: "3m", "2h", "5d" (empty for missing/future). */
export const fmtAgo = (ts: number | null | undefined,
                       now = Date.now() / 1000): string => {
  if (!ts || ts > now) return "";
  const s = now - ts;
  if (s < 90) return "1m";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};

/** Merge a slim SSE status message into the current state. Returns the
 *  merged state, or null when a FULL fetch is needed instead (no state
 *  yet, another account, or the group lists changed on the server). */
export const applyStatus = <S extends { account: string; groups_rev: number;
    groups: unknown }>(prev: S | null, slim: Omit<S, "groups">): S | null => {
  if (!prev || prev.account !== slim.account
      || prev.groups_rev !== slim.groups_rev) return null;
  return { ...prev, ...slim, groups: prev.groups };
};

export const olderThan = (m: { ts: number }, months: number): boolean =>
  m.ts > 0 && m.ts < Date.now() / 1000 - months * 30.44 * 86400;

/** Mirrors backend/mailops.py retained_mails(): the mails a retention
 * restriction EXEMPTS from an action (the keep-window), as mailKey()s.
 * Newest-first; ts == 0 sorts oldest; ties break by folder+uid - same
 * order the backend applies, so a client-side preview count matches what
 * the server will actually act on. With `skipPinned`, pinned mails
 * (`pinned: true`) are always part of the keep-set on top of the window -
 * they never use up a keep-latest slot. */
export function retainedMailKeys(
    mails: { folder: string; uid: number; ts: number; pinned?: boolean }[],
    keepLatest: number | null, olderThanDays: number | null,
    skipPinned = false): Set<string> {
  const out = new Set<string>();
  if (skipPinned) {
    for (const m of mails) if (m.pinned) out.add(mailKey(m));
  }
  if (!keepLatest && !olderThanDays) return out;
  const items = [...mails].sort((a, b) =>
    b.ts - a.ts || a.folder.localeCompare(b.folder) || a.uid - b.uid);
  let keep: typeof items;
  if (keepLatest) {
    keep = items.slice(0, keepLatest);
  } else {
    const cutoff = Date.now() / 1000 - (olderThanDays as number) * 86400;
    keep = items.filter((m) => m.ts !== 0 && m.ts >= cutoff);
  }
  for (const m of keep) out.add(mailKey(m));
  return out;
}

/* Engagement tiers of a group's 0-100 score (backend/mailops.py
 * engagement()). Thresholds mirror ENGAGEMENT_LOW_MAX / ENGAGEMENT_HIGH_MIN
 * there - parity-tested. */
export const ENGAGEMENT_LOW_MAX = 33;
export const ENGAGEMENT_HIGH_MIN = 67;
export type EngagementTier = "low" | "medium" | "high";

export const engagementTier = (score: number): EngagementTier =>
  score <= ENGAGEMENT_LOW_MAX ? "low"
  : score >= ENGAGEMENT_HIGH_MIN ? "high" : "medium";

/* Proton Sieve snippet for a sender/domain, pasteable into
 * Settings → Filters → Add sieve filter. Pure template, no server state. */
export type SieveAction = "discard" | "fileinto" | "markread";

const sieveQ = (s: string): string =>
  s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export function sieveSnippet(kind: "sender" | "domain", value: string,
  action: SieveAction, folder = "Archive"): string {
  const requires = action === "fileinto" ? 'require ["fileinto"];\n'
    : action === "markread" ? 'require ["imap4flags"];\n' : "";
  const test = kind === "domain"
    ? `address :domain "from" "${sieveQ(value)}"`
    : `address :is "from" "${sieveQ(value)}"`;
  const body = action === "discard" ? "    discard;\n    stop;"
    : action === "fileinto" ? `    fileinto "${sieveQ(folder)}";`
    : '    addflag "\\\\Seen";';
  return `${requires}# mailbroom: ${value}\n`
    + `if ${test} {\n${body}\n}`;
}

/* --------------------------- combined filters ---------------------------
 * Query syntax, whitespace-separated and combinable:
 *   tag:shipping        group has this tag (prefix match)
 *   ai:safe|review|keep AI verdict
 *   age:>1y  age:>6m    last activity older than N years/months
 *   unread:>80          unread percentage above N
 *   is:unsub            group has a List-Unsubscribe header
 *   is:unsubscribed     every unsubscribable sender in the group is done
 *   is:not-unsubscribed the opposite - some sender still needs action
 *   is:protected        group contains protected senders
 *   is:replied          the user has written to this sender before
 *   is:noreply-ever     the user has never written to any of its senders
 *   is:new              sender first seen within the new-sender window
 *   has:pinned          group contains at least one pinned mail
 *   eng:low|medium|high engagement tier (<=33 / 34-66 / >=67)
 *   att:>10m att:>500k  attachment size above N (needs attachment analysis)
 *   from:<addr>         exact sender address (sender grouping only)
 *   domain:<domain>     exact domain (domain grouping only)
 *   anything else       substring match on name / address / key
 */

export interface ParsedFilter {
  text: string[];
  tags: string[];
  ai: string | null;
  ageMonths: number | null;
  unreadMin: number | null;
  unsub: boolean;
  protectedOnly: boolean;
  replied: boolean | null;
  attMin: number | null;
  unsubscribed: boolean | null;
  fromAddr: string | null;
  domain: string | null;
  newOnly: boolean;
  pinnedOnly: boolean;
  eng: EngagementTier | null;
}

const SIZE_UNIT: Record<string, number> = { k: 1024, m: 1048576, g: 1073741824 };

export function parseFilter(q: string): ParsedFilter {
  const out: ParsedFilter = { text: [], tags: [], ai: null,
    ageMonths: null, unreadMin: null, unsub: false, protectedOnly: false,
    replied: null, attMin: null, unsubscribed: null, fromAddr: null,
    domain: null, newOnly: false, pinnedOnly: false, eng: null };
  for (const tok of q.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const m = tok.match(/^(tag|ai|age|unread|is|has|eng|att|from|domain):(.*)$/);
    if (!m) {
      out.text.push(tok);
      continue;
    }
    const [, kind, val] = m;
    if (kind === "tag" && val) out.tags.push(val);
    else if (kind === "ai" && val) {
      out.ai = val === "safe" ? "delete_safe" : val;
    } else if (kind === "age") {
      const a = val.match(/^>?(\d+)(m|y)$/);
      if (a) out.ageMonths = Number(a[1]) * (a[2] === "y" ? 12 : 1);
    } else if (kind === "unread") {
      const u = val.match(/^>?(\d+)$/);
      if (u) out.unreadMin = Number(u[1]);
    } else if (kind === "is" && val === "unsub") out.unsub = true;
    else if (kind === "is" && val === "protected") out.protectedOnly = true;
    else if (kind === "is" && val === "replied") out.replied = true;
    else if (kind === "is" && val === "noreply-ever") out.replied = false;
    else if (kind === "is" && val === "unsubscribed") out.unsubscribed = true;
    else if (kind === "is" && val === "not-unsubscribed") {
      out.unsubscribed = false;
    }
    else if (kind === "is" && val === "new") out.newOnly = true;
    else if (kind === "has" && val === "pinned") out.pinnedOnly = true;
    else if (kind === "eng" && (val === "low" || val === "medium"
        || val === "high")) out.eng = val;
    else if (kind === "att") {
      const a = val.match(/^>?(\d+)(k|m|g)?$/);
      if (a) out.attMin = Number(a[1]) * (SIZE_UNIT[a[2]] ?? 1);
    } else if (kind === "from" && val) out.fromAddr = val;
    else if (kind === "domain" && val) out.domain = val;
    else out.text.push(tok);
  }
  return out;
}

export function matchGroup(g: Group, f: ParsedFilter, now = Date.now()): boolean {
  if (f.fromAddr !== null && g.key !== f.fromAddr) return false;
  if (f.domain !== null && g.key !== f.domain) return false;
  for (const t of f.text) {
    if (!g.key.includes(t) && !g.label.toLowerCase().includes(t) &&
        !g.sub.toLowerCase().includes(t)) return false;
  }
  for (const t of f.tags) {
    if (!g.tags.some((tag) => tag.includes(t))) return false;
  }
  if (f.ai && (!g.ai || !g.ai.verdict.includes(f.ai))) return false;
  if (f.unsub && !g.unsub) return false;
  if (f.protectedOnly && !g.protected) return false;
  if (f.newOnly && !g.new) return false;
  if (f.pinnedOnly && !g.pinned) return false;
  if (f.eng !== null && engagementTier(g.engagement ?? 0) !== f.eng) {
    return false;
  }
  if (f.replied !== null && g.replied !== f.replied) return false;
  if (f.unsubscribed !== null) {
    const done = g.unsubscribed?.status === "done";
    if (done !== f.unsubscribed) return false;
  }
  if (f.attMin !== null && g.att_size < f.attMin) return false;
  if (f.unreadMin !== null) {
    const pct = g.count ? (100 * g.unread) / g.count : 0;
    if (pct < f.unreadMin) return false;
  }
  if (f.ageMonths !== null) {
    const cutoff = new Date(now - f.ageMonths * 30.44 * 86400e3)
      .toISOString().slice(0, 10);
    if (!g.last || g.last >= cutoff) return false;
  }
  return true;
}

/** done/total out of a backend job's free-text progress, or null when it
 *  isn't structured ("connecting…", "queued…"). The formats are "5/20",
 *  "5/20 (+1 job(s) queued)", "5/20 groups" and "INBOX: 5/20" (the folder
 *  name can itself contain digits and a slash, so the folder form is tried FIRST, anchored at the very end, so a folder name
 *  such as "2024/10" can't be mistaken for the counter). */
export function parseProgress(s: string): { done: number; total: number }
    | null {
  const m = /: (\d+)\/(\d+)$/.exec(s) ?? /^(\d+)\/(\d+)\b/.exec(s);
  if (!m) return null;
  const total = Number(m[2]);
  return total > 0 ? { done: Number(m[1]), total } : null;
}
