import { mailKey } from "./api";
import { t } from "./i18n";
import { confirmDialog } from "./components/ui";
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
export async function planMailAction(chosen: Mail[], action: string,
    verb: string): Promise<MailActionPlan> {
  let acting = chosen;
  let force = false;
  const tone = action === "mark_read" ? "primary" : "danger";
  if (action !== "mark_read") {
    const pinned = chosen.filter((m) => m.pinned);
    if (chosen.length === 1 && pinned.length === 1) {
      if (!await confirmDialog({ title: verb, tone,
        body: t("confirm.act_pinned_mail", {
          subject: chosen[0].subject || t("(no subject)") }),
        confirmLabel: t("confirm.btn_anyway", { verb }) }))
        return { kind: "cancelled" };
      force = true;
    } else if (pinned.length) {
      acting = chosen.filter((m) => !m.pinned);
      if (!acting.length) return { kind: "all_pinned" };
    }
  }
  if (!force) {
    // A single mail is named by its subject, several by their count.
    const bullets = [acting.length === 1
      ? `"${acting[0].subject || t("(no subject)")}"`
      : t("confirm.b_selected", { n: acting.length })];
    if (acting.length !== chosen.length) {
      bullets.push(t("confirm.b_pinned_skipped",
        { n: chosen.length - acting.length }));
    }
    if (!await confirmDialog({ title: verb, bullets, tone,
      confirmLabel: t("confirm.btn_n", { verb, n: acting.length }) }))
      return { kind: "cancelled" };
  }
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

/** The one confirmation for "move the selected mails to Trash" in the list
 *  panels (Search, Attachments, Duplicates). */
export const confirmTrashMails = (n: number): Promise<boolean> => {
  const verb = actionVerb("trash");
  return confirmDialog({ title: verb, tone: "danger",
    bullets: [t("confirm.b_selected", { n })],
    confirmLabel: t("confirm.btn_n", { verb, n }) });
};
