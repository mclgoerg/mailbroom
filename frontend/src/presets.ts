import { t } from "./i18n";
import type { Preset, Security, SmtpSecurity } from "./types";

/* Provider presets only PREFILL the connection fields - everything stays
 * editable. "custom" prefills nothing. Hosts per provider docs; all of
 * these use app passwords except Proton (Bridge password). */
export const PRESETS: Record<Exclude<Preset, "custom">, {
  host: string; port: number; security: Security;
  smtpHost: string; smtpPort: number; smtpSecurity: SmtpSecurity;
  cafile: string; hint: string;
}> = {
  proton: { host: "127.0.0.1", port: 1143, security: "ssl",
    smtpHost: "", smtpPort: 1025, smtpSecurity: "auto",
    cafile: "/certs/bridge-cert.pem", hint: "preset.hint.proton" },
  gmail: { host: "imap.gmail.com", port: 993, security: "ssl",
    smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecurity: "ssl",
    cafile: "", hint: "preset.hint.gmail" },
  outlook: { host: "outlook.office365.com", port: 993, security: "ssl",
    smtpHost: "smtp.office365.com", smtpPort: 587, smtpSecurity: "starttls",
    // Unused: presetHint below computes this dynamically (depends on
    // whether the server has a shared Microsoft app configured).
    cafile: "", hint: "" },
  icloud: { host: "imap.mail.me.com", port: 993, security: "ssl",
    smtpHost: "smtp.mail.me.com", smtpPort: 587, smtpSecurity: "starttls",
    cafile: "", hint: "preset.hint.apppw" },
  fastmail: { host: "imap.fastmail.com", port: 993, security: "ssl",
    smtpHost: "smtp.fastmail.com", smtpPort: 465, smtpSecurity: "ssl",
    cafile: "", hint: "preset.hint.apppw" },
  gmx: { host: "imap.gmx.net", port: 993, security: "ssl",
    smtpHost: "mail.gmx.net", smtpPort: 465, smtpSecurity: "ssl",
    cafile: "", hint: "preset.hint.imap_toggle" },
  mailbox: { host: "imap.mailbox.org", port: 993, security: "ssl",
    smtpHost: "smtp.mailbox.org", smtpPort: 465, smtpSecurity: "ssl",
    cafile: "", hint: "" },
  yahoo: { host: "imap.mail.yahoo.com", port: 993, security: "ssl",
    smtpHost: "smtp.mail.yahoo.com", smtpPort: 465, smtpSecurity: "ssl",
    cafile: "", hint: "preset.hint.apppw" },
};

/** The label of a provider (brand names stay as they are). */
export const presetLabel = (p: Preset): string =>
  p === "custom" ? t("preset.custom") : PRESET_LABELS[p];

export const PRESET_LABELS: Record<Preset, string> = {
  proton: "Proton Mail Bridge", gmail: "Gmail",
  outlook: "Outlook / Microsoft 365", icloud: "iCloud Mail",
  fastmail: "Fastmail", gmx: "GMX", mailbox: "mailbox.org",
  yahoo: "Yahoo Mail", custom: "Custom (any IMAP server)",
};
