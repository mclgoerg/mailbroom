// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { setLang, t } from "./i18n";
import { DE } from "./locales/de";
import { EN } from "./locales/en";
import { filedKindName, FILE_KINDS, isPooled, purposeSummary, smartContent,
  smartLabel, smartReason, smartView, smartWhy } from "./smart";
import type { Group, SmartKind } from "./types";

const row = (over: Partial<Group>): Group => ({
  key: "k", label: "English fallback", sub: "", count: 5, size: 1,
  unread: 0, first: "", last: "", tags: [], samples: [], bulk: false,
  unsub: false, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, new: false, pinned: 0, engagement: 0,
  ...over,
});

const KINDS: Exclude<SmartKind, "sender">[] = ["company", "protected",
  "replied", "orders", "appointments", "jobs", "support", "accounts",
  "category", "newsletter", "individuals", "other"];

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
    const c = row({ kind: "company", label: "payco.example", domain: "payco.example",
      n_senders: 3 });
    expect(smartLabel(c)).toBe("payco.example");
    expect(smartWhy(c, 10)).toContain("payco.example");
    const cat = row({ kind: "category", category: "shipping", label: "shipping" });
    expect(smartLabel(cat)).toBe("Category: shipping");
    setLang("de");
    expect(smartLabel(cat)).toBe("Kategorie: shipping");
  });

  it("the retired Notifications kind has no wording left", () => {
    for (const key of ["smart.kind.notifications", "smart.why.notifications"]) {
      expect(EN[key], key).toBeUndefined();
      expect(DE[key], key).toBeUndefined();
    }
  });

  it("the new kinds are worded in English and German", () => {
    const want = {
      orders: ["Orders & deliveries", "Bestellungen & Lieferungen"],
      appointments: ["Appointments & bookings", "Termine & Buchungen"],
      jobs: ["Job applications", "Bewerbungen"],
      support: ["Support & inquiries", "Support & Anfragen"],
    } as const;
    for (const [kind, [en, de]] of Object.entries(want)) {
      const r = row({ kind: kind as SmartKind, n_senders: 4 });
      setLang("en");
      expect(smartView(r).label).toBe(en);
      expect(smartWhy(r, 10)).toContain("fewer than 10 mails");
      setLang("de");
      expect(smartView(r).label).toBe(de);
      expect(smartWhy(r, 10)).toContain("weniger als 10 Mails");
    }
  });

  it("a company row says what its mails are about, biggest first", () => {
    const c = row({ kind: "company", label: "acme.example", n_senders: 4,
      purposes: { orders: 6, accounts: 3, newsletter: 2, unclassified: 1 } });
    setLang("en");
    expect(purposeSummary(c)).toBe(
      "Orders 6 \u00b7 Accounts 3 \u00b7 Newsletters 2 \u00b7 Unclassified 1");
    expect(purposeSummary(c, 2)).toBe("Orders 6 \u00b7 Accounts 3");
    expect(smartView(c).sub).toBe("4 senders \u00b7 Orders 6 \u00b7 Accounts 3");
    expect(smartContent(c)).toBe(
      "What the mails are about: Orders 6 \u00b7 Accounts 3 \u00b7 "
      + "Newsletters 2 \u00b7 Unclassified 1");
    setLang("de");
    expect(smartView(c).sub).toBe(
      "4 Absender \u00b7 Bestellungen 6 \u00b7 Konten 3");
    expect(smartContent(c)).toContain("Worum es in den Mails geht: Bestellungen 6");
    // rows without a summary keep the plain sub-line
    expect(smartView(row({ kind: "company", n_senders: 2 })).sub).toBe("2 Absender");
    expect(smartContent(row({ kind: "newsletter" }))).toBe("");
  });

  it("every purpose of a summary is worded in BOTH locales", () => {
    for (const k of ["orders", "appointments", "jobs", "support", "accounts",
      "newsletter", "unclassified"]) {
      expect(EN[`smart.purpose.${k}`], k).toBeTruthy();
      expect(DE[`smart.purpose.${k}`], k).toBeTruthy();
    }
    expect(EN["smart.purposes"]).toContain("{list}");
    expect(DE["smart.purposes"]).toContain("{list}");
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


describe("what the user filed", () => {
  it("words a filing and a kept AI answer in both languages", () => {
    const rule = { r: "rule", k: "orders", by: "a" as const };
    const company = { r: "rule", k: "support", by: "co" as const, co: "x.example" };
    const kept = { r: "kept_ai", k: "jobs", by: "a" as const };
    const cat = { r: "rule", k: "category", name: "hobby", by: "a" as const };
    setLang("en");
    expect(smartReason(rule)).toBe("You filed this sender under Orders & deliveries.");
    expect(smartReason(company)).toBe("You filed its company under Support & inquiries.");
    expect(smartReason(kept)).toBe("Filed under Job applications by a kept AI answer.");
    expect(smartReason(cat)).toBe("You filed this sender under Category “hobby”.");
    setLang("de");
    expect(smartReason(rule)).toBe(
      `Du hast diesen Absender unter ${t("smart.kind.orders")} einsortiert.`);
    expect(smartReason(kept)).toContain("behaltene KI-Antwort");
    expect(smartReason(cat)).toContain("Kategorie „hobby“");
  });

  it("names every kind a sender can be filed under, in both languages", () => {
    expect(FILE_KINDS).toHaveLength(8);
    for (const lang of ["en", "de"] as const) {
      setLang(lang);
      const names = FILE_KINDS.map(filedKindName);
      expect(new Set(names).size).toBe(8);
      for (const k of FILE_KINDS) {
        expect(filedKindName(k), k).not.toBe(`smart.kind.${k}`);
      }
      expect(filedKindName("cat:hobby")).toContain("hobby");
    }
  });
});
