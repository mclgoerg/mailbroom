// @vitest-environment jsdom
/* Unsubscribe watchdog in the detail view: the warning notice carries the
 * numbers and a Block button that runs the existing block flow. */
import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "./i18n";
import type { Group } from "./types";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { group: () => Promise.resolve([]),
    unsubscribe: vi.fn(), unsubscribeAck: vi.fn() } };
});

import { DetailPanel } from "./components/DetailPanel";
import { DialogProvider, StillMailingBadge } from "./components/ui";

const SINCE = Date.UTC(2025, 9, 3, 12) / 1000;

const mkGroup = (over: Partial<Group> = {}): Group => ({
  key: "s@x.example", label: "Sender", sub: "s@x.example",
  count: 6, size: 2000, unread: 0, first: "2025-01-01", last: "2025-01-02",
  tags: [], samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
  new: false, pinned: 0, engagement: 50,
  still_mailing: { n: 4, senders: 1, since_ts: SINCE,
    addrs: ["s@x.example"] }, ...over,
});

const noop = () => {};

function renderPanel(group: Group, extra: Partial<Parameters<
    typeof DetailPanel>[0]> = {}) {
  return render(<DialogProvider>
    <DetailPanel grouping="sender" group={group} aiEnabled={false}
      protectedNow={false} unsubscribedNow={null}
      onTrash={async () => true} folders={[]} sieve={false}
      onClose={noop} onDeleted={noop} {...extra} />
  </DialogProvider>);
}

describe("still-mailing notice", () => {
  beforeEach(() => setLang("en"));
  afterEach(cleanup);

  it("shows the numbers and Block runs the block flow", async () => {
    const onBlock = vi.fn();
    renderPanel(mkGroup(), { onBlock });
    const notice = (await screen.findByText(
      "Still mailing after you unsubscribed")).closest("[role=status]")!;
    expect(notice.textContent)
      .toContain("4 mails since you unsubscribed on 3 Oct");
    // (the footer's own Block button is the same flow, so scope to the notice)
    fireEvent.click(within(notice as HTMLElement)
      .getByRole("button", { name: /Block sender/ }));
    expect(onBlock).toHaveBeenCalledTimes(1);
    expect(onBlock.mock.calls[0][0].key).toBe("s@x.example");
  });

  it("offers no Block button for a protected / blocked / non-sender row",
    async () => {
    // blocked already
    renderPanel(mkGroup(), { onBlock: vi.fn(), blocked: true });
    await screen.findByText("Still mailing after you unsubscribed");
    expect(within(screen.getByText(
      "Still mailing after you unsubscribed").closest("[role=status]") as
      HTMLElement).queryByRole("button")).toBeNull();
    cleanup();
    // a domain row: the senders are listed instead
    renderPanel(mkGroup({ key: "x.example",
      still_mailing: { n: 7, senders: 2, since_ts: SINCE,
        addrs: ["a@x.example", "b@x.example"] } }),
      { grouping: "domain", onBlock: vi.fn() });
    const notice = (await screen.findByText(
      "Still mailing after you unsubscribed")).closest("[role=status]")!;
    expect(notice.textContent).toContain("a@x.example, b@x.example");
    expect(notice.textContent).toContain("7 mails from 2 senders");
    expect(within(notice as HTMLElement).queryByRole("button")).toBeNull();
  });

  it("is absent for a group nobody is still mailing from", async () => {
    renderPanel(mkGroup({ still_mailing: null }));
    await waitFor(() => expect(screen.getByText("Sender")).toBeTruthy());
    expect(screen.queryByText(/Still mailing after/)).toBeNull();
  });

  it("speaks German", async () => {
    setLang("de");
    renderPanel(mkGroup({ still_mailing: { n: 1, senders: 1,
      since_ts: SINCE, addrs: [] } }), { onBlock: vi.fn() });
    const notice = (await screen.findByText(
      "Schreibt nach dem Abbestellen weiter")).closest("[role=status]")!;
    expect(notice.textContent).toContain("1 Mail, seit du am 3. Okt");
    expect(within(notice as HTMLElement)
      .getByRole("button", { name: /Absender blockieren/ })).toBeTruthy();
  });
});

describe("StillMailingBadge", () => {
  beforeEach(() => setLang("en"));
  afterEach(cleanup);

  it("is a button whose popover holds the text (not hover-only)", () => {
    render(<StillMailingBadge sm={{ n: 1, senders: 1, since_ts: SINCE,
      addrs: [] }} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("dialog").textContent)
      .toContain("1 mail since you unsubscribed on 3 Oct");
  });
});
