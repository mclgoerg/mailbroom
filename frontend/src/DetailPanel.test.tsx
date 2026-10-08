// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "./i18n";
import type { Group, Mail } from "./types";

const group_ = vi.fn();
const deleteMessages = vi.fn().mockResolvedValue({});
const aiGroup = vi.fn();
const pin = vi.fn().mockResolvedValue({ ok: true, pinned: true });
const pinGroup = vi.fn();
const thread = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      group: (...args: unknown[]) => group_(...args),
      deleteMessages: (...args: unknown[]) => deleteMessages(...args),
      aiGroup: (...args: unknown[]) => aiGroup(...args),
      pin: (...args: unknown[]) => pin(...args),
      pinGroup: (...args: unknown[]) => pinGroup(...args),
      unsubscribe: vi.fn(),
      unsubscribeAck: vi.fn(),
      thread: (...args: unknown[]) => thread(...args),
      message: () => Promise.resolve({ from: "", to: "", date: "",
        subject: "", text: "body" }),
      messages: (items: [string, number][]) => Promise.resolve({
        messages: items.map(([folder, uid]) => ({ folder, uid, from: "",
          to: "", date: "", subject: "", text: "body" })) }),
    },
  };
});

import { DetailPanel } from "./components/DetailPanel";
import { DialogProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";

const mkMail = (uid: number, over: Partial<Mail> = {}): Mail => ({
  uid, folder: "INBOX", date: "2025-01-01", ts: 0,
  subject: `Mail ${uid}`, addr: "s@x.example", size: 1000,
  seen: true, ai: null, ...over,
});

const mkGroup = (over: Partial<Group> = {}): Group => ({
  key: "s@x.example", label: "Sender", sub: "s@x.example",
  count: 2, size: 2000, unread: 0, first: "2025-01-01", last: "2025-01-02",
  tags: [], samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
  new: false, pinned: 0, engagement: 50, ...over,
});

const noop = () => {};
const noopAsync = async () => true;

function renderPanel(mails: Mail[], extra: Partial<Parameters<
    typeof DetailPanel>[0]> = {}) {
  group_.mockResolvedValue(mails);
  return render(<DialogProvider>
    <DetailPanel
      grouping="sender"
      group={mkGroup()}
      aiEnabled={false}
      protectedNow={false}
      unsubscribedNow={null}
      onTrash={noopAsync}
      folders={["Archive", "Promotions"]}
      sieve={false}
      onClose={noop}
      onDeleted={noop}
      {...extra}
    />
  </DialogProvider>);
}

describe("DetailPanel", () => {
  beforeEach(() => {
    setLang("en");
    group_.mockClear();
    deleteMessages.mockClear();
    aiGroup.mockReset();
    pin.mockClear();
    pinGroup.mockReset();
    pin.mockResolvedValue({ ok: true, pinned: true });
    localStorage.setItem("pmc_ai_ack", "1");   // skip the AI consent prompt
  });
  afterEach(cleanup);

  it("loads and lists the group's mails", async () => {
    renderPanel([mkMail(1), mkMail(2)]);
    await waitFor(() => screen.getByText("Mail 1"));
    expect(screen.getByText("Mail 2")).toBeTruthy();
  });

  it("rating filter chips are hidden when their bucket is empty, shown "
    + "with a count otherwise, and filter the list when clicked", async () => {
    renderPanel([
      mkMail(1, { ai: "delete_safe" }),
      mkMail(2, { ai: "delete_safe" }),
      mkMail(3),
    ]);
    await waitFor(() => screen.getByText("Mail 1"));
    expect(screen.queryByText(/review/)).toBeNull();   // 0 review mails
    const safeChip = screen.getByText(/safe to delete \(2\)/);
    fireEvent.click(safeChip);
    expect(screen.queryByText("Mail 3")).toBeNull();
    expect(screen.getByText("Mail 1")).toBeTruthy();
  });

  it("has no bulk-action chrome until a mail is selected", async () => {
    renderPanel([mkMail(1), mkMail(2)]);
    await waitFor(() => screen.getByText("Mail 1"));
    expect(screen.queryByText(/selected/)).toBeNull();
    expect(screen.queryByText("Trash selected")).toBeNull();

    const boxes = document.querySelectorAll('input[type="checkbox"]');
    fireEvent.click(boxes[0]);
    expect(await screen.findByText("1 selected")).toBeTruthy();
    expect(screen.getByText(/Trash selected/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it("trashes the selected mail via a background job after confirmation",
    async () => {
    renderPanel([mkMail(1), mkMail(2)]);
    await waitFor(() => screen.getByText("Mail 1"));
    fireEvent.click(document.querySelectorAll('input[type="checkbox"]')[0]);
    fireEvent.click(await screen.findByText(/Trash selected/));
    await pressDialog("Move to Trash (1)");
    await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
      [["INBOX", 1]], "trash", "", false));
  });

  it("cancelling the trash confirmation sends nothing", async () => {
    renderPanel([mkMail(1), mkMail(2)]);
    await waitFor(() => screen.getByText("Mail 1"));
    fireEvent.click(document.querySelectorAll('input[type="checkbox"]')[0]);
    fireEvent.click(await screen.findByText(/Trash selected/));
    await cancelDialog();
    await expectNoDialog();
    expect(deleteMessages).not.toHaveBeenCalled();
  });

  it("list view: header has only Protect + Close; the footer offers Block "
    + "sender and 'Trash all N'", async () => {
    renderPanel([mkMail(1), mkMail(2)], {
      onProtect: vi.fn(), onBlock: vi.fn() });
    await waitFor(() => screen.getByText("Mail 1"));
    expect(screen.getByRole("button", { name: /Protect this sender/ })
      .getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Block sender" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Trash all 2" })).toBeTruthy();
    expect(screen.queryByText("Trash this mail")).toBeNull();
  });

  it("an empty group shows no 'Trash all' button", async () => {
    renderPanel([], { group: mkGroup({ count: 0 }) });
    await waitFor(() => expect(group_).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Trash all/ })).toBeNull();
  });

  it("'Trash all N' counts only unpinned mails and hides when none are left",
    async () => {
    const { unmount } = renderPanel([mkMail(1, { pinned: true }),
      mkMail(2, { pinned: true }), mkMail(3), mkMail(4)]);
    await screen.findByRole("button", { name: "Trash all 2" });
    unmount();
    renderPanel([mkMail(1, { pinned: true }), mkMail(2, { pinned: true })]);
    await waitFor(() => screen.getByText("Mail 1"));
    expect(screen.queryByRole("button", { name: /Trash all/ })).toBeNull();
  });

  it("with a selection the group footer gives way to the selection bar "
    + "(never two red buttons)", async () => {
    renderPanel([mkMail(1), mkMail(2)], { onBlock: vi.fn() });
    await screen.findByRole("button", { name: "Trash all 2" });
    fireEvent.click(document.querySelectorAll('input[type="checkbox"]')[0]);
    await screen.findByText(/Trash selected/);
    expect(screen.queryByRole("button", { name: /Trash all/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Block sender" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    await screen.findByRole("button", { name: "Trash all 2" });
  });

  describe("message view footer", () => {
    const open = async (mails: Mail[], extra = {}) => {
      renderPanel(mails, { onBlock: vi.fn(), ...extra });
      await waitFor(() => screen.getByText("Mail 1"));
      fireEvent.click(screen.getByText("Mail 1"));
      await screen.findByText("back to list");
    };

    it("is message-scoped: Pin + Trash this mail, no group actions",
      async () => {
      await open([mkMail(1), mkMail(2)]);
      expect(screen.getByRole("button", { name: "Trash this mail" }))
        .toBeTruthy();
      expect(screen.getByRole("button", { name: /Protect this mail/ }))
        .toBeTruthy();
      expect(screen.queryByRole("button", { name: /Trash all/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Block sender" })).toBeNull();
    });

    it("Trash this mail confirms, trashes only that mail and returns to "
      + "the list", async () => {
      await open([mkMail(1), mkMail(2)]);
      fireEvent.click(screen.getByRole("button", { name: "Trash this mail" }));
      expect((await findDialog()).textContent).toContain('"Mail 1"');
      await pressDialog("Move to Trash (1)");
      await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
        [["INBOX", 1]], "trash", "", false));
      await screen.findByRole("button", { name: "Trash 1 mail" });
      expect(screen.queryByText("Mail 1")).toBeNull();
    });

    it("the pin is labelled for the mail, distinct from the sender's Protect",
      async () => {
      await open([mkMail(1), mkMail(2)], { onProtect: vi.fn() });
      const footerPin = screen.getByRole("button", { name: /Protect this mail/ });
      expect(footerPin.textContent).toBe("Protect mail");
      expect(screen.getByRole("button", { name: /Protect this sender/ })
        .textContent).toBe("Protect");
    });

    it("trashing the open mail leaves other selected mails selected",
      async () => {
      renderPanel([mkMail(1), mkMail(2), mkMail(3)]);
      await waitFor(() => screen.getByText("Mail 1"));
      const boxes = document.querySelectorAll('input[type="checkbox"]');
      fireEvent.click(boxes[1]);
      fireEvent.click(boxes[2]);
      fireEvent.click(screen.getByText("Mail 1"));
      await screen.findByText("back to list");
      fireEvent.click(screen.getByRole("button", { name: "Trash this mail" }));
      await pressDialog("Move to Trash (1)");
      expect(await screen.findByText("2 selected")).toBeTruthy();
    });

    it("the protected-mail warning doesn't repeat its title in the body",
      async () => {
      await open([mkMail(1, { pinned: true }), mkMail(2)]);
      fireEvent.click(screen.getByRole("button", { name: "Trash this mail" }));
      const text = (await findDialog()).textContent!;
      expect(text).toContain('The protected mail "Mail 1"');
      expect(text).not.toContain("Move to Trash:");
      await cancelDialog();
    });

    it("cancelling Trash this mail keeps the message open", async () => {
      await open([mkMail(1), mkMail(2)]);
      fireEvent.click(screen.getByRole("button", { name: "Trash this mail" }));
      await cancelDialog();
      await expectNoDialog();
      expect(deleteMessages).not.toHaveBeenCalled();
      expect(screen.getByText("back to list")).toBeTruthy();
    });

    it("a protected mail gets its own warning and is sent with force",
      async () => {
      await open([mkMail(1, { pinned: true }), mkMail(2)]);
      fireEvent.click(screen.getByRole("button", { name: "Trash this mail" }));
      expect((await findDialog()).textContent)
        .toMatch(/protected mail "Mail 1"/);
      await pressDialog("Move to Trash anyway");
      await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
        [["INBOX", 1]], "trash", "", true));
    });

    it("trashing the last mail closes the panel", async () => {
      const onClose = vi.fn();
      await open([mkMail(1)], { onClose });
      fireEvent.click(screen.getByRole("button", { name: "Trash this mail" }));
      await pressDialog("Move to Trash (1)");
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });
  });

  it("the move-to-folder picker always has a way back, and resets once "
    + "the selection clears", async () => {
    renderPanel([mkMail(1), mkMail(2)]);
    await waitFor(() => screen.getByText("Mail 1"));
    fireEvent.click(document.querySelectorAll('input[type="checkbox"]')[0]);
    const actionSelect = await screen.findByDisplayValue("Action…");
    fireEvent.change(actionSelect, { target: { value: "move" } });
    expect(await screen.findByDisplayValue("Move to folder…")).toBeTruthy();

    // Cancel goes back to the plain Action… control without acting.
    fireEvent.click(screen.getByTitle("Cancel"));
    expect(await screen.findByDisplayValue("Action…")).toBeTruthy();
    expect(deleteMessages).not.toHaveBeenCalled();

    // Clearing the selection also resets it - re-selecting starts fresh
    // instead of reopening mid-move (the overview had this exact bug).
    fireEvent.change(screen.getByDisplayValue("Action…"),
      { target: { value: "move" } });
    await screen.findByDisplayValue("Move to folder…");
    fireEvent.click(document.querySelectorAll('input[type="checkbox"]')[0]);
    fireEvent.click(document.querySelectorAll('input[type="checkbox"]')[0]);
    expect(await screen.findByDisplayValue("Action…")).toBeTruthy();
  });

  it("AI rate mails is an Action… option (not the overflow menu) once "
    + "something is selected, and scopes the run to the selection",
    async () => {
    aiGroup.mockResolvedValue({ verdicts: [], note: "", reviewed: 0,
      remaining: 0, total: 1, usage: { input_tokens: 0, output_tokens: 0 } });
    renderPanel([mkMail(1), mkMail(2)], { aiEnabled: true });
    await waitFor(() => screen.getByText("Mail 1"));
    fireEvent.click(document.querySelectorAll('input[type="checkbox"]')[0]);
    // No longer offered in the overflow menu while something is selected -
    // it promoted to the Action… select instead (mirrors the overview).
    fireEvent.click(await screen.findByLabelText("More"));
    expect(screen.queryByRole("button", { name: /AI rate mails/ })).toBeNull();
    fireEvent.click(screen.getByLabelText("More"));   // close the menu back

    fireEvent.change(await screen.findByDisplayValue("Action…"),
      { target: { value: "ai_review" } });
    await waitFor(() => expect(aiGroup).toHaveBeenCalledWith(
      "sender", "s@x.example", 0, 50, [["INBOX", 1]]));
  });

  it("AI rate mails rates the whole group via the overflow menu when "
    + "nothing is selected", async () => {
    aiGroup.mockResolvedValue({ verdicts: [], note: "", reviewed: 0,
      remaining: 0, total: 2, usage: { input_tokens: 0, output_tokens: 0 } });
    renderPanel([mkMail(1), mkMail(2)], { aiEnabled: true });
    await waitFor(() => screen.getByText("Mail 1"));
    fireEvent.click(await screen.findByLabelText("More"));
    fireEvent.click(screen.getByText("AI rate mails"));
    await waitFor(() => expect(aiGroup).toHaveBeenCalledWith(
      "sender", "s@x.example", 0, 50, undefined));
  });

  it("the whole-group Trash button closes the panel once it resolves true",
    async () => {
    const onTrash = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    renderPanel([mkMail(1)], { onTrash, onClose });
    await waitFor(() => screen.getByText("Mail 1"));
    fireEvent.click(screen.getByRole("button", { name: "Trash 1 mail" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onTrash).toHaveBeenCalled();
  });

  describe("pinned (protected) mails", () => {
    const checkbox = (i: number) =>
      document.querySelectorAll('input[type="checkbox"]')[i];

    it("pin toggle calls the API, marks the row and updates the header",
      async () => {
      const onDeleted = vi.fn();
      renderPanel([mkMail(1), mkMail(2)], { onDeleted });
      await waitFor(() => screen.getByText("Mail 1"));
      expect(document.querySelectorAll("[data-pinned]").length).toBe(0);

      fireEvent.click(screen.getAllByTitle(/Protect this mail/)[0]);
      await waitFor(() =>
        expect(pin).toHaveBeenCalledWith("INBOX", 1, true));
      await waitFor(() =>
        expect(document.querySelectorAll("[data-pinned]").length).toBe(1));
      expect(screen.getByText(/1 mail protected/)).toBeTruthy();
      expect(onDeleted).toHaveBeenCalled();      // overview badge refreshes

      // toggling a pinned mail unpins it again
      pin.mockResolvedValue({ ok: true, pinned: false });
      fireEvent.click(screen.getByTitle(/Remove this mail's protection/));
      await waitFor(() =>
        expect(pin).toHaveBeenLastCalledWith("INBOX", 1, false));
      await waitFor(() =>
        expect(document.querySelectorAll("[data-pinned]").length).toBe(0));
    });

    it("shows the reason (already translated by the api layer) when a mail "
      + "can't be pinned", async () => {
      pin.mockRejectedValue(new Error("no Message-ID, can't protect"));
      renderPanel([mkMail(1)]);
      await waitFor(() => screen.getByText("Mail 1"));
      fireEvent.click(screen.getByTitle(/Protect this mail/));
      expect(await screen.findByText(/no Message-ID, can't protect/))
        .toBeTruthy();
      expect(document.querySelectorAll("[data-pinned]").length).toBe(0);
    });

    it("pinning a selected mail drops it from the selection", async () => {
      renderPanel([mkMail(1), mkMail(2)]);
      await waitFor(() => screen.getByText("Mail 1"));
      fireEvent.click(checkbox(0));
      expect(await screen.findByText("1 selected")).toBeTruthy();
      fireEvent.click(screen.getAllByTitle(/Protect this mail/)[0]);
      await waitFor(() => expect(screen.queryByText("1 selected")).toBeNull());
    });

    it("select-all never selects pinned mails", async () => {
      renderPanel([mkMail(1, { pinned: true }), mkMail(2), mkMail(3)]);
      await waitFor(() => screen.getByText("Mail 1"));
      fireEvent.change(screen.getByDisplayValue("Select…"),
        { target: { value: "all" } });
      expect(await screen.findByText("2 selected")).toBeTruthy();
      expect((checkbox(0) as HTMLInputElement).checked).toBe(false);
      expect((checkbox(1) as HTMLInputElement).checked).toBe(true);
      expect((checkbox(2) as HTMLInputElement).checked).toBe(true);
    });

    it("'older than' never selects pinned mails", async () => {
      const old = 1_000_000;                       // 1970 - older than 2y
      renderPanel([mkMail(1, { ts: old, pinned: true }),
        mkMail(2, { ts: old }), mkMail(3, { ts: Date.now() / 1000 })]);
      await waitFor(() => screen.getByText("Mail 1"));
      fireEvent.change(screen.getByDisplayValue("Select…"),
        { target: { value: "older24" } });
      expect(await screen.findByText("1 selected")).toBeTruthy();
      expect((checkbox(1) as HTMLInputElement).checked).toBe(true);
      expect((checkbox(0) as HTMLInputElement).checked).toBe(false);
    });

    it("AI selection by rating never selects pinned mails", async () => {
      aiGroup.mockResolvedValue({
        verdicts: [["INBOX", 1, "keep"], ["INBOX", 2, "delete_safe"]],
        note: "n", reviewed: 2, remaining: 0, total: 2,
        usage: { input_tokens: 0, output_tokens: 0 } });
      renderPanel([mkMail(1, { pinned: true, ai: "delete_safe" }),
        mkMail(2), mkMail(3, { ai: "delete_safe" })], { aiEnabled: true });
      await waitFor(() => screen.getByText("Mail 1"));
      fireEvent.click(await screen.findByLabelText("More"));
      fireEvent.click(screen.getByText("AI rate mails"));
      expect(await screen.findByText("2 selected")).toBeTruthy();
      expect((checkbox(0) as HTMLInputElement).checked).toBe(false);
    });

    it("explicitly trashing ONE pinned mail asks first and sends force",
      async () => {
      renderPanel([mkMail(1, { pinned: true }), mkMail(2)]);
      await waitFor(() => screen.getByText("Mail 1"));
      fireEvent.click(checkbox(0));
      fireEvent.click(await screen.findByText(/Trash selected/));
      // the dedicated warning only, not the generic count confirm
      expect((await findDialog()).textContent)
        .toMatch(/protected mail "Mail 1"/);
      await pressDialog("Move to Trash anyway");
      await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
        [["INBOX", 1]], "trash", "", true));
    });

    it("declining the pinned-mail confirmation does nothing", async () => {
      renderPanel([mkMail(1, { pinned: true }), mkMail(2)]);
      await waitFor(() => screen.getByText("Mail 1"));
      fireEvent.click(checkbox(0));
      fireEvent.click(await screen.findByText(/Trash selected/));
      await cancelDialog();
      await expectNoDialog();
      expect(deleteMessages).not.toHaveBeenCalled();
      expect(screen.getByText("1 selected")).toBeTruthy();   // still there
    });

    it("pinned mails ticked inside a bigger selection are left out, "
      + "never forced", async () => {
      renderPanel([mkMail(1, { pinned: true }), mkMail(2), mkMail(3)]);
      await waitFor(() => screen.getByText("Mail 1"));
      fireEvent.click(checkbox(0));
      fireEvent.click(checkbox(1));
      fireEvent.click(await screen.findByText(/Trash selected/));
      expect((await findDialog()).textContent)
        .toMatch(/1 protected mail skipped/);
      await pressDialog("Move to Trash (1)");
      await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
        [["INBOX", 2]], "trash", "", false));
      // the pinned mail is still listed afterwards
      await waitFor(() => expect(screen.queryByText("Mail 2")).toBeNull());
      expect(screen.getByText("Mail 1")).toBeTruthy();
    });

    it("a selection of only several pinned mails is refused locally",
      async () => {
      renderPanel([mkMail(1, { pinned: true }), mkMail(2, { pinned: true }),
        mkMail(3)]);
      await waitFor(() => screen.getByText("Mail 1"));
      fireEvent.click(checkbox(0));
      fireEvent.click(checkbox(1));
      fireEvent.click(await screen.findByText(/Trash selected/));
      expect(await screen.findByText(/All selected mails are protected/))
        .toBeTruthy();
      expect(deleteMessages).not.toHaveBeenCalled();
    });

    it("mark as read is non-destructive: pinned mails need no confirmation",
      async () => {
      renderPanel([mkMail(1, { pinned: true, seen: false }), mkMail(2)]);
      await waitFor(() => screen.getByText("Mail 1"));
      fireEvent.click(checkbox(0));
      fireEvent.change(await screen.findByDisplayValue("Action…"),
        { target: { value: "mark_read" } });
      expect((await findDialog()).textContent).not.toMatch(/protected/);
      await pressDialog("Mark as read (1)");
      await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
        [["INBOX", 1]], "mark_read", "", false));
    });

    it("'Protect all mails in this group' pins the whole group and "
      + "reloads its mails", async () => {
      const onDeleted = vi.fn();
      pinGroup.mockResolvedValue({ ok: true, pinned: true, changed: 2,
        skipped: 1 });
      renderPanel([mkMail(1), mkMail(2)], { onDeleted });
      await waitFor(() => screen.getByText("Mail 1"));
      group_.mockResolvedValue([mkMail(1, { pinned: true }),
        mkMail(2, { pinned: true })]);
      fireEvent.click(await screen.findByLabelText("More"));
      expect(screen.queryByText("Remove protection from all mails")).toBeNull();
      fireEvent.click(screen.getByText("Protect all mails in this group"));
      await waitFor(() => expect(pinGroup).toHaveBeenCalledWith(
        "sender", "s@x.example", true));
      await waitFor(() =>
        expect(document.querySelectorAll("[data-pinned]").length).toBe(2));
      expect(screen.getByText(/1 mail without a Message-ID/))
        .toBeTruthy();
      expect(onDeleted).toHaveBeenCalled();
    });

    it("removing the protection of the whole group asks first", async () => {
      pinGroup.mockResolvedValue({ ok: true, pinned: false, changed: 1,
        skipped: 0 });
      renderPanel([mkMail(1, { pinned: true }), mkMail(2)]);
      await waitFor(() => screen.getByText("Mail 1"));
      fireEvent.click(await screen.findByLabelText("More"));
      // some mails are unpinned -> both entries are offered
      expect(screen.getByText("Protect all mails in this group")).toBeTruthy();
      fireEvent.click(screen.getByText("Remove protection from all mails"));
      await cancelDialog();
      await expectNoDialog();
      expect(pinGroup).not.toHaveBeenCalled();

      fireEvent.click(screen.getByLabelText("More"));
      fireEvent.click(screen.getByText("Remove protection from all mails"));
      await pressDialog("Remove protection");
      await waitFor(() => expect(pinGroup).toHaveBeenCalledWith(
        "sender", "s@x.example", false));
    });

    it("the whole-group entry is hidden once every mail is protected",
      async () => {
      renderPanel([mkMail(1, { pinned: true }), mkMail(2, { pinned: true })]);
      await waitFor(() => screen.getByText("Mail 1"));
      fireEvent.click(await screen.findByLabelText("More"));
      expect(screen.queryByText("Protect all mails in this group")).toBeNull();
      expect(screen.getByText("Remove protection from all mails")).toBeTruthy();
    });
  });

  it("thread groups offer 'Read conversation' (newest mail first); other "
    + "groupings do not", async () => {
    thread.mockResolvedValue({ key: "k", label: "Plan", notes: [],
      mails: [mkMail(1), mkMail(2)] });
    renderPanel([mkMail(2), mkMail(1)], { grouping: "thread" });
    await waitFor(() => screen.getByText("Mail 1"));
    fireEvent.click(await screen.findByLabelText("More"));
    fireEvent.click(screen.getByText("Read conversation"));
    await waitFor(() => expect(thread).toHaveBeenCalledWith("INBOX", 2));
    await screen.findByText("2 mails");
    fireEvent.click(screen.getByText("back to list"));
    await screen.findByText("Mail 1");          // back on the group's list
  });

  it("a sender group has no 'Read conversation' entry", async () => {
    renderPanel([mkMail(1)]);
    await waitFor(() => screen.getByText("Mail 1"));
    fireEvent.click(await screen.findByLabelText("More"));
    expect(screen.queryByText("Read conversation")).toBeNull();
  });
});
