/* Pure helpers — kept dependency-free so they are unit-testable. */

import type { Group } from "./types";

export const fmtSize = (b: number): string =>
  b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB`
  : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`;

export const fmtUsd = (c: number): string =>
  `$${c < 0.1 ? c.toFixed(4) : c.toFixed(2)}`;

export const mailKey = (m: { folder: string; uid: number }): string =>
  `${m.folder} ${m.uid}`;

export const olderThan = (m: { ts: number }, months: number): boolean =>
  m.ts > 0 && m.ts < Date.now() / 1000 - months * 30.44 * 86400;

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
 *   is:protected        group contains protected senders
 *   is:replied          the user has written to this sender before
 *   is:noreply-ever     the user has never written to any of its senders
 *   att:>10m att:>500k  attachment size above N (needs attachment analysis)
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
}

const SIZE_UNIT: Record<string, number> = { k: 1024, m: 1048576, g: 1073741824 };

export function parseFilter(q: string): ParsedFilter {
  const out: ParsedFilter = { text: [], tags: [], ai: null,
    ageMonths: null, unreadMin: null, unsub: false, protectedOnly: false,
    replied: null, attMin: null };
  for (const tok of q.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const m = tok.match(/^(tag|ai|age|unread|is|att):(.*)$/);
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
    else if (kind === "att") {
      const a = val.match(/^>?(\d+)(k|m|g)?$/);
      if (a) out.attMin = Number(a[1]) * (SIZE_UNIT[a[2]] ?? 1);
    } else out.text.push(tok);
  }
  return out;
}

export function matchGroup(g: Group, f: ParsedFilter, now = Date.now()): boolean {
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
  if (f.replied !== null && g.replied !== f.replied) return false;
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
