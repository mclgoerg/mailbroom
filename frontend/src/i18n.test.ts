// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { getLang, setLang, t } from "./i18n";

describe("i18n", () => {
  it("falls back to the key in English", () => {
    setLang("en");
    expect(t("Scan")).toBe("Scan");
    expect(t("totally unknown key")).toBe("totally unknown key");
  });

  it("interpolates params", () => {
    setLang("en");
    expect(t("page.of", { p: 2, n: 8 })).toBe("Page 2 / 8");
    expect(t("notice.cached_verdicts", { n: 5 }))
      .toContain("5 cached AI verdicts");
  });

  it("translates to German and persists the choice", () => {
    setLang("de");
    expect(getLang()).toBe("de");
    expect(t("Scan")).toBe("Scannen");
    expect(t("page.of", { p: 1, n: 3 })).toBe("Seite 1 / 3");
    expect(t("unknown stays english")).toBe("unknown stays english");
    expect(localStorage.getItem("pmc_lang")).toBe("de");
    setLang("en");
  });

  it("picks the _one form when n (or count) is exactly 1", () => {
    setLang("en");
    expect(t("toast.moved_trash", { n: 1 })).toBe("Moved 1 mail to Trash");
    expect(t("toast.moved_trash", { n: 2 })).toBe("Moved 2 mails to Trash");
    expect(t("toast.moved_trash", { n: 0 })).toBe("Moved 0 mails to Trash");
    expect(t("notice.emptied_trash", { count: 1 })).toContain("1 mail ");
    setLang("de");
    expect(t("toast.moved_trash", { n: 1 }))
      .toBe("1 Mail in den Papierkorb verschoben");
    expect(t("toast.moved_trash", { n: 3 }))
      .toBe("3 Mails in den Papierkorb verschoben");
    setLang("en");
  });

  it("never mixes languages: a German key without _one stays German", () => {
    setLang("de");
    expect(t("toast.unsub_skipped", { n: 1 })).toBe(
      "(1 bereits erledigt, geschützt oder über dem Limit pro Lauf.)");
    setLang("en");
  });
});
