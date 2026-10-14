/* Wording of Smart grouping rows. The backend ships `kind` / `n_senders` /
 * `category` as fields (and an English fallback `label`); everything the
 * user reads is built here through t(), so German needs no English text
 * from the server. */

import { t } from "./i18n";
import type { Group, SmartWhy } from "./types";

/** A pooled row (company or bucket), as opposed to a big sender's own row. */
export const isPooled = (g: Group): boolean =>
  !!g.kind && g.kind !== "sender";

export function smartLabel(g: Group): string {
  switch (g.kind) {
    case "company": return g.label;            // the domain itself
    case "category": return t("smart.cat", { name: g.category ?? g.label });
    case undefined:
    case "sender": return g.label;
    default: return t(`smart.kind.${g.kind}`);
  }
}

/** Mails per purpose of a company row as one short line ("Orders 6 ·
 *  Accounts 3"), biggest first; `max` entries (the row's sub-line is short,
 *  the detail view shows all). Empty for rows without a summary. */
export function purposeSummary(g: Group, max = 99): string {
  return Object.entries(g.purposes ?? {}).slice(0, max)
    .map(([k, n]) => `${t(`smart.purpose.${k}`)} ${n}`).join(" \u00b7 ");
}

/** The row as the UI shows it: pooled rows get their translated label and
 *  "N senders" sub-line (company rows add what their mails are about), own
 *  rows pass through untouched (they look and act exactly like Sender-tab
 *  rows). */
export function smartView(g: Group): Group {
  if (!isPooled(g)) return g;
  const n = t("n.senders", { n: g.n_senders ?? g.members?.length ?? 0 });
  const what = purposeSummary(g, 2);
  return { ...g, label: smartLabel(g), sub: what ? `${n} \u00b7 ${what}` : n };
}

/** One plain line on why the mails of a pooled row are together. */
export function smartWhy(g: Group, min: number): string {
  if (!isPooled(g)) return "";
  return t(`smart.why.${g.kind}`, { min, name: g.category ?? "",
    domain: g.domain || g.label, n: g.n_senders ?? 0 });
}

/** The name of a kind a sender can be filed under: a fixed kind ("orders")
 *  or `cat:<name>` of one of the user's own categories. */
export function filedKindName(kind: string): string {
  return kind.startsWith("cat:")
    ? t("know.kind_category", { name: kind.slice(4) })
    : t(`smart.kind.${kind}`);
}

/** Kinds offered when filing (backend smartkinds.SORT_KINDS), listed in
 *  Smart's own order. */
export const FILE_KINDS = ["orders", "appointments", "jobs", "support",
  "accounts", "newsletter", "individuals", "other"] as const;

/** What a company row's mails are about, in full (detail view). */
export function smartContent(g: Group): string {
  const list = purposeSummary(g);
  return list ? t("smart.purposes", { list }) : "";
}

/** Why ONE sender sits where it does, in the user's language (the sender
 *  list of a pooled row). The backend ships a structured reason; a sender
 *  placed together with the other senders of a small company says so. */
export function smartReason(why: SmartWhy | undefined): string {
  if (!why) return "";
  if (why.r === "ai" && why.k === "other") {
    return t(why.sure ? "smart.reason.ai_other_sure" : "smart.reason.ai_other");
  }
  if (why.r === "rule" || why.r === "kept_ai") {
    // What the user filed (or kept from an AI answer): a plain sentence, no
    // "placed together with" tail - the filing is the reason.
    const what = why.k === "category"
      ? t("know.kind_category", { name: why.name ?? "" })
      : t(`smart.kind.${why.k ?? "other"}`);
    return t(why.r === "kept_ai" ? "smart.reason.kept_ai"
      : why.by === "co" ? "smart.reason.rule_co" : "smart.reason.rule",
    { what });
  }
  const what = why.k ? t(`smart.about.${why.k}`) : "";
  const text = t(`smart.reason.${why.r}`, { n: why.n ?? 0, of: why.of ?? 0,
    what, name: why.name ?? "", co: why.co ?? "" });
  return why.co && why.r !== "company" && why.r !== "category"
    ? `${text} ${t("smart.reason.with_company", { co: why.co })}` : text;
}
