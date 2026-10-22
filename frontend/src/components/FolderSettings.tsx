import { X } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import type { FolderInfo, FoldersResp, SpecialRole } from "../types";
import { Button, Checkbox, confirmDialog, Select, SectionLabel, Tag,
  useToast } from "./ui";

/* Settings > Folders: "Folders to scan" (ordinary folders, nested by the
 * server's hierarchy delimiter) and "Special folders" (one row per role:
 * translated name, the server folder it maps to, how it was found; tied
 * candidates get a Select to confirm one; look-alikes offer a one-time,
 * undoable move of their mail into the real role folder). */

const ROLE_ORDER = ["trash", "junk", "sent", "drafts", "archive", "all"];
// roles whose folder (and look-alikes) never take part in the scan
const UNSCANNED = new Set(["trash", "junk", "sent", "drafts", "all"]);

const roleName = (role: string) => t(`role.${role}`);

/** Rows nested by hierarchy: sorted segment-wise, each shown under its
 *  nearest listed ancestor with only the part below it as its label. */
function nest(items: FolderInfo[]):
  { f: FolderInfo; depth: number; label: string }[] {
  const names = new Set(items.map((x) => x.name));
  const segs = (x: FolderInfo) => x.delim ? x.name.split(x.delim) : [x.name];
  const key = (x: FolderInfo) => segs(x).map((s) => s.toLowerCase());
  // INBOX comes first together with everything below it (GMX keeps the
  // user's own folders under INBOX/): pinning only the INBOX row itself
  // would strand its children under whichever folder sorts next.
  const inInbox = (x: FolderInfo) => segs(x)[0].toUpperCase() === "INBOX";
  const sorted = [...items].sort((a, b) => {
    if (inInbox(a) !== inInbox(b)) return inInbox(a) ? -1 : 1;
    const ka = key(a), kb = key(b);
    for (let i = 0; i < Math.min(ka.length, kb.length); i++)
      if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    return ka.length - kb.length;
  });
  return sorted.map((f) => {
    const parts = segs(f);
    let depth = 0;
    let cut = 0;                       // chars of the deepest listed ancestor
    for (let i = 1; i < parts.length; i++) {
      const prefix = parts.slice(0, i).join(f.delim!);
      if (names.has(prefix)) { depth++; cut = prefix.length + f.delim!.length; }
    }
    return { f, depth, label: f.name.slice(cut) };
  });
}

