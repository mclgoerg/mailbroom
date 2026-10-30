/* Your year in mail: the pure helpers behind the summary image. The SVG is
 * built from the API response and the caller's already-translated strings,
 * drawn onto a canvas and saved as a PNG - all local, nothing is uploaded.
 * Sender names are masked unless `showNames` is set. */

import type { WrappedResp } from "./types";

/** `ann@shop.example` -> `a...@...example`: first letter and the last
 *  domain label are all that is left. */
export function maskAddr(addr: string): string {
  const at = addr.lastIndexOf("@");
  if (at < 1) return `${addr.slice(0, 1)}...`;
  const tld = addr.slice(at + 1).split(".").pop() ?? "";
  return `${addr[0]}...@...${tld}`;
}

export const SVG_W = 1080;
export const SVG_H = 1920;

export interface SummaryPalette {
  bg: string; panel: string; line: string; body: string; muted: string;
  accent: string;
}
export interface SummaryStrings {
  title: string;          // "Your year in mail 2026"
  lead: string;           // "You received"
  big: string;            // the formatted mail count (UI language)
  unit: string;           // "mails in 2026"
  note: string;           // "Based on the mail in your mailbox now"
  stats: { value: string; label: string }[];
  topTitle: string;       // "Loudest senders"
  topRows: string[];      // "12 mails" (aligned with top_senders)
  footer: string;         // "Made locally with Mailbroom"
}

// Control characters are not valid XML 1.0 (the image would fail to load).
// eslint-disable-next-line no-control-regex
const esc = (s: string): string => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
  .replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

/** Display name of a top-sender row in the image. */
export const senderName = (
  s: { label: string; addr: string }, showNames: boolean,
): string => (showNames ? s.label || s.addr : maskAddr(s.addr));

/** The summary card as a standalone SVG document (pure). */
export function buildSummarySvg(
  d: WrappedResp, str: SummaryStrings, pal: SummaryPalette, showNames: boolean,
): string {
  const text = (x: number, y: number, size: number, weight: number,
    fill: string, s: string, anchor = "start") =>
    `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" `
    + `fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
  const parts: string[] = [
    `<rect width="${SVG_W}" height="${SVG_H}" fill="${pal.bg}"/>`,
    text(90, 200, 44, 600, pal.accent, str.title),
    text(90, 330, 48, 500, pal.muted, str.lead),
    text(90, 500, 190, 700, pal.body, str.big),
    text(90, 580, 52, 500, pal.muted, str.unit),
  ];
  str.stats.slice(0, 6).forEach((s, i) => {
    const x = 90 + (i % 2) * 450;
    const y = 700 + Math.floor(i / 2) * 190;
    parts.push(
      `<rect x="${x}" y="${y}" width="420" height="160" rx="24" `
      + `fill="${pal.panel}" stroke="${pal.line}" stroke-width="2"/>`,
      text(x + 30, y + 78, 64, 700, pal.body, s.value),
      text(x + 30, y + 126, 32, 400, pal.muted, s.label));
  });
  const top = d.top_senders.slice(0, 5);
  if (top.length) {
    parts.push(text(90, 1340, 36, 600, pal.accent, str.topTitle));
    top.forEach((s, i) => {
      const y = 1410 + i * 80;
      parts.push(
        text(90, y, 42, 500, pal.body, `${i + 1}. ${senderName(s, showNames)}`),
        text(990, y, 38, 400, pal.muted, str.topRows[i] ?? "", "end"));
    });
  }
  parts.push(text(90, 1840, 30, 400, pal.muted, str.note));
  parts.push(text(990, 1840, 30, 600, pal.accent, str.footer, "end"));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" `
    + `height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" `
    + `font-family="${FONT}">${parts.join("")}</svg>`;
}

/** Rasterise an SVG document to a PNG blob (browser only). A data: URL
 *  keeps the canvas untainted in every browser. */
export function svgToPngBlob(svg: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = SVG_W;
      canvas.height = SVG_H;
      canvas.getContext("2d")!.drawImage(img, 0, 0, SVG_W, SVG_H);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png"))),
        "image/png");
    };
    img.onerror = () => reject(new Error("svg"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** The theme colours as the image palette (read from the CSS tokens). */
export function paletteFromTheme(): SummaryPalette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) =>
    css.getPropertyValue(`--color-${name}`).trim() || fb;
  return { bg: v("surface", "#171310"), panel: v("panel2", "#272017"),
    line: v("line", "#372c1e"), body: v("body", "#f0e8d8"),
    muted: v("muted", "#b5a68d"), accent: v("accenth", "#bd7609") };
}
