/* Wording of Smart grouping rows. The backend ships `kind` / `n_senders` /
 * `category` as fields (and an English fallback `label`); everything the
 * user reads is built here through t(), so German needs no English text
 * from the server. */

import { t } from "./i18n";
import type { Group } from "./types";

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

/** The row as the UI shows it: pooled rows get their translated label and
 *  "N senders" sub-line, own rows pass through untouched (they look and act
 *  exactly like Sender-tab rows). */
export function smartView(g: Group): Group {
  if (!isPooled(g)) return g;
  return { ...g, label: smartLabel(g),
    sub: t("n.senders", { n: g.n_senders ?? g.members?.length ?? 0 }) };
}

/** One plain line on why the mails of a pooled row are together. */
export function smartWhy(g: Group, min: number): string {
  if (!isPooled(g)) return "";
  return t(`smart.why.${g.kind}`, { min, name: g.category ?? "",
    domain: g.domain || g.label });
}
