// @vitest-environment jsdom
/* The backend answers refusals with stable codes (`code` or
 * `code:key=value,...`, values percent-encoded); api.ts words them in the
 * user's language and keeps the raw text for anything it does not know. */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, errorText, noticeParams, parseErrorDetail, undoLabel } from "./api";
import { getLang, setLang } from "./i18n";
import { DE } from "./locales/de";
import { EN } from "./locales/en";

const enc = encodeURIComponent;

beforeEach(() => setLang("en"));
afterEach(() => { setLang("en"); vi.unstubAllGlobals(); });

describe("parseErrorDetail", () => {
  test("a bare code and a code with params", () => {
    expect(parseErrorDetail("busy_purge")).toEqual({ code: "busy_purge",
      params: {} });
    expect(parseErrorDetail("folder_changed:role=trash")).toEqual({
      code: "folder_changed", params: { role: "trash" } });
  });

  test("counts (n) become numbers, other values stay text", () => {
    expect(parseErrorDetail("deleted_then_failed:n=500,cause=cannot_flag"))
      .toEqual({ code: "deleted_then_failed",
        params: { n: 500, cause: "cannot_flag" } });
    expect(parseErrorDetail("cannot_open:folder=2024")!.params.folder)
      .toBe("2024");
  });

  test("values are decoded, so any character survives", () => {
    const name = "Rechnungen, 2024 = a:b 100% Entwürfe";
    expect(parseErrorDetail(`cannot_open:folder=${enc(name)}`)!.params.folder)
      .toBe(name);
  });

  test("anything else is not ours: null, so the raw text is shown", () => {
    for (const raw of ["", "RuntimeError: busy: scan running",
      "something else entirely", "constructor", "__proto__:x=1",
      "SELECT command error: BAD", "Error: cannot_open",
      "cannot_open:folder", "cannot_open:=x", "cannot_open:folder=%E0%A4%A",
      "cannot_open:a=1,,b=2"]) {
      expect(parseErrorDetail(raw), raw).toBeNull();
    }
    expect(parseErrorDetail(undefined as unknown as string)).toBeNull();
    expect(parseErrorDetail([{ msg: "x" }] as unknown as string)).toBeNull();
  });
});

