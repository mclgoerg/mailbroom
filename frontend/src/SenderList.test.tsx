// @vitest-environment jsdom
/* The senders inside a pooled Smart row: what each is, why it is here, and
 * the actions on TICKED senders - which always resolve to the exact sender
 * addresses, never the row or its domain. */

import { cleanup, fireEvent, render, screen, within } from
  "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filterSenders, SenderList, sortSenders } from "./components/SenderList";
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
