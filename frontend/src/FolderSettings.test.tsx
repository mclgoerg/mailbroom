// @vitest-environment jsdom
/* Settings > Folders: scan list vs special folders, translated roles,
 * nesting, confirming between tied candidates, and the one-time move of a
 * look-alike folder's mail (confirm dialog + toast with Undo). */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const setRole = vi.fn();
const lookalike = vi.fn();
const moveLookalike = vi.fn();
const undo = vi.fn();
vi.mock("./api", () => ({
  api: {
    setFolderRole: (...a: unknown[]) => setRole(...a),
    lookalike: (...a: unknown[]) => lookalike(...a),
    moveLookalike: (...a: unknown[]) => moveLookalike(...a),
    undo: (...a: unknown[]) => undo(...a),
  },
}));

import { FolderSettings } from "./components/FolderSettings";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog }
  from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { FolderInfo, FoldersResp, SpecialRole } from "./types";

const folder = (raw: string, over: Partial<FolderInfo> = {}): FolderInfo =>
  ({ raw, name: raw, role: null, excluded: false, delim: "/", ...over });
const special = (role: string, raw: string,
  over: Partial<SpecialRole> = {}): SpecialRole =>
  ({ role, raw, name: raw, source: "flag", ambiguous: false, choices: [],
    ...over });

const reload = vi.fn();
const mount = (data: FoldersResp, included = new Set<string>(["INBOX"])) =>
  render(<ToastProvider><DialogProvider>
    <FolderSettings data={data} included={included} setIncluded={() => {}}
      wildcards={[]} setWildcards={() => {}} reload={reload} />
  </DialogProvider></ToastProvider>);

beforeEach(() => { setLang("en"); });
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setLang("en");
});

const provider = (): FoldersResp => ({ wildcards: [], special: [
  special("trash", "Deleted Items"),
  special("junk", "Junk Email", { source: "name" }),
  special("sent", "Sent Items", { source: "override" }),
  special("archive", "Archive", { source: "name" })],
folders: [
  folder("INBOX"), folder("Projects"), folder("Projects/Alpha"),
  folder("Projects/Alpha/2026"), folder("Orphan/Child"),
  folder("Deleted Items", { role: "trash", excluded: true }),
  folder("Junk Email", { role: "junk", excluded: true }),
  folder("Sent Items", { role: "sent", excluded: true }),
  folder("Archive", { role: "archive" }),
  folder("[Gmail]/Starred", { view: true, excluded: true })] });

test("ordinary folders and special folders are two sections", () => {
  mount(provider());
  expect(screen.getByText("Folders to scan")).toBeTruthy();
  expect(screen.getByText("Special folders")).toBeTruthy();
  // special-role folders have no scan checkbox; ordinary ones do
  expect(screen.queryByLabelText("Deleted Items")).toBeNull();
  expect(screen.getByLabelText("Projects")).toBeTruthy();
  // Archive stays scannable (D11)
  expect(screen.getByLabelText(/Archive/)).toBeTruthy();
  // views are listed, never tickable
  expect(screen.getByText("[Gmail]/Starred")).toBeTruthy();
  expect(screen.queryByLabelText(/Starred/)).toBeNull();
});

test("each role row shows its translated name, folder and how it was found",
  () => {
    mount(provider());
    const trash = document.querySelector<HTMLElement>('[data-role="trash"]')!;
    expect(within(trash).getByText("Trash")).toBeTruthy();
    expect(within(trash).getByText("Deleted Items")).toBeTruthy();
    expect(within(trash).getByText("server flag")).toBeTruthy();
    const junk = document.querySelector<HTMLElement>('[data-role="junk"]')!;
    expect(within(junk).getByText("Junk")).toBeTruthy();
    expect(within(junk).getByText("by name")).toBeTruthy();
    const sent = document.querySelector<HTMLElement>('[data-role="sent"]')!;
    expect(within(sent).getByText("you chose")).toBeTruthy();
  });

test("role names and sources are translated (DE)", () => {
  setLang("de");
  mount(provider());
  const trash = document.querySelector<HTMLElement>('[data-role="trash"]')!;
  expect(within(trash).getByText("Papierkorb")).toBeTruthy();
  expect(within(trash).getByText("Server-Markierung")).toBeTruthy();
  const junk = document.querySelector<HTMLElement>('[data-role="junk"]')!;
  expect(within(junk).getByText("Spam")).toBeTruthy();
  expect(screen.getByText("Zu scannende Ordner")).toBeTruthy();
  expect(screen.getByText("Spezialordner")).toBeTruthy();
});