describe("errorText", () => {
  test("a code is worded in English and German", () => {
    expect(errorText("busy_purge")).toBe(EN["ferr.busy_purge"]);
    setLang("de");
    expect(getLang()).toBe("de");
    expect(errorText("busy_purge")).toBe(DE["ferr.busy_purge"]);
    expect(errorText("busy_purge")).toContain("endgültiges Löschen");
  });

  test("a role param is named in the interface language", () => {
    expect(errorText("role_unconfirmed:role=trash")).toBe(
      "More than one folder could be “Trash” - choose the right one in "
      + "Settings first.");
    expect(errorText("folder_changed:role=junk")).toBe(
      "The “Junk” folder changed on the server - reload the list and try "
      + "again.");
    setLang("de");
    expect(errorText("role_unconfirmed:role=trash")).toBe(
      "Für „Papierkorb“ kommen mehrere Ordner infrage – wähle zuerst in den "
      + "Einstellungen den richtigen.");
    expect(errorText("folder_changed:role=junk")).toBe(
      "Der Ordner „Spam“ hat sich auf dem Server geändert – lade die Liste "
      + "neu und versuche es erneut.");
    expect(errorText("cannot_open:role=trash")).toBe(
      "Der Ordner „Papierkorb“ konnte auf dem Server nicht geöffnet werden.");
    expect(errorText("uv_unreadable:role=trash")).toBe(
      "Der Zustand des Ordners „Papierkorb“ konnte nicht gelesen werden – es "
      + "wird nichts gelöscht.");
    expect(errorText("role_missing:role=junk"))
      .toBe("Auf dem Server wurde kein Ordner für „Spam“ gefunden.");
    expect(errorText("role_missing:role=archive"))
      .toBe("Auf dem Server wurde kein Ordner für „Archiv“ gefunden.");
  });

  test("a folder that changed under the scan says rescan, not reload", () => {
    // the main cleanup delete works on the scan's UIDs: reloading a list
    // does not help there (backend: folder_changed_rescan)
    expect(errorText("folder_changed_rescan:folder=INBOX")).toBe(
      "The “INBOX” folder changed on the server - rescan and try again.");
    expect(errorText("folder_changed_rescan:folder=INBOX"))
      .not.toContain("reload");
    setLang("de");
    expect(errorText("folder_changed_rescan:folder=INBOX")).toBe(
      "Der Ordner „INBOX“ hat sich auf dem Server geändert – scanne neu und "
      + "versuche es erneut.");
    expect(errorText("folder_changed:folder=INBOX")).toContain("Liste neu");
  });

  test("a folder name is quoted the way its language quotes", () => {
    const d = `unknown_target:folder=${enc("Projekte, neu")}`;
    expect(errorText(d))
      .toBe("The target folder “Projekte, neu” does not exist.");
    setLang("de");
    expect(errorText(d))
      .toBe("Der Zielordner „Projekte, neu“ existiert nicht.");
  });

  test("a count takes the singular form when it is 1", () => {
    expect(errorText("moved_then_failed:n=2,cause=cannot_move")).toBe(
      "The server refused the move. (2 mails were moved before the failure)");
    expect(errorText("moved_then_failed:n=1,cause=cannot_move")).toBe(
      "The server refused the move. (1 mail was moved before the failure)");
    setLang("de");
    expect(errorText("moved_then_failed:n=2,cause=cannot_move")).toBe(
      "Der Server hat das Verschieben abgelehnt. (2 Mails wurden vor dem "
      + "Fehler verschoben)");
    expect(errorText("moved_then_failed:n=1,cause=cannot_move")).toBe(
      "Der Server hat das Verschieben abgelehnt. (1 Mail wurde vor dem "
      + "Fehler verschoben)");
  });

  test("a nested cause is worded too, a raw cause stays as it is", () => {
    const inner = "stranded_then_failed:n=3,cause=cannot_expunge";
    const outer = `deleted_then_failed:n=5,cause=${enc(inner)}`;
    expect(errorText(outer)).toBe(
      "The server did not remove the marked mails. (3 mails were moved to "
      + "Trash and not deleted) (5 mails were permanently deleted before "
      + "the failure)");
    setLang("de");
    expect(errorText(outer)).toBe(
      "Der Server hat die markierten Mails nicht entfernt. (3 Mails wurden "
      + "in den Papierkorb verschoben und nicht gelöscht) (5 Mails wurden "
      + "vor dem Fehler endgültig gelöscht)");
    expect(errorText(`deleted_then_failed:n=2,cause=${enc("socket timeout")}`))
      .toBe("socket timeout (2 Mails wurden vor dem Fehler endgültig "
        + "gelöscht)");
  });

  test("unknown codes and plain server text fall back to the raw text", () => {
    for (const raw of ["a_future_code", "a_future_code:n=2",
      "RuntimeError: scan did not finish", "busy: scan running",
      "cannot_open:folder", "unknown rule"]) {
      expect(errorText(raw), raw).toBe(raw);
    }
    setLang("de");
    expect(errorText("a_future_code:n=2")).toBe("a_future_code:n=2");
  });

  test("purge-rule refusals name the qualifiers", () => {
    const d = `rule_purge_filter:names=${enc("tag:, ai:")}`;
    expect(errorText(d)).toBe(
      "This filter is not available for Junk and Trash rules: tag:, ai:");
    expect(errorText(`rule_purge_filter_domain:names=${enc("domain:")}`))
      .toContain("use plain text such as the domain name");
    setLang("de");
    expect(errorText(d)).toBe("Dieser Filter ist für Spam- und "
      + "Papierkorb-Regeln nicht verfügbar: tag:, ai:");
  });
});

describe("the request layer", () => {
  const fail = (status: number, body: string) =>
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status, text: () => Promise.resolve(body) }));

  test("a coded detail becomes the translated message, code kept", async () => {
    fail(409, JSON.stringify({ detail: "folder_changed:role=trash" }));
    const e: any = await api.emptyTrash({ uv: 1, max_uid: 5 }).catch((x) => x);
    expect(e.message)
      .toBe("The “Trash” folder changed on the server - reload the list and "
        + "try again.");
    expect(e.code).toBe("folder_changed");
    setLang("de");
    fail(409, JSON.stringify({ detail: "folder_changed:role=trash" }));
    const d: any = await api.emptyTrash({ uv: 1, max_uid: 5 }).catch((x) => x);
    expect(d.message).toBe("Der Ordner „Papierkorb“ hat sich auf dem Server "
      + "geändert – lade die Liste neu und versuche es erneut.");
    expect(d.code).toBe("folder_changed");
  });

  test("the existing codes keep working (and keep their code)", async () => {
    fail(400, JSON.stringify({ detail: "protected_mails" }));
    const e: any = await api.emptyTrash({ uv: 1, max_uid: 5 }).catch((x) => x);
    expect(e.code).toBe("protected_mails");
    expect(e.message).toBe(EN["fp.protected_refused"]);
  });

  test("raw details, plain text and empty bodies are shown as they are",
    async () => {
      fail(409, JSON.stringify({ detail: "RuntimeError: scan did not finish" }));
      expect(((await api.emptyTrash({ uv: 1, max_uid: 5 }).catch((x) => x)) as Error).message)
        .toBe("RuntimeError: scan did not finish");
      fail(500, "Internal Server Error");
      const e: any = await api.emptyTrash({ uv: 1, max_uid: 5 }).catch((x) => x);
      expect(e.message).toBe("Internal Server Error");
      expect(e.code).toBeUndefined();
      fail(502, "");
      expect(((await api.emptyTrash({ uv: 1, max_uid: 5 }).catch((x) => x)) as Error).message)
        .toBe("HTTP 502");
      fail(422, JSON.stringify({ detail: [{ msg: "bad" }] }));
      expect(await api.emptyTrash({ uv: 1, max_uid: 5 }).catch((x) => x)).toBeInstanceOf(Error);
    });
});

