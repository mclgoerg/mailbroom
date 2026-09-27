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
});
