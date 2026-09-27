/* Minimal i18n: English keys (or notice.* template keys), per-locale
 * dictionaries in ./locales/, {param} interpolation, localStorage-
 * persisted. To contribute a language, see locales/de.ts. */

import { DE } from "./locales/de";
import { EN } from "./locales/en";

export type Lang = "en" | "de";

let lang: Lang =
  (typeof localStorage !== "undefined" &&
    (localStorage.getItem("pmc_lang") as Lang)) || "en";

export const getLang = (): Lang => lang;

export function setLang(next: Lang): void {
  lang = next;
  localStorage.setItem("pmc_lang", next);
}

export function t(key: string,
                  params?: Record<string, string | number>): string {
  let s = (lang === "de" ? DE[key] : undefined) ?? EN[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}