test("folders are nested by the LIST delimiter, decoded", () => {
  mount(provider());
  const pad = (label: string) => screen.getByLabelText(label)
    .closest<HTMLElement>("span[style]")!.style.paddingInlineStart;
  expect(pad("Projects")).toBe("0rem");
  expect(pad("Alpha")).toBe("1.25rem");          // only the part below Projects
  expect(pad("2026")).toBe("2.5rem");
  // a child whose parent is not listed keeps its full path, unindented
  expect(pad("Orphan/Child")).toBe("0rem");
  const order = screen.getAllByRole("checkbox")
    .map((c) => c.closest("label")!.textContent);
  expect(order.indexOf("Projects")).toBeLessThan(order.indexOf("Alpha"));
  expect(order.indexOf("Alpha")).toBeLessThan(order.indexOf("2026"));
});

test("ticking a scanned folder reports the change", () => {
  const setIncluded = vi.fn();
  render(<ToastProvider><DialogProvider>
    <FolderSettings data={provider()} included={new Set(["INBOX"])}
      setIncluded={setIncluded} wildcards={[]} setWildcards={() => {}}
      reload={reload} /></DialogProvider></ToastProvider>);
  fireEvent.click(screen.getByLabelText("Projects"));
  expect([...setIncluded.mock.calls[0][0]].sort())
    .toEqual(["INBOX", "Projects"]);
});

const ambiguous = (over: Partial<SpecialRole> = {}): FoldersResp => ({
  wildcards: [], special: [special("trash", "Deleted Items", {
    source: "name", ambiguous: true, choices: [
      { raw: "Deleted Items", name: "Deleted Items", count: 3 },
      { raw: "Trash", name: "Trash", count: 1 }], ...over })],
  folders: [folder("INBOX"),
    folder("Deleted Items", { role: "trash", ambiguous: true,
      excluded: true }),
    folder("Trash", { looks_like: "trash", ambiguous: true,
      excluded: true })] });

test("an ambiguous role shows the candidates with counts and a Select", () => {
  mount(ambiguous());
  expect(screen.getByText(/More than one folder could be your Trash folder/))
    .toBeTruthy();
  expect(screen.getByText(/refuses to delete permanently or empty it/))
    .toBeTruthy();
  const select = screen.getByLabelText("Which folder is your Trash folder?");
  expect((select as HTMLSelectElement).value).toBe("");     // unconfirmed
  const opts = within(select).getAllByRole("option").map((o) => o.textContent);
  expect(opts).toEqual(["Choose…", "Deleted Items (3 mails)",
    "Trash (1 mail)"]);
  expect(screen.getByText(/the one permanent actions will use/)).toBeTruthy();
});

test("choosing a candidate saves it and reloads the list", async () => {
  setRole.mockResolvedValue({ role: "trash", folder: "Trash",
    source: "override" });
  mount(ambiguous());
  fireEvent.change(screen.getByLabelText("Which folder is your Trash folder?"),
    { target: { value: "Trash" } });
  await waitFor(() => expect(setRole).toHaveBeenCalledWith("trash", "Trash"));
  await waitFor(() => expect(reload).toHaveBeenCalled());
  expect(await screen.findByText(/Trash folder set to/)).toBeTruthy();
});

test("a rejected choice is reported and nothing is reloaded", async () => {
  setRole.mockRejectedValue(new Error("That folder cannot be chosen"));
  mount(ambiguous());
  fireEvent.change(screen.getByLabelText("Which folder is your Trash folder?"),
    { target: { value: "Trash" } });
  expect(await screen.findByText("That folder cannot be chosen")).toBeTruthy();
  expect(reload).not.toHaveBeenCalled();
});

test("a confirmed role says permanent actions use it and can be reset",
  async () => {
    setRole.mockResolvedValue({});
    mount(ambiguous({ source: "override", ambiguous: false, raw: "Trash",
      name: "Trash" }));
    expect(screen.getByText(/Permanent actions on Trash \(such as Empty Trash\) use exactly this one/))
      .toBeTruthy();
    expect((screen.getByLabelText("Which folder is your Trash folder?") as
      HTMLSelectElement).value).toBe("Trash");
    fireEvent.click(screen.getByRole("button", { name: "Use automatic choice" }));
    await waitFor(() => expect(setRole).toHaveBeenCalledWith("trash", ""));
  });

