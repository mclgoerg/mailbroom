// @vitest-environment jsdom
/* The error lines of the Folders panel and of Settings > Folders show the
 * server's refusals in the interface language (real api layer, stubbed
 * fetch - the backend answers with codes, see mailops.coded). */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { FolderSettings } from "./components/FolderSettings";
import { FoldersPanel } from "./components/FoldersPanel";
import { DialogProvider, ToastProvider } from "./components/ui";
import { pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { AppState, FoldersResp } from "./types";

afterEach(() => {
  cleanup();
  setLang("en");
  vi.unstubAllGlobals();
});

const answers = (routes: Record<string, [number, unknown]>) =>
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    const [status, body] = hit ? hit[1] : [404, { detail: "not found" }];
    return Promise.resolve({ ok: status < 400, status,
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body) });
  }));

const panelState = { folders: ["INBOX"], folders_raw: ["INBOX"] } as unknown as AppState;
const panel = () => render(<ToastProvider><DialogProvider>
  <FoldersPanel state={panelState} initialRole="junk" onClose={() => {}}
    onChanged={() => {}} onEmptyTrash={async () => true}
    onUndo={() => {}} onProtect={async () => true} />
</DialogProvider></ToastProvider>);

test("the Folders panel's listing error reads in English", async () => {
  answers({ "/api/folders_panel": [409, { detail: "role_missing:role=junk" }] });
  panel();
  expect(await screen.findByText("No “Junk” folder found on the server."))
    .toBeTruthy();
});

test("... and in German, with a role that is ambiguous", async () => {
  setLang("de");
  answers({ "/api/folders_panel": [409, {
    detail: "role_unconfirmed:role=trash" }] });
  panel();
  expect(await screen.findByText("Für „Papierkorb“ kommen mehrere Ordner "
    + "infrage – wähle zuerst in den Einstellungen den richtigen.")).toBeTruthy();
});

const folder = (raw: string, over = {}) =>
  ({ raw, name: raw, role: null, excluded: false, delim: "/", ...over });
const data = (): FoldersResp => ({ wildcards: [], special: [
  { role: "trash", raw: "Trash", name: "Trash", source: "flag",
    ambiguous: false, choices: [] }],
folders: [folder("INBOX"), folder("Trash", { role: "trash" }),
  folder("Deleted Items", { looks_like: "trash", excluded: true })] });

const settings = () => render(<ToastProvider><DialogProvider>
  <FolderSettings account="default" data={data()} included={new Set(["INBOX"])}
    setIncluded={() => {}} wildcards={[]} setWildcards={() => {}}
    reload={() => {}} />
</DialogProvider></ToastProvider>);

test("a refused look-alike move reads in the interface language, with its " +
  "numbers", async () => {
  setLang("de");
  answers({
    "/api/folders/lookalike": [200, { role: "trash", target: "Trash",
      target_name: "Trash", count: 3, uv: 7, max_uid: 12 }],
    "/api/folders/move_contents": [409, { detail:
      "moved_then_failed:n=1,cause=cannot_move" }] });
  settings();
  fireEvent.click(screen.getByRole("button",
    { name: "Inhalt nach „Papierkorb“ verschieben" }));
  await pressDialog(/verschieben/);
  await waitFor(() => expect(document.body.textContent).toContain(
    "Der Server hat das Verschieben abgelehnt. (1 Mail wurde vor dem Fehler "
    + "verschoben)"));
});

test("a refused role choice reads in English", async () => {
  answers({ "/api/folders/lookalike": [409, { detail: "role_ambiguous" }] });
  settings();
  fireEvent.click(screen.getByRole("button",
    { name: "Move contents to Trash" }));
  expect(await screen.findByText(
    "Choose the right folder for this role first, then try again."))
    .toBeTruthy();
});
