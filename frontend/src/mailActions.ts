import { mailKey } from "./api";
import { t } from "./i18n";
import type { Mail } from "./types";

export type MailActionPlan =
  | { kind: "cancelled" }
  | { kind: "all_pinned" }
  | { kind: "go"; acting: Mail[]; force: boolean };

/** The confirm flow for acting on individually selected mails, shared by
 *  the group detail view and the flat "All mails" list so pinned mails are
 *  handled identically everywhere: ONE pinned mail acted on explicitly
 *  gets its own warning and is sent with `force`; pinned mails inside a
 *  larger selection are dropped from it (never silently moved).
 *  mark_read is non-destructive and exempt. */
export function planMailAction(chosen: Mail[], action: string,
                               verb: string): MailActionPlan {
  let acting = chosen;
  let force = false;
  if (action !== "mark_read") {
    const pinned = chosen.filter((m) => m.pinned);
    if (chosen.length === 1 && pinned.length === 1) {
      if (!confirm(t("confirm.act_pinned_mail", {
        verb, subject: chosen[0].subject || t("(no subject)") })))
        return { kind: "cancelled" };
      force = true;
    } else if (pinned.length) {
      acting = chosen.filter((m) => !m.pinned);
      if (!acting.length) return { kind: "all_pinned" };
    }
  }
  const skipNote = acting.length !== chosen.length
    ? " " + t("confirm.pinned_skipped",
        { n: chosen.length - acting.length }) : "";
  if (!force && !confirm(
    t("confirm.act_mails", { verb, n: acting.length }) + skipNote))
    return { kind: "cancelled" };
  return { kind: "go", acting, force };
}

export const actionVerb = (action: string, dest = ""): string =>
  ({ trash: t("Move to Trash"), archive: t("Archive"),
     move: `${t("Move")} → ${dest}`,
     mark_read: t("Mark as read") } as Record<string, string>)[action]
  ?? action;

export const itemsOf = (mails: Mail[]) =>
  mails.map((m) => [m.folder, m.uid] as [string, number]);

export { mailKey };
