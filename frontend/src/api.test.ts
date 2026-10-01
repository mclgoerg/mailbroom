// @vitest-environment jsdom
/* Account scoping: every API path is tagged with the active account. */

import { afterEach, expect, test, vi } from "vitest";
import { api, downloadFile, setAccount, withAccount } from "./api";

test("withAccount appends the active account to every path", () => {
  setAccount("");
  expect(withAccount("/api/state")).toBe("/api/state");
  setAccount("work mail");
  expect(withAccount("/api/state")).toBe("/api/state?account=work%20mail");
  expect(withAccount("/api/group?grouping=sender&key=x"))
    .toBe("/api/group?grouping=sender&key=x&account=work%20mail");
  setAccount("");   // don't leak into other tests
});

test("exportUrl appends repeated keys params only when keys are given",
  () => {
  expect(api.exportUrl("sender")).toBe("/api/export?grouping=sender");
  expect(api.exportUrl("sender", [])).toBe("/api/export?grouping=sender");
  expect(api.exportUrl("sender", ["a@x.example", "b c@x.example"])).toBe(
    "/api/export?grouping=sender&keys=a%40x.example"
    + "&keys=b%20c%40x.example");
});

// iOS Safari in standalone/PWA mode mishandles a plain <a> navigation to a
// Content-Disposition: attachment response (stuck Quick Look, or a blank
// tab) - fetching the bytes ourselves and handing the browser a blob: URL
// is what actually triggers a save/share sheet everywhere.
afterEach(() => vi.restoreAllMocks());

test("downloadFile fetches the URL and saves it via a blob: link, named " +
  "from Content-Disposition", async () => {
  const blob = new Blob(["a,b\n1,2\n"], { type: "text/csv" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, blob: () => Promise.resolve(blob),
    headers: new Headers({
      "Content-Disposition": 'attachment; filename="mail-groups-sender.csv"' }),
  }));
  const blobUrl = "blob:mock-url";
  vi.spyOn(URL, "createObjectURL").mockReturnValue(blobUrl);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const clicked: string[] = [];
  const realCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement")
    .mockImplementation((tag: string): HTMLElement => {
      const el = realCreateElement(tag);
      if (el instanceof HTMLAnchorElement) {
        el.addEventListener("click", () => clicked.push(el.href));
      }
      return el;
    });

  await downloadFile("/api/export?grouping=sender");

  expect(fetch).toHaveBeenCalledWith("/api/export?grouping=sender");
  expect(clicked).toEqual([blobUrl]);
});

test("downloadFile raises on a non-OK response instead of saving nothing " +
  "silently", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false, status: 404, text: () => Promise.resolve("not found") }));
  await expect(downloadFile("/api/export?grouping=sender"))
    .rejects.toThrow("not found");
});
