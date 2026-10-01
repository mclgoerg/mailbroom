// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "./i18n";
import type { Group, Mail } from "./types";

const group_ = vi.fn();
const deleteMessages = vi.fn().mockResolvedValue({});

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      group: (...args: unknown[]) => group_(...args),
      deleteMessages: (...args: unknown[]) => deleteMessages(...args),
      aiGroup: vi.fn(),
      unsubscribe: vi.fn(),
      unsubscribeAck: vi.fn(),
    },
  };
});

import { DetailPanel } from "./components/DetailPanel";

const mkMail = (uid: number, over: Partial<Mail> = {}): Mail => ({
  uid, folder: "INBOX", date: "2025-01-01", ts: 0,
  subject: `Mail ${uid}`, addr: "s@x.example", size: 1000,
  seen: true, ai: null, ...over,
});

const mkGroup = (over: Partial<Group> = {}): Group => ({
  key: "s@x.example", label: "Sender", sub: "s@x.example",
  count: 2, size: 2000, unread: 0, first: "2025-01-01", last: "2025-01-02",
  tags: [], samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null, ...over,
});

const noop = () => {};
const noopAsync = async () => true;

function renderPanel(mails: Mail[], extra: Partial<Parameters<
    typeof DetailPanel>[0]> = {}) {
  group_.mockResolvedValue(mails);
  return render(
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
    />,
  );
}

describe("DetailPanel", () => {
  beforeEach(() => {
    setLang("en");
    group_.mockClear();
    deleteMessages.mockClear();
    vi.spyOn(window, "confirm").mockReturnValue(true);
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
    await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
      [["INBOX", 1]], "trash", ""));
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

  it("the whole-group Trash button closes the panel once it resolves true",
    async () => {
    const onTrash = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    renderPanel([mkMail(1)], { onTrash, onClose });
    await waitFor(() => screen.getByText("Mail 1"));
    fireEvent.click(screen.getByText("Trash"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onTrash).toHaveBeenCalled();
  });
});