const withLookalike = (over: Partial<SpecialRole> = {}): FoldersResp => ({
  wildcards: [], special: [special("trash", "Trash", over)],
  folders: [folder("INBOX"), folder("Trash", { role: "trash" }),
    folder("Deleted Items", { looks_like: "trash", excluded: true })] });

test("a look-alike is marked, unticked, locked, with a move action", () => {
  mount(withLookalike());
  const box = screen.getByLabelText("Deleted Items") as HTMLInputElement;
  expect(box.disabled).toBe(true);
  expect(box.checked).toBe(false);
  expect(screen.getByText("also looks like Trash")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Move contents to Trash" }))
    .toBeTruthy();
});

test("moving a look-alike: confirm with the count, then a toast with Undo",
  async () => {
    lookalike.mockResolvedValue({ role: "trash", target: "Trash",
      target_name: "Trash", count: 3, uv: 7, max_uid: 12 });
    moveLookalike.mockResolvedValue({ moved: 3, target: "Trash",
      role: "trash", undo: { ts: 5, label: "Deleted Items", count: 3 } });
    undo.mockResolvedValue({ restored: 3, of: 3, rescan: false });
    mount(withLookalike());
    fireEvent.click(screen.getByRole("button",
      { name: "Move contents to Trash" }));
    const dlg = await findDialog();
    expect(within(dlg).getByText("Move 3 mails to Trash?")).toBeTruthy();
    expect(within(dlg).getByText(/not deleted/)).toBeTruthy();
    // a reversible move: the confirm is not the red, destructive kind
    expect(within(dlg).getByRole("button", { name: "Move 3 mails" })
      .className).not.toMatch(/danger/);
    expect(moveLookalike).not.toHaveBeenCalled();
    await pressDialog("Move 3 mails");
    await waitFor(() => expect(moveLookalike)
      .toHaveBeenCalledWith("Deleted Items", 7, 12));   // exactly what was counted
    expect(await screen.findByText("Moved 3 mails to Trash.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(undo).toHaveBeenCalledWith(-1,
      { ts: 5, label: "Deleted Items", count: 3 }));    // that entry, by identity
  });

test("cancelling the confirm moves nothing", async () => {
  lookalike.mockResolvedValue({ role: "trash", target: "Trash",
    target_name: "Trash", count: 1, uv: 7, max_uid: 2 });
  mount(withLookalike());
  fireEvent.click(screen.getByRole("button",
    { name: "Move contents to Trash" }));
  await findDialog();
  expect(screen.getByText("Move 1 mail to Trash?")).toBeTruthy();   // _one
  await cancelDialog();
  await expectNoDialog();
  expect(moveLookalike).not.toHaveBeenCalled();
});

test("an empty look-alike says so instead of confirming", async () => {
  lookalike.mockResolvedValue({ role: "trash", target: "Trash",
    target_name: "Trash", count: 0, uv: 7, max_uid: 0 });
  mount(withLookalike());
  fireEvent.click(screen.getByRole("button",
    { name: "Move contents to Trash" }));
  expect(await screen.findByText(/is empty - nothing to move/)).toBeTruthy();
  await expectNoDialog();
});

test("the move is not offered while the role is ambiguous and unconfirmed",
  () => {
    mount(withLookalike({ ambiguous: true, choices: [
      { raw: "Trash", name: "Trash", count: 1 },
      { raw: "Bin", name: "Bin", count: 1 }] }));
    const btn = screen.getByRole("button", { name: "Move contents to Trash" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute("title")).toMatch(/Choose the Trash folder/);
  });

test("a server refusal is shown", async () => {
  lookalike.mockRejectedValue(new Error("Choose the right folder first"));
  mount(withLookalike());
  fireEvent.click(screen.getByRole("button",
    { name: "Move contents to Trash" }));
  expect(await screen.findByText("Choose the right folder first")).toBeTruthy();
});

test("German: tag and action use the translated role name", () => {
  setLang("de");
  mount(withLookalike());
  expect(screen.getByText("sieht auch aus wie „Papierkorb“")).toBeTruthy();
  expect(screen.getByRole("button",
    { name: "Inhalt nach „Papierkorb“ verschieben" })).toBeTruthy();
});
