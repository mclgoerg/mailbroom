// @vitest-environment jsdom
/* Settings > Senders: "What Mailbroom knows about your senders" - a
 * searchable, sortable list with inline edit, delete (one / several, with
 * Undo), Remove unused (only with every account scanned), keep / forget of
 * AI answers and download / upload of just this knowledge. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const knowledge = vi.fn();
const knowledgePut = vi.fn();
const knowledgeKeepAi = vi.fn();
const knowledgeForgetAi = vi.fn();
const knowledgeRemoveUnused = vi.fn();
const knowledgeImport = vi.fn();
const saveBlob = vi.fn();
vi.mock("./api", () => ({
  api: {
    knowledge: (...a: unknown[]) => knowledge(...a),
    knowledgePut: (...a: unknown[]) => knowledgePut(...a),
    knowledgeKeepAi: (...a: unknown[]) => knowledgeKeepAi(...a),
    knowledgeForgetAi: (...a: unknown[]) => knowledgeForgetAi(...a),
    knowledgeRemoveUnused: (...a: unknown[]) => knowledgeRemoveUnused(...a),
    knowledgeImport: (...a: unknown[]) => knowledgeImport(...a),
  },
  saveBlob: (...a: unknown[]) => saveBlob(...a),
}));

import { filterEntries, KnowledgeSettings, sortEntries, statusText } from
  "./components/KnowledgeSettings";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from
  "./dialogTestUtils";
import { setLang } from "./i18n";
import type { KnowledgeEntry, KnowledgeList } from "./types";

const entry = (over: Partial<KnowledgeEntry>): KnowledgeEntry => ({
  key: "a:amy@solo.example", kind: "orders", src: "user", ts: 100, note: "",
  status: "active", reason: "", senders: 1, rows: ["k:orders"], ...over });
const ENTRIES: KnowledgeEntry[] = [
  entry({ key: "a:amy@solo.example", kind: "orders", ts: 300, note: "my plumber" }),
  entry({ key: "co:acme.example", kind: "support", ts: 200, senders: 3,
    status: "no_effect", reason: "company_row" }),
  entry({ key: "a:bob@solo.example", kind: "jobs", src: "ai", ts: 100 }),
  entry({ key: "a:ghost@nowhere.example", kind: "other", ts: 50, senders: 0,
    status: "unused" }),
  entry({ key: "a:cat@solo.example", kind: "cat:hobby", ts: 40, senders: 1,
    status: "inactive", reason: "inactive_category" }),
];
const list = (over: Partial<KnowledgeList> = {}) => knowledge.mockResolvedValue({
  entries: ENTRIES, complete: true, unscanned: [], categories: ["hobby"],
  max: 5000, ai_running: false, ...over });

const onChanged = vi.fn();
const mount = (aiAnswers = 2) => render(
  <ToastProvider><DialogProvider>
    <KnowledgeSettings aiAnswers={aiAnswers} onChanged={onChanged} />
  </DialogProvider></ToastProvider>);
const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
const names = () => [...document.querySelectorAll("tbody tr")]
  .map((r) => r.querySelector("td:nth-child(2) .truncate")?.textContent);

beforeEach(() => {
  setLang("en");
  for (const f of [knowledge, knowledgePut, knowledgeKeepAi, knowledgeForgetAi,
    knowledgeRemoveUnused, knowledgeImport, saveBlob, onChanged]) f.mockReset();
  list();
  knowledgePut.mockResolvedValue({ ok: true, saved: 1, removed: 0, previous: {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLang("en"); });

describe("the list", () => {
  it("shows every entry: who, filed under, source, senders, status", async () => {
    mount();
    await screen.findByText("amy@solo.example");
    expect(screen.getByText("What Mailbroom knows about your senders")).toBeTruthy();
    const amy = within(rowOf("amy@solo.example"));
    expect(amy.getByText("Orders & deliveries")).toBeTruthy();
    expect(amy.getByText("Filed by you")).toBeTruthy();
    expect(amy.getByText("In effect")).toBeTruthy();
    expect(amy.getByText("my plumber")).toBeTruthy();
    const acme = within(rowOf("acme.example"));
    expect(acme.getByText("Support & inquiries")).toBeTruthy();
    expect(acme.getByText("3")).toBeTruthy();
    expect(acme.getByText("No effect: its company has a row of its own."))
      .toBeTruthy();
    expect(within(rowOf("bob@solo.example")).getByText("Kept AI answer"))
      .toBeTruthy();
    expect(within(rowOf("ghost@nowhere.example")).getByText(
      "No sender in your mailboxes matches")).toBeTruthy();
    expect(within(rowOf("cat@solo.example")).getByText(
      "Inactive: its category no longer exists.")).toBeTruthy();
    expect(within(rowOf("cat@solo.example")).getByText("Category “hobby”"))
      .toBeTruthy();
  });

  it("is searchable by address, kind, note and source", async () => {
    mount();
    await screen.findByText("amy@solo.example");
    const search = screen.getByPlaceholderText("Search filed senders…");
    fireEvent.change(search, { target: { value: "plumber" } });
    expect(names()).toEqual(["amy@solo.example"]);
    fireEvent.change(search, { target: { value: "kept ai" } });
    expect(names()).toEqual(["bob@solo.example"]);
    fireEvent.change(search, { target: { value: "company" } });
    expect(names()).toEqual(["acme.example"]);
    fireEvent.change(search, { target: { value: "job" } });
    expect(names()).toEqual(["bob@solo.example"]);
    fireEvent.change(search, { target: { value: "nobody here" } });
    expect(screen.getByText("No entries match.")).toBeTruthy();
  });

  it("sorts by a column, and again for the other direction", async () => {
    mount();
    await screen.findByText("amy@solo.example");
    expect(names()).toEqual(["acme.example", "amy@solo.example",
      "bob@solo.example", "cat@solo.example", "ghost@nowhere.example"]);
    const head = (name: string) => screen.getByRole("button", { name });
    fireEvent.click(head("Senders"));                       // most first
    expect(names()[0]).toBe("acme.example");
    expect(names().at(-1)).toBe("ghost@nowhere.example");
    fireEvent.click(head("Senders"));                       // fewest first
    expect(names()[0]).toBe("ghost@nowhere.example");
    fireEvent.click(head("Status"));            // what needs a look comes first
    expect(names().slice(0, 3)).toEqual(["cat@solo.example",
      "ghost@nowhere.example", "acme.example"]);
    fireEvent.click(head("Filed under"));           // by the kind's name: A-Z
    expect(names()).toEqual(["cat@solo.example", "bob@solo.example",
      "amy@solo.example", "ghost@nowhere.example", "acme.example"]);
  });

  it("the sort helpers are pure and stable on ties", () => {
    const a = entry({ key: "a:b@x.example", senders: 1 });
    const b = entry({ key: "a:a@x.example", senders: 1 });
    expect(sortEntries([a, b], "senders", 1).map((e) => e.key))
      .toEqual(["a:a@x.example", "a:b@x.example"]);
    expect(filterEntries([a, b], "").length).toBe(2);
    expect(statusText(entry({ status: "unknown" })))
      .toBe("Not every mailbox is scanned yet");
  });

  it("an empty list says what this is and that it stays on this server", async () => {
    list({ entries: [] });
    mount();
    expect(await screen.findByText("Nothing filed yet")).toBeTruthy();
    expect(screen.getByText(/It stays on this server\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download" })).toHaveProperty(
      "disabled", true);
  });

  it("an unreachable server is said in words", async () => {
    knowledge.mockRejectedValue(new Error("offline"));
    mount();
    expect(await screen.findByText("Could not load the filed senders: offline"))
      .toBeTruthy();
  });

  it("pages a long list", async () => {
    list({ entries: Array.from({ length: 120 }, (_, i) => entry({
      key: `a:s${String(i).padStart(3, "0")}@x.example`, ts: i })) });
    mount();
    await screen.findByText("s000@x.example");
    expect(names().length).toBe(50);
    fireEvent.click(screen.getByRole("button", { name: "Show more (70 left)" }));
    expect(names().length).toBe(100);
  });
});

describe("changing entries", () => {
  it("edits inline: another kind is a filing of its own, saved with the note",
    async () => {
      mount();
      await screen.findByText("amy@solo.example");
      fireEvent.click(within(rowOf("amy@solo.example")).getByRole("button",
        { name: "Edit" }));
      const kind = screen.getByLabelText("Filed under") as HTMLSelectElement;
      expect([...kind.options].map((o) => o.textContent)).toContain("Category “hobby”");
      fireEvent.change(kind, { target: { value: "cat:hobby" } });
      fireEvent.change(screen.getByLabelText("Note"),
        { target: { value: "new note" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(knowledgePut).toHaveBeenCalledWith({ entries: [
        { key: "a:amy@solo.example", kind: "cat:hobby", note: "new note" }] }));
      expect(await screen.findByText("Saved.")).toBeTruthy();
      expect(onChanged).toHaveBeenCalled();
    });

  it("editing only the note keeps a kept AI answer a kept AI answer", async () => {
    mount();
    await screen.findByText("bob@solo.example");
    fireEvent.click(within(rowOf("bob@solo.example")).getByRole("button",
      { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(knowledgePut).toHaveBeenCalledWith({ entries: [
      { key: "a:bob@solo.example", kind: "jobs", note: "n", src: "ai" }] }));
  });

  it("cancels an edit without saving", async () => {
    mount();
    await screen.findByText("amy@solo.example");
    fireEvent.click(within(rowOf("amy@solo.example")).getByRole("button",
      { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(knowledgePut).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Note")).toBeNull();
  });

  it("deletes one entry with an Undo that restores it", async () => {
    const before = { kind: "orders", src: "user", ts: 300, note: "my plumber" };
    knowledgePut.mockResolvedValueOnce({ ok: true, saved: 0, removed: 1,
      previous: { "a:amy@solo.example": before } });
    mount();
    await screen.findByText("amy@solo.example");
    fireEvent.click(within(rowOf("amy@solo.example")).getByRole("button",
      { name: "Delete" }));
    await waitFor(() => expect(knowledgePut).toHaveBeenCalledWith(
      { remove: ["a:amy@solo.example"] }));
    expect(await screen.findByText("Entry removed.")).toBeTruthy();
    knowledgePut.mockResolvedValueOnce({ ok: true, saved: 1, removed: 0,
      previous: {} });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(knowledgePut).toHaveBeenLastCalledWith({
      entries: [{ key: "a:amy@solo.example", ...before }], remove: undefined }));
    expect(await screen.findByText("Filing undone.")).toBeTruthy();
  });

  it("deletes several at once after a confirmation, as one request", async () => {
    knowledgePut.mockResolvedValue({ ok: true, saved: 0, removed: 2,
      previous: { "a:amy@solo.example": null, "co:acme.example": null } });
    mount();
    await screen.findByText("amy@solo.example");
    fireEvent.click(screen.getByLabelText("Select amy@solo.example"));
    fireEvent.click(screen.getByLabelText("Select acme.example"));
    expect(screen.getByText("2 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete selected (2)" }));
    const dlg = await findDialog();
    expect(within(dlg).getByText("Delete 2 entries?")).toBeTruthy();
    await pressDialog("Delete 2 entries");
    await waitFor(() => expect(knowledgePut).toHaveBeenCalledTimes(1));
    expect(new Set((knowledgePut.mock.calls[0][0] as any).remove)).toEqual(
      new Set(["a:amy@solo.example", "co:acme.example"]));
    expect(await screen.findByText("2 entries removed.")).toBeTruthy();
  });

  it("a declined bulk delete deletes nothing", async () => {
    mount();
    await screen.findByText("amy@solo.example");
    fireEvent.click(screen.getByLabelText("Select amy@solo.example"));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected (1)" }));
    await findDialog();
    await cancelDialog();
    await expectNoDialog();
    expect(knowledgePut).not.toHaveBeenCalled();
  });

  it("select all shown ticks every visible row", async () => {
    mount();
    await screen.findByText("amy@solo.example");
    fireEvent.click(screen.getByLabelText("Select all shown"));
    expect(screen.getByText("5 selected")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Select all shown"));
    expect(screen.queryByText(/selected$/)).toBeNull();
  });

  it("a refused change shows the reason in words and reloads", async () => {
    knowledgePut.mockRejectedValue(new Error("That kind is not available (a "
      + "category may be gone)."));
    mount();
    await screen.findByText("amy@solo.example");
    fireEvent.click(within(rowOf("amy@solo.example")).getByRole("button",
      { name: "Delete" }));
    expect(await screen.findByText(/That kind is not available/)).toBeTruthy();
    expect(knowledge).toHaveBeenCalledTimes(2);
  });
});

describe("selection and undo", () => {
  it("a bulk action only reaches what the search shows", async () => {
    knowledgePut.mockResolvedValue({ ok: true, saved: 0, removed: 1,
      previous: { "a:amy@solo.example": null } });
    mount();
    await screen.findByText("amy@solo.example");
    fireEvent.click(screen.getByLabelText("Select amy@solo.example"));
    fireEvent.click(screen.getByLabelText("Select acme.example"));
    fireEvent.change(screen.getByPlaceholderText("Search filed senders…"),
      { target: { value: "plumber" } });                 // only amy is shown
    expect(screen.getByText("1 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete selected (1)" }));
    await pressDialog("Delete 1 entry");
    await waitFor(() => expect(knowledgePut).toHaveBeenCalledTimes(1));
    expect(knowledgePut).toHaveBeenCalledWith({ remove: ["a:amy@solo.example"] });
  });

  it("Undo after an inline edit puts the old kind and note back", async () => {
    const before = { kind: "orders", src: "user", ts: 300, note: "my plumber" };
    knowledgePut.mockResolvedValueOnce({ ok: true, saved: 1, removed: 0,
      previous: { "a:amy@solo.example": before } });
    mount();
    await screen.findByText("amy@solo.example");
    fireEvent.click(within(rowOf("amy@solo.example")).getByRole("button",
      { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Filed under"),
      { target: { value: "jobs" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    knowledgePut.mockResolvedValueOnce({ ok: true, saved: 1, removed: 0, previous: {} });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(knowledgePut).toHaveBeenLastCalledWith({
      entries: [{ key: "a:amy@solo.example", ...before }], remove: undefined }));
  });

  it("a bulk Undo restores every deleted entry in one request", async () => {
    const a = { kind: "orders", src: "user", ts: 300, note: "my plumber" };
    const b = { kind: "support", src: "user", ts: 200, note: "" };
    knowledgePut.mockResolvedValueOnce({ ok: true, saved: 0, removed: 2,
      previous: { "a:amy@solo.example": a, "co:acme.example": b } });
    mount();
    await screen.findByText("amy@solo.example");
    fireEvent.click(screen.getByLabelText("Select amy@solo.example"));
    fireEvent.click(screen.getByLabelText("Select acme.example"));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected (2)" }));
    await pressDialog("Delete 2 entries");
    await screen.findByText("2 entries removed.");
    knowledgePut.mockResolvedValueOnce({ ok: true, saved: 2, removed: 0, previous: {} });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(knowledgePut).toHaveBeenCalledTimes(2));
    expect(knowledgePut.mock.calls[1][0]).toEqual({ remove: undefined, entries: [
      { key: "a:amy@solo.example", ...a }, { key: "co:acme.example", ...b }] });
  });

  it("sorts newest first by the time, and the phone's select starts there", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: /max-width/.test(q), media: q,
      addEventListener: () => {}, removeEventListener: () => {} }));
    mount();
    await screen.findByText("amy@solo.example");
    const order = () => [...document.querySelectorAll("[aria-label^='Select ']")]
      .map((el) => (el as HTMLElement).getAttribute("aria-label")!.slice(7));
    fireEvent.change(screen.getByRole("combobox", { name: "Sort entries" }),
      { target: { value: "ts" } });
    expect(order()).toEqual(["amy@solo.example", "acme.example",
      "bob@solo.example", "ghost@nowhere.example", "cat@solo.example"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort entries" }),
      { target: { value: "senders" } });
    expect(order()[0]).toBe("acme.example");               // most senders first
  });
});

describe("the confirmations say what they do", () => {
  it("Remove unused and Forget say they cannot be undone; Keep says whose "
    + "answers", async () => {
    mount(2);
    await screen.findByText("amy@solo.example");
    fireEvent.click(screen.getByRole("button", { name: "Remove unused (1)" }));
    let dlg = await findDialog();
    expect(within(dlg).getByText(/This cannot be undone\./)).toBeTruthy();
    await cancelDialog();
    fireEvent.click(screen.getByRole("button", { name: "Forget kept AI answers (1)" }));
    dlg = await findDialog();
    expect(within(dlg).getByText(/gone for good/)).toBeTruthy();
    await cancelDialog();
    fireEvent.click(screen.getByRole("button", { name: "Keep all AI answers" }));
    dlg = await findDialog();
    expect(within(dlg).getByText(/the account you are looking at/)).toBeTruthy();
    await cancelDialog();
  });

  it("an upload says that the rest of a full backup is ignored; an entries "
    + "list that is not an object is no knowledge", async () => {
    mount();
    await screen.findByText("amy@solo.example");
    const input = screen.getByLabelText("Upload…") as HTMLInputElement;
    const send = (content: string) => {
      Object.defineProperty(input, "files", { configurable: true,
        value: [new File([content], "k.json", { type: "application/json" })] });
      fireEvent.change(input);
    };
    send(JSON.stringify({ entries: ["a:x@y.example"] }));
    expect(await screen.findByText("That file has no filed senders.")).toBeTruthy();
    send(JSON.stringify({ entries: { "a:x@y.example": { kind: "jobs" } } }));
    const dlg = await findDialog();
    expect(within(dlg).getByText(/Anything else in a full backup is ignored here/))
      .toBeTruthy();
    await cancelDialog();
  });

  it("the download button says the file lists addresses", async () => {
    mount();
    await screen.findByText("amy@solo.example");
    expect(screen.getByRole("button", { name: "Download" }).getAttribute("title"))
      .toBe("Download this list as a file. It lists sender addresses and notes "
        + "- keep it private.");
  });
});

describe("Remove unused", () => {
  it("is disabled, with the reason, while an account is unscanned", async () => {
    list({ complete: false, unscanned: ["second", "third"] });
    mount();
    await screen.findByText("amy@solo.example");
    const btn = screen.getByRole("button", { name: /Remove unused/ });
    expect(btn).toHaveProperty("disabled", true);
    expect(screen.getByText("Scan every account first (2 not scanned yet): "
      + "until then an entry cannot be called unused.")).toBeTruthy();
    expect(knowledgeRemoveUnused).not.toHaveBeenCalled();
  });

  it("removes exactly the unused ones after a confirmation", async () => {
    knowledgeRemoveUnused.mockResolvedValue({ ok: true, removed: 1 });
    mount();
    await screen.findByText("amy@solo.example");
    fireEvent.click(screen.getByRole("button", { name: "Remove unused (1)" }));
    const dlg = await findDialog();
    expect(within(dlg).getByText("Remove 1 unused entry?")).toBeTruthy();
    await pressDialog("Remove 1 entry");
    await waitFor(() => expect(knowledgeRemoveUnused).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Removed 1 unused entry.")).toBeTruthy();
  });

  it("is disabled when nothing is unused", async () => {
    list({ entries: ENTRIES.filter((e) => e.status !== "unused") });
    mount();
    await screen.findByText("amy@solo.example");
    expect(screen.getByRole("button", { name: "Remove unused (0)" }))
      .toHaveProperty("disabled", true);
  });
});

describe("AI answers", () => {
  it("keeps all of them after a confirmation with the count", async () => {
    knowledgeKeepAi.mockResolvedValue({ ok: true, kept: 2, senders: 3, skipped: 0 });
    mount(3);
    await screen.findByText("amy@solo.example");
    fireEvent.click(screen.getByRole("button", { name: "Keep all AI answers" }));
    const dlg = await findDialog();
    expect(within(dlg).getByText("Keep the AI’s answers for 3 senders?")).toBeTruthy();
    await pressDialog("Keep for 3 senders");
    await waitFor(() => expect(knowledgeKeepAi).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Kept the AI’s answers for 3 senders.")).toBeTruthy();
  });

  it("has nothing to keep without AI answers, and a declined confirm keeps nothing",
    async () => {
      mount(0);
      await screen.findByText("amy@solo.example");
      expect(screen.getByRole("button", { name: "Keep all AI answers" }))
        .toHaveProperty("disabled", true);
      cleanup();
      mount(2);
      await screen.findByText("amy@solo.example");
      fireEvent.click(screen.getByRole("button", { name: "Keep all AI answers" }));
      await findDialog();
      await cancelDialog();
      await expectNoDialog();
      expect(knowledgeKeepAi).not.toHaveBeenCalled();
    });

  it("forgets the kept answers (not the user's own) after a confirmation",
    async () => {
      knowledgeForgetAi.mockResolvedValue({ ok: true, forgotten: 1 });
      mount();
      await screen.findByText("amy@solo.example");
      fireEvent.click(screen.getByRole("button",
        { name: "Forget kept AI answers (1)" }));
      const dlg = await findDialog();
      expect(within(dlg).getByText("Forget the kept AI answer for 1 sender?")).toBeTruthy();
      expect(within(dlg).getByText("What you filed yourself stays.")).toBeTruthy();
      await pressDialog("Forget for 1 sender");
      await waitFor(() => expect(knowledgeForgetAi).toHaveBeenCalledTimes(1));
      expect(await screen.findByText("Forgot the kept AI answer for 1 sender.")).toBeTruthy();
    });

  it("counts the kept answers in senders - and, for answers no sender uses, "
    + "says so", async () => {
    list({ entries: [
      entry({ key: "co:acme.example", kind: "support", src: "ai", senders: 3 }),
      entry({ key: "a:amy@solo.example", kind: "jobs", src: "ai", senders: 1 }),
      entry({ key: "a:ghost@nowhere.example", kind: "jobs", src: "ai",
        senders: 0, status: "unused" })] });
    knowledgeForgetAi.mockResolvedValue({ ok: true, forgotten: 3 });
    mount();
    fireEvent.click(await screen.findByRole("button",
      { name: "Forget kept AI answers (4)" }));     // 3 + 1 + 0 senders
    const dlg = await findDialog();
    expect(within(dlg).getByText("Forget the kept AI answers for 4 senders?"))
      .toBeTruthy();
    await cancelDialog();
    cleanup();
    list({ entries: [entry({ key: "a:ghost@nowhere.example", kind: "jobs",
      src: "ai", senders: 0, status: "unused" })] });
    mount();
    fireEvent.click(await screen.findByRole("button",
      { name: "Forget kept AI answers (1)" }));
    expect(within(await findDialog()).getByText(
      "Forget 1 kept AI answer that no sender uses any more?")).toBeTruthy();
    await cancelDialog();
  });

  it("a refusal while an AI run is going is shown in words", async () => {
    knowledgeKeepAi.mockRejectedValue(new Error(
      "An AI run is going - try again when it is done."));
    mount();
    await screen.findByText("amy@solo.example");
    fireEvent.click(screen.getByRole("button", { name: "Keep all AI answers" }));
    await findDialog();
    await pressDialog("Keep for 2 senders");
    expect(await screen.findByText(/An AI run is going/)).toBeTruthy();
  });
});

describe("download and upload of just this knowledge", () => {
  it("downloads the entries in the shape the import reads", async () => {
    mount();
    await screen.findByText("amy@solo.example");
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(saveBlob).toHaveBeenCalledTimes(1);
    const [name, blob] = saveBlob.mock.calls[0] as [string, Blob];
    expect(name).toBe("mailbroom-sender-knowledge.json");
    const section = JSON.parse(await blob.text());
    expect(section.version).toBe(1);
    expect(Object.keys(section.entries)).toHaveLength(5);
    expect(section.entries["a:amy@solo.example"]).toEqual({
      kind: "orders", src: "user", ts: 300, note: "my plumber" });
    expect(JSON.stringify(section)).not.toMatch(/status|reason|senders|rows/);
  });

  const upload = (content: string) => {
    const input = screen.getByLabelText("Upload…") as HTMLInputElement;
    const file = new File([content], "k.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);
  };

  it("merges an uploaded file after saying what will happen", async () => {
    knowledgeImport.mockResolvedValue({ ok: true, knowledge: 2 });
    mount();
    await screen.findByText("amy@solo.example");
    const section = { version: 1, entries: {
      "a:x@y.example": { kind: "jobs" }, "co:z.example": { kind: "orders" } } };
    upload(JSON.stringify(section));
    const dlg = await findDialog();
    expect(within(dlg).getByText("The file holds 2 entries.")).toBeTruthy();
    await pressDialog("Merge");
    await waitFor(() => expect(knowledgeImport).toHaveBeenCalledWith(section));
    expect(await screen.findByText("Merged: 2 entries added or updated."))
      .toBeTruthy();
  });

  it("takes the knowledge section out of a full backup too", async () => {
    knowledgeImport.mockResolvedValue({ ok: true, knowledge: 1 });
    mount();
    await screen.findByText("amy@solo.example");
    const section = { version: 1, entries: { "a:x@y.example": { kind: "jobs" } } };
    upload(JSON.stringify({ config: {}, knowledge: section }));
    await findDialog();
    await pressDialog("Merge");
    await waitFor(() => expect(knowledgeImport).toHaveBeenCalledWith(section));
  });

  it("refuses a file without filed senders, and a declined merge merges nothing",
    async () => {
      mount();
      await screen.findByText("amy@solo.example");
      upload("not json");
      expect(await screen.findByText("That file has no filed senders.")).toBeTruthy();
      upload(JSON.stringify({ entries: {} }));
      await waitFor(() => expect(screen.getAllByText(
        "That file has no filed senders.").length).toBeGreaterThan(0));
      upload(JSON.stringify({ entries: { "a:x@y.example": { kind: "jobs" } } }));
      await findDialog();
      await cancelDialog();
      await expectNoDialog();
      expect(knowledgeImport).not.toHaveBeenCalled();
    });
});

describe("phone and German", () => {
  it("renders cards on a phone, with the same actions", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: /max-width/.test(q), media: q,
      addEventListener: () => {}, removeEventListener: () => {} }));
    mount();
    await screen.findByText("amy@solo.example");
    expect(document.querySelector("table")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Sort entries" })).toBeTruthy();
    expect(screen.getAllByText(/1 sender · In effect/).length).toBe(2);
    expect(screen.getByText("my plumber")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect(screen.getByLabelText("Note")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByLabelText("Select amy@solo.example"));
    expect(screen.getByRole("button", { name: "Delete selected (1)" })).toBeTruthy();
  });

  it("is German in the German UI", async () => {
    setLang("de");
    mount();
    expect(await screen.findByText("Was Mailbroom über deine Absender weiß"))
      .toBeTruthy();
    expect(screen.getByRole("button", { name: "Unbenutzte entfernen (1)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Alle KI-Antworten behalten" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Herunterladen" })).toBeTruthy();
    expect(screen.getByText("Behaltene KI-Antwort")).toBeTruthy();
    expect(screen.getByText("Ohne Wirkung: seine Firma hat eine eigene Zeile."))
      .toBeTruthy();
  });
});
