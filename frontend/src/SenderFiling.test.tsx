// @vitest-environment jsdom
/* "How Mailbroom files this sender": where the sender sits and why, the kind
 * select (Automatic / every kind / own categories), who filed it, Reset, and
 * why a filing has no effect when it has none. */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const knowledge = vi.fn();
vi.mock("./api", () => ({ api: { knowledge: () => knowledge() } }));

import { SenderFiling } from "./components/SenderFiling";
import { setLang } from "./i18n";
import type { Group, KnowledgeEntry, SmartWhy } from "./types";

const sender = (over: Partial<Group> = {}): Group => ({
  key: "a@solo.example", label: "a", sub: "", count: 3, size: 3000, unread: 1,
  first: "2024-01-01", last: "2024-06-01", tags: [], samples: [], bulk: false,
  unsub: false, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, new: false, pinned: 0, engagement: 50,
  smart_key: "k:other", smart_why: { r: "none" }, ...over,
});
const entry = (over: Partial<KnowledgeEntry>): KnowledgeEntry => ({
  key: "a:a@solo.example", kind: "orders", src: "user", ts: 1, note: "",
  status: "active", reason: "", senders: 1, filed: 1, rows: ["k:orders"], ...over,
});
const list = (entries: KnowledgeEntry[]) => knowledge.mockResolvedValue({
  entries, complete: true, unscanned: [], categories: [], max: 5000,
  ai_running: false });

const onFile = vi.fn();
const onReset = vi.fn();
const mount = (s: Group, over: { categories?: string[]; rev?: number } = {}) =>
  render(<SenderFiling sender={s} rowLabel="Other senders"
    categories={over.categories ?? []} rev={over.rev ?? 1}
    onFile={onFile} onReset={onReset} />);
const select = () => screen.getByRole("combobox",
  { name: "File this sender under" }) as HTMLSelectElement;

beforeEach(() => {
  setLang("en");
  knowledge.mockReset();
  onFile.mockReset().mockResolvedValue(true);
  onReset.mockReset().mockResolvedValue(true);
  list([]);
});
afterEach(cleanup);