describe("undo labels and notices", () => {
  const entry = { label: "2 mails from Junk", label_key: "undo.from_junk",
    label_params: { n: 2 } };

  test("a structured label is worded in the user's language", () => {
    expect(undoLabel(entry)).toBe("2 mails from Junk");
    expect(undoLabel({ ...entry, label: "1 mail from Junk",
      label_params: { n: 1 } })).toBe("1 mail from Junk");
    setLang("de");
    expect(undoLabel(entry)).toBe("2 Mails aus Spam");
    expect(undoLabel({ ...entry, label: "1 mail from Junk",
      label_params: { n: 1 } })).toBe("1 Mail aus Spam");
    expect(undoLabel({ label: "x", label_key: "undo.from_trash",
      label_params: { n: 3 } })).toBe("3 Mails aus dem Papierkorb");
  });

  test("an entry without a label key shows its label as it is", () => {
    setLang("de");
    expect(undoLabel({ label: "Shop News" })).toBe("Shop News");
    expect(undoLabel({ label: "Deleted Items" })).toBe("Deleted Items");
  });

  test("a restore notice words its label from the label_* params", () => {
    const params = { restored: 2, of: 2, label: "2 mails from Junk",
      label_key: "undo.from_junk", label_n: 2 };
    setLang("de");
    expect(noticeParams(params).label).toBe("2 Mails aus Spam");
    expect(noticeParams({ restored: 1, of: 1, label: "Shop News" }).label)
      .toBe("Shop News");
  });
});

describe("EN / DE parity of the new texts", () => {
  const mine = (d: Record<string, string>) =>
    Object.keys(d).filter((k) => /^(ferr|undo\.from)\./.test(k)).sort();
  const ph = (s: string) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort();

  test("the same keys, including every _one form, in both languages", () => {
    expect(mine(DE)).toEqual(mine(EN));
    expect(mine(EN).length).toBeGreaterThanOrEqual(40);
  });

  test("the same placeholders in both languages", () => {
    for (const k of mine(EN)) expect(ph(DE[k]), k).toEqual(ph(EN[k]));
  });

  test("a text with a count has its singular form", () => {
    for (const k of mine(EN)) {
      if (k.endsWith("_one") || !/\{n\}/.test(EN[k])) continue;
      expect(EN[`${k}_one`], k).toBeTruthy();
      expect(DE[`${k}_one`], k).toBeTruthy();
      expect(EN[`${k}_one`], k).not.toContain("{n}");
    }
  });

  test("a German text names a role / folder only inside quotes, so it reads " +
    "for Papierkorb, Spam and Archiv alike", () => {
    const withName = mine(DE).filter((k) => DE[k].includes("{folder}"));
    expect(withName.length).toBeGreaterThanOrEqual(7);
    for (const k of withName) {
      // „{folder}“ (never a bare name that would need an article / case) ...
      expect(DE[k].replaceAll("„{folder}“", ""), k).not.toContain("{folder}");
      // ... and no hyphen compound or preposition glued to it
      expect(DE[k], k).not.toMatch(/\{folder\}-|[a-zäöü]\{folder\}/);
    }
    setLang("de");
    for (const role of ["trash", "junk", "archive"])
      for (const k of withName) {
        const text = errorText(`${k.slice(5)}:role=${role}`);
        expect(text, k).not.toContain("{");
        expect(text, k).toMatch(/„(Papierkorb|Spam|Archiv)“/);
      }
  });

  test("no German text is left in English, and 'pinned' is not used", () => {
    for (const k of mine(EN)) {
      expect(DE[k], k).not.toBe(EN[k]);
      expect(EN[k].toLowerCase(), k).not.toContain("pinned");
    }
  });
});