export function FolderSettings({ account, data, included, setIncluded,
  wildcards, setWildcards, reload }: {
  /** The account being edited (not necessarily the active one): every
   *  call below is pinned to it. */
  account: string;
  data: FoldersResp;
  included: Set<string>;
  setIncluded: (next: Set<string>) => void;
  wildcards: string[];
  setWildcards: (next: string[]) => void;
  /** Re-read the folder list (after a choice or a move). */
  reload: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const special: SpecialRole[] = data.special ?? data.folders
    .filter((x) => x.role)
    .map((x) => ({ role: x.role!, raw: x.raw, name: x.name,
      source: x.role_source ?? "name", ambiguous: !!x.ambiguous,
      choices: [] }));
  // All mail is a view of everything else (never scanned): listed with the
  // views below, not as a role row.
  const roles = ROLE_ORDER.filter((r) => r !== "all")
    .map((r) => special.find((s) => s.role === r))
    .filter((s): s is SpecialRole => !!s);
  const holders = new Set(special.filter((r) => UNSCANNED.has(r.role))
    .map((r) => r.raw));
  const views = data.folders.filter((x) => x.view
    || x.role === "all" || x.looks_like === "all");
  // Archive look-alikes are scanned and tickable in the list above (D11):
  // only the other roles list theirs under the role row.
  const lookalikes = (role: string) => role === "archive" ? []
    : data.folders.filter((x) => x.looks_like === role && !x.view);
  const hidden = (x: FolderInfo) => wildcards.some((w) => {
    const p = w.trim().toLowerCase().slice(0, -1);
    return x.raw.toLowerCase().startsWith(p)
      || x.name.toLowerCase().startsWith(p);
  });
  const scanned = nest(data.folders.filter((x) => !x.view
    && !holders.has(x.raw)
    && !(x.looks_like && UNSCANNED.has(x.looks_like)) && !hidden(x)));

  const fail = (e: unknown) =>
    toast.show(String((e as Error)?.message ?? e), { variant: "error" });

  const choose = async (r: SpecialRole, folder: string) => {
    setBusy(true);
    try {
      await api.setFolderRole(r.role, folder, account);
      toast.show(folder
        ? t("folder.choice_saved", { role: roleName(r.role),
          name: data.folders.find((x) => x.raw === folder)?.name ?? folder })
        : t("folder.choice_reset", { role: roleName(r.role) }),
      { variant: "success" });
      reload();
    } catch (e) { fail(e); }
    setBusy(false);
  };

  const moveContents = async (x: FolderInfo, role: string) => {
    setBusy(true);
    try {
      const c = await api.lookalike(x.raw, account);
      if (c.count === 0) {
        toast.show(t("folder.move_empty", { folder: x.name }));
        return;
      }
      if (!await confirmDialog({
        title: t("folder.move_title", { n: c.count, role: roleName(role) }),
        body: t("folder.move_body", { folder: x.name, target: c.target_name }),
        confirmLabel: t("folder.move_confirm", { n: c.count }),
        tone: "primary" })) return;
      const r = await api.moveLookalike(x.raw, c.uv, c.max_uid, account);
      const ident = r.undo;
      toast.show(t("folder.moved", { n: r.moved, role: roleName(role) }), {
        variant: "success",
        action: ident ? { label: t("Undo"), onClick: () => {
          api.undo(-1, ident, account).then((u) => {
            toast.show(t("folder.undone", { n: u.restored }),
              { variant: "success" });
            reload();
          }).catch(fail);
        } } : undefined });
      reload();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-card border border-line bg-panel2 p-3">
      <SectionLabel>{t("folders.scan")}</SectionLabel>
      <div className="mt-1 grid gap-0.5">
        {scanned.map(({ f: x, depth, label }) => (
          <span key={x.raw} className="min-w-0"
            style={{ paddingInlineStart: `${depth * 1.25}rem` }}>
            <Checkbox className="max-w-full"
              checked={included.has(x.raw)}
              onChange={() => {
                const next = new Set(included);
                next.has(x.raw) ? next.delete(x.raw) : next.add(x.raw);
                setIncluded(next);
              }}
              label={<span className="flex min-w-0 items-center gap-2"
                title={x.name}>
                <span className="truncate">{label}</span>
                {x.role === "archive" && <Tag>{roleName("archive")}</Tag>}
              </span>} />
          </span>
        ))}
        {scanned.length === 0 && (
          <span className="type-meta text-muted">{t("folders.none")}</span>
        )}
      </div>
      {wildcards.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5
          border-t border-line pt-2 type-meta text-muted">
          {t("Excluded by rule:")}
          {wildcards.map((w) => (
            <Tag key={w}>
              {w}{" "}
              <button className="inline-flex align-text-bottom
                  text-muted hover:text-body"
                title={t("Remove")} aria-label={t("Remove")}
                onClick={() => setWildcards(wildcards.filter((x) => x !== w))}>
                <X size={14} />
              </button>
            </Tag>
          ))}
        </div>
      )}

      {(roles.length > 0 || views.length > 0) && (
        <div className="mt-3 border-t border-line pt-3">
          <SectionLabel>{t("folders.special")}</SectionLabel>
          <p className="mt-0.5 type-meta text-muted">
            {t("folders.special_hint")}
          </p>
          <div className="mt-2 grid gap-2">
            {roles.map((r) => (
              <div key={r.role} data-role={r.role}
                className="rounded-control border border-line p-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="type-body font-medium">
                    {roleName(r.role)}
                  </span>
                  <span className="min-w-0 truncate type-body"
                    title={r.name}>{r.name}</span>
                  <Tag>{t(`folder.src.${r.source}`)}</Tag>
                </div>
                {r.role === "archive" && (
                  <p className="mt-1 type-meta text-muted">
                    {t("folder.archive_scanned")}
                  </p>
                )}
                {r.choices.length > 1 && (
                  <div className="mt-2 grid gap-1">
                    <p className="type-meta text-muted">
                      {r.ambiguous
                        ? t("folder.ambiguous", { role: roleName(r.role),
                          pick: r.name })
                        : t("folder.confirmed", { role: roleName(r.role) })}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={r.ambiguous ? "" : r.raw} disabled={busy}
                        aria-label={t("folder.choose_label",
                          { role: roleName(r.role) })}
                        // any pick is saved - also the folder Mailbroom
                        // already uses by default: that is how it is confirmed
                        onChange={(e) => e.target.value
                          && choose(r, e.target.value)}>
                        {r.ambiguous && (
                          <option value="" disabled>{t("folder.choose")}</option>
                        )}
                        {r.choices.map((c) => (
                          <option key={c.raw} value={c.raw}>
                            {c.name}{c.count != null
                              ? ` (${t("n.mails", { n: c.count })})` : ""}
                          </option>
                        ))}
                      </Select>
                      {r.source === "override" && (
                        <Button variant="secondary" size="sm" disabled={busy}
                          onClick={() => choose(r, "")}>
                          {t("folder.auto")}
                        </Button>
                      )}
                    </div>
                    <p className="type-meta text-muted">
                      {t("folder.choice_note")}
                    </p>
                  </div>
                )}
                {lookalikes(r.role).map((x) => (
                  <div key={x.raw} className="mt-2 flex flex-wrap
                    items-center gap-x-3 gap-y-1 border-t border-line pt-2">
                    <span className="min-w-0"
                      title={t("folder.lookalike_excluded")}>
                      <Checkbox className="max-w-full" checked={false}
                        disabled readOnly
                        label={<span className="truncate">{x.name}</span>} />
                    </span>
                    <Tag tone="review">{t("folder.lookalike_tag",
                      { role: roleName(r.role) })}</Tag>
                    {(
                      <Button variant="secondary" size="sm"
                        disabled={busy || r.ambiguous}
                        title={r.ambiguous ? t("folder.move_needs_choice",
                          { role: roleName(r.role) }) : undefined}
                        onClick={() => moveContents(x, r.role)}>
                        {t("folder.move_contents", { role: roleName(r.role) })}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ))}
            {views.length > 0 && (
              <div className="rounded-control border border-line p-2">
                <div className="type-meta text-muted">
                  {t("folder.view_row")}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {views.map((x) => (
                    <Tag key={x.raw}>{x.name}</Tag>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
