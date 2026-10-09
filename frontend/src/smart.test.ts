// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { DE } from "./locales/de";
import { EN } from "./locales/en";
import { isPooled, smartLabel, smartView, smartWhy } from "./smart";
import type { Group, SmartKind } from "./types";

const row = (over: Partial<Group>): Group => ({
  key: "k", label: "English fallback", sub: "", count: 5, size: 1,
  unread: 0, first: "", last: "", tags: [], samples: [], bulk: false,
  unsub: false, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, new: false, pinned: 0, engagement: 0,
  ...over,
});

const KINDS: Exclude<SmartKind, "sender">[] = ["company", "protected",
  "replied", "accounts", "category", "newsletter", "notifications",
  "individuals", "other"];

afterEach(() => setLang("en"));

describe("Smart wording", () => {
  it("own rows pass through untouched", () => {
    const own = row({ kind: "sender", addr: "a@x.example", sub: "a@x.example" });
    expect(isPooled(own)).toBe(false);
    expect(smartView(own)).toBe(own);
    expect(smartWhy(own, 10)).toBe("");
    expect(smartView(row({}))).toEqual(row({}));          // other groupings
  });

  it("pooled rows get a translated label, an N-senders sub-line and a why", () => {
    const b = row({ kind: "newsletter", n_senders: 12 });
    setLang("en");
    expect(smartView(b)).toMatchObject({ label: "Newsletters",
      sub: "12 senders" });
    expect(smartWhy(b, 10)).toContain("fewer than 10 mails");
    setLang("de");
    expect(smartView(b)).toMatchObject({ label: "Newsletter",
      sub: "12 Absender" });
    expect(smartWhy(b, 10)).toContain("weniger als 10 Mails");
    expect(smartView(row({ kind: "other", n_senders: 1 })).sub)
      .toBe("1 Absender");
  });

  it("a company row is named by its domain, a category row by its name", () => {
    const c = row({ kind: "company", label: "paypal.de", domain: "paypal.de",
      n_senders: 3 });
    expect(smartLabel(c)).toBe("paypal.de");
    expect(smartWhy(c, 10)).toContain("paypal.de");
    const cat = row({ kind: "category", category: "shipping", label: "shipping" });
    expect(smartLabel(cat)).toBe("Category: shipping");
    setLang("de");
    expect(smartLabel(cat)).toBe("Kategorie: shipping");
  });

  it("every kind has its label and explanation in BOTH locales", () => {
    for (const kind of KINDS) {
      const why = `smart.why.${kind}`;
      expect(EN[why], why).toBeTruthy();
      expect(DE[why], why).toBeTruthy();
      expect(DE[why]).not.toBe(EN[why]);
      if (kind !== "company" && kind !== "category") {
        expect(EN[`smart.kind.${kind}`], kind).toBeTruthy();
        expect(DE[`smart.kind.${kind}`], kind).toBeTruthy();
      }
    }
    for (const k of ["smart.cat", "smart.title", "smart.min_label",
      "smart.min_help", "smart.protected_moved"]) {
      expect(EN[k], k).toBeTruthy();
      expect(DE[k], k).toBeTruthy();
    }
  });
});
