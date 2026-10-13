// @vitest-environment jsdom
/* The senders inside a pooled Smart row: what each is, why it is here, and
 * the actions on TICKED senders - which always resolve to the exact sender
 * addresses, never the row or its domain. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filterSenders, SenderList, sortSenders } from "./components/SenderList";
import { DialogProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { Group, SmartWhy } from "./types";

const sender = (addr: string, over: Partial<Group> = {}): Group => ({
  key: addr, label: addr.split("@")[0], sub: addr, count: 3, size: 3000,
  unread: 1, first: "2024-01-01", last: "2024-06-01", tags: [], samples: [],
  bulk: false, unsub: false, ai: null, ratings: null, protected: false,
  replied: false, att_size: 0, unsubscribed: null, new: false, pinned: 0,
  engagement: 50, ...over,
});

const why = (w: SmartWhy) => w;

const onAct = vi.fn();
const onProtect = vi.fn();
const onInspect = vi.fn();

function mount(senders: Group[], folders = ["Archive", "Promotions"]) {
  const props = { folders, onAct, onProtect, onInspect, onAckUnsub: () => {} };
  const r = render(<SenderList senders={senders} {...props} />);
  return { ...r, again: (next: Group[]) =>
    r.rerender(<SenderList senders={next} {...props} />) };
}

beforeEach(() => {
  setLang("en");
  onAct.mockReset().mockResolvedValue(true);
  onProtect.mockReset().mockResolvedValue(true);
  onInspect.mockReset();
});
afterEach(cleanup);

const row = (addr: string) => screen.getByLabelText(`Select ${addr.split("@")[0]}`);

describe("filter and sort", () => {
  const list = [
    sender("amy@one.example", { count: 2, last: "2024-03-01", size: 100 }),
    sender("zed@lone.example", { count: 9, last: "2024-01-01", size: 900,
      label: "Zed Zebra" }),
    sender("bob@two.example", { count: 5, last: "2024-09-01", size: 500 }),
  ];
  it("sorts by mails, newest, size or name - ties by address", () => {
    expect(sortSenders(list, "count").map((g) => g.key))
      .toEqual(["zed@lone.example", "bob@two.example", "amy@one.example"]);
    expect(sortSenders(list, "last").map((g) => g.key))
      .toEqual(["bob@two.example", "amy@one.example", "zed@lone.example"]);
    expect(sortSenders(list, "size")[0].key).toBe("zed@lone.example");
    expect(sortSenders(list, "label").map((g) => g.label))
      .toEqual(["amy", "bob", "Zed Zebra"]);
    const tie = [sender("b@x.example"), sender("a@x.example")];
    expect(sortSenders(tie, "count").map((g) => g.key))
      .toEqual(["a@x.example", "b@x.example"]);
  });

  it("filters on address and display name, every word must hit", () => {
    expect(filterSenders(list, "").length).toBe(3);
    expect(filterSenders(list, "lone").map((g) => g.key))
      .toEqual(["zed@lone.example"]);
    expect(filterSenders(list, "zebra").map((g) => g.key))
      .toEqual(["zed@lone.example"]);
    expect(filterSenders(list, "ZED lone").length).toBe(1);
    expect(filterSenders(list, "zed two").length).toBe(0);
  });
});

describe("the list", () => {
  it("shows each sender with its mails, last date and why it is here", () => {
    mount([
      sender("a@shop.example", { count: 7, last: "2024-06-01",
        smart_why: why({ r: "purpose", k: "orders", n: 5, of: 7 }) }),
      sender("b@co.example", { smart_why: why({ r: "newsletter",
        co: "co.example" }) }),
      sender("c@x.example", { smart_why: why({ r: "none" }) }),
    ]);
    expect(screen.getByText("5 of 7 mails are about orders and deliveries."))
      .toBeTruthy();
    expect(screen.getByText(
      "Offers an unsubscribe link or sends promotions. Placed together with "
      + "the other senders of co.example.")).toBeTruthy();
    expect(screen.getByText("Nothing in its mails says what it is about."))
      .toBeTruthy();
    expect(screen.getByText(/^7 mails ·/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "a" })).toBeTruthy();
  });

  it("says why in German too", () => {
    setLang("de");
    mount([sender("a@shop.example", { smart_why:
      why({ r: "weak", k: "orders", n: 1, of: 4 }) })]);
    expect(screen.getByText(
      "Nur 1 von 4 Mails handeln von Bestellungen und Lieferungen – zu wenig für eine Aussage."))
      .toBeTruthy();
    expect(screen.getByPlaceholderText("Absender suchen…")).toBeTruthy();
  });

  it("does not repeat what the panel's own line says about every sender", () => {
    mount([
      sender("a@co.example", { smart_why: why({ r: "company", co: "co.example" }) }),
      sender("b@co.example", { smart_why: why({ r: "protected" }) }),
      sender("c@co.example", { smart_why: why({ r: "replied" }) }),
      sender("d@co.example", { smart_why: why({ r: "competing" }) }),
    ]);
    expect(screen.queryByText(/Part of co.example/)).toBeNull();
    expect(screen.queryByText("You protected this sender.")).toBeNull();
    expect(screen.queryByText("You have written to this sender.")).toBeNull();
    expect(screen.getByText("Its mails are about several things at once."))
      .toBeTruthy();
  });

  it("opens one sender on a click", () => {
    const a = sender("a@shop.example");
    mount([a, sender("b@shop.example")]);
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    expect(onInspect).toHaveBeenCalledWith(a);
  });

  it("always uses the card layout - no table beside the narrow pane", () => {
    const { container } = mount([sender("a@shop.example")]);
    expect(container.querySelector("table")).toBeNull();
  });

  it("an empty or unmatched list says so", () => {
    mount([sender("a@shop.example")]);
    fireEvent.change(screen.getByPlaceholderText("Search senders…"),
      { target: { value: "nobody" } });
    expect(screen.getByText("No senders match.")).toBeTruthy();
  });
});

describe("acting on ticked senders", () => {
  const trio = [sender("a@x.example", { count: 4 }),
    sender("b@y.example", { count: 2 }), sender("c@z.example", { count: 1 })];

  it("shows the scope: how many senders and mails are ticked", () => {
    mount(trio);
    expect(screen.queryByText(/senders selected/)).toBeNull();   // no bar yet
    fireEvent.click(row("a@x.example"));
    fireEvent.click(row("c@z.example"));
    expect(screen.getByText("2 of 3 senders selected (5 mails)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Trash selected (2)" })).toBeTruthy();
  });

  it("trash resolves to the exact sender addresses and clears the selection",
    async () => {
      mount(trio);
      fireEvent.click(row("a@x.example"));
      fireEvent.click(row("b@y.example"));
      fireEvent.click(screen.getByRole("button", { name: "Trash selected (2)" }));
      expect(onAct).toHaveBeenCalledWith(["a@x.example", "b@y.example"], "trash");
      await vi.waitFor(() => expect(screen.queryByText(/senders selected/)).toBeNull());
    });

  it("a declined confirmation keeps the selection", async () => {
    onAct.mockResolvedValue(false);
    mount(trio);
    fireEvent.click(row("a@x.example"));
    fireEvent.click(screen.getByRole("button", { name: "Trash selected (1)" }));
    await vi.waitFor(() => expect(onAct).toHaveBeenCalled());
    expect(screen.getByText("1 of 3 senders selected (4 mails)")).toBeTruthy();
  });

  it("archive, mark read and protect act on the ticked senders", async () => {
    mount(trio);
    fireEvent.click(row("b@y.example"));
    const action = (v: string) => fireEvent.change(
      screen.getAllByRole("combobox").find((s) =>
        [...(s as HTMLSelectElement).options].some((o) => o.value === v))!,
      { target: { value: v } });
    action("archive");
    expect(onAct).toHaveBeenLastCalledWith(["b@y.example"], "archive");
    await vi.waitFor(() => expect(screen.queryByText(/senders selected/)).toBeNull());
    fireEvent.click(row("b@y.example"));
    action("mark_read");
    expect(onAct).toHaveBeenLastCalledWith(["b@y.example"], "mark_read");
    await vi.waitFor(() => expect(screen.queryByText(/senders selected/)).toBeNull());
    fireEvent.click(row("c@z.example"));
    action("protect");
    expect(onProtect).toHaveBeenCalledWith(["c@z.example"]);
  });

  it("move asks for the folder, then moves exactly these senders", async () => {
    mount(trio);
    fireEvent.click(row("a@x.example"));
    const sel = screen.getAllByRole("combobox").find((s) =>
      [...(s as HTMLSelectElement).options].some((o) => o.value === "move"))!;
    fireEvent.change(sel, { target: { value: "move" } });
    const folder = screen.getAllByRole("combobox").find((s) =>
      [...(s as HTMLSelectElement).options].some((o) => o.value === "Promotions"))!;
    fireEvent.change(folder, { target: { value: "Promotions" } });
    expect(onAct).toHaveBeenCalledWith(["a@x.example"], "move", "Promotions");
  });

  it("offers no unsubscribe - that stays one sender's own action", () => {
    mount([sender("a@x.example", { unsub: true,
      unsubscribed: { n: 0, of: 1, status: "pending", link: "", addr: "" } })]);
    fireEvent.click(row("a@x.example"));
    expect(screen.queryByText(/unsubscribe/i, { selector: "option, button" }))
      .toBeNull();
  });
});

describe("the selection through refreshes", () => {
  const trio = [sender("a@x.example"), sender("b@y.example"), sender("c@z.example")];

  it("survives a refresh that hands over new objects", () => {
    const { again } = mount(trio);
    fireEvent.click(row("b@y.example"));
    again(trio.map((g) => ({ ...g, count: g.count + 1 })));
    expect(screen.getByText("1 of 3 senders selected (4 mails)")).toBeTruthy();
    expect((row("b@y.example") as HTMLInputElement).checked).toBe(true);
  });

  it("drops senders that are gone, keeps the rest", () => {
    const { again } = mount(trio);
    fireEvent.click(row("a@x.example"));
    fireEvent.click(row("b@y.example"));
    again([trio[1], trio[2]]);                     // a@x moved away
    expect(screen.getByText("1 of 2 senders selected (3 mails)")).toBeTruthy();
    again([trio[2]]);                              // b@y gone too
    expect(screen.queryByText(/senders selected/)).toBeNull();
  });
});

describe("a pool with hundreds of senders", () => {
  const N = 650;
  const many = Array.from({ length: N }, (_, i) =>
    sender(`s${i}@rnd${i}.example`, { count: 1 + (i % 7) }));

  it("pages the list, finds a sender far down, selects every match", () => {
    mount(many);
    expect(screen.getAllByRole("checkbox").length).toBeLessThanOrEqual(50);   // one page
    fireEvent.change(screen.getByPlaceholderText("Search senders…"),
      { target: { value: "s649@rnd649" } });
    expect(screen.getByRole("button", { name: "s649" })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search senders…"),
      { target: { value: "rnd6" } });                 // rnd6, rnd60-69, rnd600-649
    const matching = many.filter((g) => g.key.includes("rnd6")).length;
    fireEvent.click(screen.getByRole("button",
      { name: `Select all ${matching} shown` }));
    expect(screen.getByText(new RegExp(`^${matching} of ${N} senders selected`)))
      .toBeTruthy();
    // ... across pages: the actions get ALL of them, not just the visible page
    fireEvent.click(screen.getByRole("button",
      { name: `Trash selected (${matching})` }));
    const keys = onAct.mock.calls[0][0] as string[];
    expect(keys.length).toBe(matching);
    expect(new Set(keys)).toEqual(new Set(
      many.filter((g) => g.key.includes("rnd6")).map((g) => g.key)));
    expect(keys.every((k) => k.includes("@"))).toBe(true);   // addresses only
  });

  it("filters and sorts 5000 senders well under a second", () => {
    const big = Array.from({ length: 5000 }, (_, i) =>
      sender(`s${i}@rnd${i % 900}.example`, { count: 1 + (i % 13),
        last: `2024-0${1 + (i % 9)}-01` }));
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {                   // 20 keystrokes
      sortSenders(filterSenders(big, i % 2 ? "rnd45" : "s4999@"), "count");
    }
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(filterSenders(big, "s4999@").length).toBe(1);
  });
});


describe("File in Smart as...", () => {
  const onFile = vi.fn();
  beforeEach(() => onFile.mockReset().mockResolvedValue(true));
  const props = { folders: [], onAct, onProtect, onInspect, onAckUnsub: () => {} };
  const mountFile = (senders: Group[], rowKind = "orders",
      categories: string[] = []) => render(
    <DialogProvider>
      <SenderList senders={senders} {...props} rowKind={rowKind}
        categories={categories} onFile={onFile} />
    </DialogProvider>);
  const fileSelect = () => screen.getAllByRole("combobox").find((s) =>
    [...(s as HTMLSelectElement).options].some((o) => o.value === "file"))!;
  const kindSelect = () => screen.getByRole("combobox",
    { name: "File in Smart as…" });
  const tickAndFile = (addr: string) => {
    fireEvent.click(row(addr));
    fireEvent.change(fileSelect(), { target: { value: "file" } });
  };

  const lone = sender("solo@solo.example");
  const pair = [
    sender("amy@acme.example", { smart_why: why({ r: "purpose", k: "orders",
      n: 3, of: 3, co: "acme.example" }) }),
    sender("bob@acme.example", { smart_why: why({ r: "purpose", k: "orders",
      n: 3, of: 3, co: "acme.example" }) }),
    lone];

  it("is offered only where filing can happen", () => {
    mount([lone]);                                  // no onFile: no action
    fireEvent.click(row("solo@solo.example"));
    expect([...(screen.getAllByRole("combobox")[0] as HTMLSelectElement).options]
      .map((o) => o.value)).not.toContain("file");
    cleanup();
    mountFile([lone]);
    fireEvent.click(row("solo@solo.example"));
    const opt = [...(fileSelect() as HTMLSelectElement).options]
      .find((o) => o.value === "file")!;
    expect(opt.textContent).toBe("File in Smart as…");
    expect(opt.disabled).toBe(false);
  });

  it.each([
    ["company", "Company rows are placed by their structure, so filing has "
      + "no effect here."],
    ["protected", "Protected senders stay in their own bucket, so filing has "
      + "no effect here."],
    ["replied", "People you write to stay in their own bucket, so filing has "
      + "no effect here."],
  ])("is disabled, with the reason, in %s rows", (kind, reason) => {
    mountFile([lone], kind);
    fireEvent.click(row("solo@solo.example"));
    const opt = [...(fileSelect() as HTMLSelectElement).options]
      .find((o) => o.value === "file")!;
    expect(opt.disabled).toBe(true);
    expect(screen.getByText(reason)).toBeTruthy();
  });

  it("stays available in category rows and the Other row", () => {
    for (const kind of ["category", "other", "orders", "newsletter"]) {
      const { unmount } = mountFile([lone], kind);
      fireEvent.click(row("solo@solo.example"));
      expect([...(fileSelect() as HTMLSelectElement).options]
        .find((o) => o.value === "file")!.disabled, kind).toBe(false);
      unmount();
    }
  });

  it("offers every kind and the user's own categories, says no mail moves, "
    + "and files exactly the ticked senders", async () => {
    mountFile([lone, sender("other@solo2.example")], "other", ["hobby"]);
    tickAndFile("solo@solo.example");
    expect(screen.getByText("No mail is moved.")).toBeTruthy();
    expect([...(kindSelect() as HTMLSelectElement).options].map((o) =>
      o.textContent)).toEqual(["File in Smart as…", "Orders & deliveries",
      "Appointments & bookings", "Job applications", "Support & inquiries",
      "Accounts & security", "Newsletters", "Individuals", "Other senders",
      "Category “hobby”"]);
    fireEvent.change(kindSelect(), { target: { value: "support" } });
    await waitFor(() => expect(onFile).toHaveBeenCalledWith(
      [{ key: "a:solo@solo.example", kind: "support" }], 1));
    expect(onAct).not.toHaveBeenCalled();           // no mail is moved
    await waitFor(() => expect(screen.queryByText(/senders selected/)).toBeNull());
  });

  it("files into an own category as cat:<name>", async () => {
    mountFile([lone], "other", ["hobby"]);
    tickAndFile("solo@solo.example");
    fireEvent.change(kindSelect(), { target: { value: "cat:hobby" } });
    await waitFor(() => expect(onFile).toHaveBeenCalledWith(
      [{ key: "a:solo@solo.example", kind: "cat:hobby" }], 1));
  });

  it("can be cancelled before a kind is chosen", () => {
    mountFile([lone]);
    tickAndFile("solo@solo.example");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("No mail is moved.")).toBeNull();
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByText("1 of 1 senders selected (3 mails)")).toBeTruthy();
  });

  it("asks what to file when a ticked sender belongs to a company group: "
    + "just the ticked ones ...", async () => {
    mountFile(pair);
    tickAndFile("amy@acme.example");
    fireEvent.change(kindSelect(), { target: { value: "newsletter" } });
    await pressDialog("Just the ticked senders");
    await waitFor(() => expect(onFile).toHaveBeenCalledWith(
      [{ key: "a:amy@acme.example", kind: "newsletter" }], 1));
  });

  it("... or the whole company", async () => {
    mountFile(pair);
    tickAndFile("amy@acme.example");
    fireEvent.change(kindSelect(), { target: { value: "newsletter" } });
    await pressDialog("The whole company (2 senders)");
    await waitFor(() => expect(onFile).toHaveBeenCalledWith(
      [{ key: "co:acme.example", kind: "newsletter" }], 1));
  });

  it("mixes the two when lone senders are ticked too", async () => {
    mountFile(pair);
    fireEvent.click(row("amy@acme.example"));
    fireEvent.click(row("bob@acme.example"));
    fireEvent.click(row("solo@solo.example"));
    fireEvent.change(fileSelect(), { target: { value: "file" } });
    fireEvent.change(kindSelect(), { target: { value: "jobs" } });
    await pressDialog("The whole company (2 senders)");
    await waitFor(() => expect(onFile).toHaveBeenCalled());
    expect(onFile.mock.calls[0][0]).toEqual([
      { key: "co:acme.example", kind: "jobs" },
      { key: "a:solo@solo.example", kind: "jobs" }]);
    expect(onFile.mock.calls[0][1]).toBe(3);
  });

  it("a cancelled question files nothing and keeps the selection", async () => {
    mountFile(pair);
    tickAndFile("amy@acme.example");
    fireEvent.change(kindSelect(), { target: { value: "newsletter" } });
    await cancelDialog();
    await expectNoDialog();
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByText("1 of 3 senders selected (3 mails)")).toBeTruthy();
  });

  it("a lone sender is filed without a question", async () => {
    mountFile(pair);
    tickAndFile("solo@solo.example");
    fireEvent.change(kindSelect(), { target: { value: "accounts" } });
    await waitFor(() => expect(onFile).toHaveBeenCalled());
    await expectNoDialog();
  });

  it("a failed filing keeps the selection", async () => {
    onFile.mockResolvedValue(false);
    mountFile([lone]);
    tickAndFile("solo@solo.example");
    fireEvent.change(kindSelect(), { target: { value: "jobs" } });
    await waitFor(() => expect(onFile).toHaveBeenCalled());
    expect(screen.getByText("1 of 1 senders selected (3 mails)")).toBeTruthy();
  });

  it("speaks German", async () => {
    setLang("de");
    mountFile([lone], "other", ["hobby"]);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    const sel = screen.getAllByRole("combobox").find((c) =>
      [...(c as HTMLSelectElement).options].some((o) => o.value === "file"))!;
    expect([...(sel as HTMLSelectElement).options].find((o) => o.value === "file")!
      .textContent).toBe("In Smart einordnen als…");
    fireEvent.change(sel, { target: { value: "file" } });
    expect(screen.getByText("Es wird keine Mail verschoben.")).toBeTruthy();
    const kinds = screen.getByRole("combobox",
      { name: "In Smart einordnen als…" }) as HTMLSelectElement;
    expect([...kinds.options].map((o) => o.textContent))
      .toContain("Kategorie „hobby“");
  });

  it("says in a sender's card that it was filed - or kept from an AI answer", () => {
    mount([
      sender("a@x.example", { smart_why: why({ r: "rule", k: "orders", by: "a" }) }),
      sender("b@x.example", { smart_why: why({ r: "rule", k: "support",
        by: "co", co: "x.example" }) }),
      sender("c@x.example", { smart_why: why({ r: "kept_ai", k: "jobs", by: "a" }) }),
      sender("d@x.example", { smart_why: why({ r: "rule", k: "category",
        name: "hobby", by: "a" }) }),
    ]);
    for (const text of [
      "You filed this sender under Orders & deliveries.",
      "You filed its company under Support & inquiries.",
      "Filed under Job applications by a kept AI answer.",
      "You filed this sender under Category “hobby”."]) {
      expect(screen.getByText(text), text).toBeTruthy();
    }
  });
});