describe("the box", () => {
  it("says where the sender sits, with Automatic selected and nothing to reset",
    async () => {
      mount(sender());
      expect(screen.getByText("How Mailbroom files this sender")).toBeTruthy();
      expect(screen.getByText("Now in “Other senders”. Nothing in its mails "
        + "says what it is about.")).toBeTruthy();
      await waitFor(() => expect(knowledge).toHaveBeenCalledTimes(1));
      expect(select().value).toBe("auto");
      expect(screen.queryByRole("button", { name: /Reset/ })).toBeNull();
      expect(screen.queryByText("Filed by you")).toBeNull();
    });

  it("offers Automatic, every kind and the user's categories", () => {
    mount(sender(), { categories: ["hobby"] });
    expect([...select().options].map((o) => o.textContent)).toEqual([
      "Automatic", "Orders & deliveries", "Appointments & bookings",
      "Job applications", "Support & inquiries", "Accounts & security",
      "Newsletters", "Individuals", "Other senders", "Category “hobby”"]);
  });

  it("files THIS sender (its own entry) when a kind is chosen", async () => {
    mount(sender());
    fireEvent.change(select(), { target: { value: "support" } });
    await waitFor(() => expect(onFile).toHaveBeenCalledWith(
      [{ key: "a:a@solo.example", kind: "support" }], 1));
  });

  it("shows the user's own filing, who made it, and resets it", async () => {
    list([entry({})]);
    mount(sender({ smart_key: "k:orders", smart_why:
      { r: "rule", k: "orders", by: "a", entry: "a:a@solo.example" } }));
    await screen.findByText("Filed by you");
    expect(select().value).toBe("orders");
    fireEvent.click(screen.getByRole("button", { name: "Reset to automatic" }));
    await waitFor(() => expect(onReset).toHaveBeenCalledWith(["a:a@solo.example"]));
  });

  it("Automatic removes the own entry, and does nothing without one",
    async () => {
      list([entry({})]);
      mount(sender());
      await screen.findByText("Filed by you");
      fireEvent.change(select(), { target: { value: "auto" } });
      await waitFor(() => expect(onReset).toHaveBeenCalledWith(["a:a@solo.example"]));
      cleanup();
      onReset.mockClear();
      list([]);
      mount(sender());
      await waitFor(() => expect(knowledge).toHaveBeenCalled());
      fireEvent.change(select(), { target: { value: "auto" } });
      expect(onReset).not.toHaveBeenCalled();
    });

  it("a kept AI answer is a badge, not a selection - and can be reset", async () => {
    list([entry({ src: "ai", kind: "jobs" })]);
    mount(sender({ smart_key: "k:jobs", smart_why:
      { r: "kept_ai", k: "jobs", by: "a", entry: "a:a@solo.example" } }));
    await screen.findByText("Kept AI answer");
    expect(select().value).toBe("auto");
    expect(screen.queryByText("Filed by you")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset to automatic" }));
    await waitFor(() => expect(onReset).toHaveBeenCalledWith(["a:a@solo.example"]));
  });

  it("when its company's rule decides, says so and resets that rule", async () => {
    list([entry({ key: "co:solo.example", kind: "support" })]);
    mount(sender({ smart_key: "k:support", smart_why:
      { r: "rule", k: "support", by: "co", co: "solo.example",
        entry: "co:solo.example" } }));
    await screen.findByText("Filed by you");
    expect(screen.getByText(/You filed its company under Support & inquiries\. Your rule for its company decides\./))
      .toBeTruthy();
    expect(select().value).toBe("auto");
    fireEvent.click(screen.getByRole("button",
      { name: "Reset its company to automatic" }));
    await waitFor(() => expect(onReset).toHaveBeenCalledWith(["co:solo.example"]));
  });

  it.each([
    ["own_row", "Your filing has no effect right now: this sender has enough "
      + "mails for its own row."],
    ["protected", "Your filing has no effect right now: this sender is protected."],
    ["inactive_category", "Your filing has no effect right now: its category "
      + "no longer exists."],
  ])("explains why a filing has no effect (%s)", async (reason, text) => {
    list([entry({ status: reason === "inactive_category" ? "inactive"
      : "no_effect", reason })]);
    mount(sender({ smart_key: "s:a@solo.example", smart_why: { r: "own" } }));
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it("explains a kept answer that does not apply, in its own words", async () => {
    list([entry({ src: "ai", status: "no_effect", reason: "rules_confident" })]);
    mount(sender({ smart_why: { r: "purpose", k: "orders", n: 3, of: 3 } as SmartWhy }));
    expect(await screen.findByText("The kept AI answer has no effect right now: "
      + "the rules are sure about it now.")).toBeTruthy();
  });

  it("still shows the box when the entries cannot be loaded", async () => {
    knowledge.mockRejectedValue(new Error("offline"));
    mount(sender());
    await waitFor(() => expect(knowledge).toHaveBeenCalled());
    expect(screen.getByText(/^Now in “Other senders”\./)).toBeTruthy();
    expect(select().value).toBe("auto");
  });

  it("while the entries cannot be loaded, the sender's own reason still "
    + "fills the select and offers Reset", async () => {
    knowledge.mockRejectedValue(new Error("offline"));
    mount(sender({ smart_key: "k:support", smart_why: { r: "rule",
      k: "support", by: "a", entry: "a:a@solo.example" } }));
    await waitFor(() => expect(knowledge).toHaveBeenCalled());
    expect(select().value).toBe("support");
    fireEvent.click(screen.getByRole("button", { name: "Reset to automatic" }));
    await waitFor(() => expect(onReset).toHaveBeenCalledWith(["a:a@solo.example"]));
  });

  it("when the company's rule decides, Reset removes THAT rule even though "
    + "the sender has an own entry that does not apply", async () => {
    list([entry({ key: "co:solo.example", kind: "support" }),
      entry({ src: "ai", status: "no_effect", reason: "shadowed" })]);
    mount(sender({ smart_key: "k:support", smart_why: { r: "rule",
      k: "support", by: "co", co: "solo.example", entry: "co:solo.example" } }));
    await screen.findByText("Filed by you");
    fireEvent.click(screen.getByRole("button",
      { name: "Reset its company to automatic" }));
    await waitFor(() => expect(onReset).toHaveBeenCalledWith(["co:solo.example"]));
  });

  it("takes one change at a time: a second pick while the first is out is ignored",
    async () => {
      let done: (ok: boolean) => void = () => {};
      onFile.mockImplementation(() => new Promise<boolean>((r) => { done = r; }));
      mount(sender());
      fireEvent.change(select(), { target: { value: "support" } });
      await waitFor(() => expect(select().disabled).toBe(true));
      fireEvent.change(select(), { target: { value: "jobs" } });
      expect(onFile).toHaveBeenCalledTimes(1);
      done(true);
      await waitFor(() => expect(select().disabled).toBe(false));
    });

  it("reloads the entries when the mailbox state changes", async () => {
    const { rerender } = mount(sender());
    await waitFor(() => expect(knowledge).toHaveBeenCalledTimes(1));
    rerender(<SenderFiling sender={sender()} rowLabel="Other senders"
      categories={[]} rev={2} onFile={onFile} onReset={onReset} />);
    await waitFor(() => expect(knowledge).toHaveBeenCalledTimes(2));
  });

  it("is German in the German UI", async () => {
    setLang("de");
    list([entry({})]);
    mount(sender({ smart_why: { r: "rule", k: "orders", by: "a",
      entry: "a:a@solo.example" } }));
    expect(screen.getByText("So ordnet Mailbroom diesen Absender ein")).toBeTruthy();
    await screen.findByText("Von dir eingeordnet");
    expect(screen.getByRole("button", { name: "Auf automatisch zurücksetzen" }))
      .toBeTruthy();
    expect(screen.getByRole("combobox",
      { name: "Diesen Absender einordnen unter" })).toBeTruthy();
  });
});
