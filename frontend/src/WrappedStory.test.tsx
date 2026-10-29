// @vitest-environment jsdom
/* Your year in mail: tap zones / keys / Esc navigation, auto-advance (and
 * its reduced-motion opt-out), cards without data skipped, year switch
 * refetches, the saved image masks names unless toggled, German. */

import { act, cleanup, fireEvent, render, screen }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { WrappedStory, CARD_MS, cardsFor } from "./components/WrappedStory";
import { setLang } from "./i18n";
import type { WrappedResp } from "./types";

const base: WrappedResp = {
  year: 2026, partial: true, years: [2025, 2026],
  received: { mails: 18402, bytes: 5, senders: 120, read: 9201,
    new_senders: 30 },
  top_senders: [
    { label: "Shop News", addr: "news@shop.example", mails: 900, bytes: 5000 },
    { label: "Ann", addr: "ann@friends.example", mails: 40, bytes: 100 }],
  loudest_month: { month: 3, mails: 2000 },
  busiest_weekday: { weekday: 1, mails: 3000 },
  busiest_hour: { hour: 9, mails: 1500 },
  biggest: { label: "Shop News", addr: "news@shop.example", bytes: 9000000 },
  ghosts: { count: 4, top: [
    { label: "Quiet Co", addr: "q@quiet.example", mails: 33, bytes: 1 }] },
  cleanup: { trashed: 10, archived: 5, purged: 2, freed_bytes: 2048,
    unsubscribes: 3, rule_runs: 2,
    top_rule: { name: "", deleted: true, mails: 7 } },
};
let resp: WrappedResp = base;
const wrapped = vi.fn((_year?: number) => Promise.resolve(resp));
const saveBlob = vi.fn();
const svgToPngBlob = vi.fn((_svg: string) =>
  Promise.resolve(new Blob(["png"])));
vi.mock("./api", () => ({
  api: { wrapped: (y?: number) => wrapped(y) },
  fmtSize: (n: number) => `${n} B`,
  saveBlob: (...a: unknown[]) => saveBlob(...a),
}));
vi.mock("./wrapped", async (orig) => ({
  ...(await orig<typeof import("./wrapped")>()),
  svgToPngBlob: (svg: string) => svgToPngBlob(svg),
}));

const flush = () => act(async () => { await Promise.resolve(); });
const zone = (side: "left" | "right") => document.querySelector<HTMLElement>(
  `button[aria-hidden].${side}-0`)!;
const open = async () => {
  render(<WrappedStory onClose={onClose} />);
  await screen.findByText("You received");
};
const onClose = vi.fn();

beforeEach(() => { resp = base; });
afterEach(() => {
  cleanup(); setLang("en"); vi.useRealTimers(); vi.unstubAllGlobals();
  for (const f of [wrapped, saveBlob, svgToPngBlob, onClose]) f.mockClear();
});

test("cards without data are skipped", () => {
  const sparse: WrappedResp = { ...base, loudest_month: null,
    ghosts: { count: 0, top: [] }, biggest: null,
    cleanup: { ...base.cleanup, trashed: 0, archived: 0, purged: 0,
      unsubscribes: 0, rule_runs: 0, top_rule: null } };
  expect(cardsFor(base)).toEqual(["intro", "senders", "loudest", "month",
    "rhythm", "ghosts", "biggest", "cleanup", "summary"]);
  expect(cardsFor(sparse)).toEqual(["intro", "senders", "loudest", "rhythm",
    "summary"]);
  expect(cardsFor({ ...base, received: { ...base.received, mails: 0 } }))
    .toEqual(["intro"]);
});

test("tap zones, arrow keys and Esc", async () => {
  await open();
  expect(screen.getByText("18,402")).toBeTruthy();
  fireEvent.click(zone("right"));
  expect(screen.getByText("They came from")).toBeTruthy();
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(screen.getByText("Your loudest sender")).toBeTruthy();
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  expect(screen.getByText("They came from")).toBeTruthy();
  fireEvent.click(zone("left"));
  expect(screen.getByText("You received")).toBeTruthy();
  // back on the first card stays there
  fireEvent.click(zone("left"));
  expect(screen.getByText("You received")).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
});

test("the visible Next / Previous buttons work too", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Next card" }));
  expect(screen.getByText("They came from")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Previous card" }));
  expect(screen.getByText("You received")).toBeTruthy();
});

test("cards auto-advance; the intro and summary wait; hold pauses",
  async () => {
    vi.useFakeTimers();
    render(<WrappedStory onClose={onClose} />);
    await flush();
    // intro waits for the user
    act(() => { vi.advanceTimersByTime(CARD_MS * 2); });
    expect(screen.getByText("You received")).toBeTruthy();
    fireEvent.click(zone("right"));
    act(() => { vi.advanceTimersByTime(CARD_MS + 200); });
    expect(screen.getByText("Your loudest sender")).toBeTruthy();
    // holding pauses
    fireEvent.pointerDown(zone("right"));
    act(() => { vi.advanceTimersByTime(300); });
    act(() => { vi.advanceTimersByTime(CARD_MS * 2); });
    expect(screen.getByText("Your loudest sender")).toBeTruthy();
    fireEvent.pointerUp(zone("right"));
    fireEvent.click(zone("right"));         // the release is not a tap
    expect(screen.getByText("Your loudest sender")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(CARD_MS + 200); });
    expect(screen.getByText("The month that buried you")).toBeTruthy();
    // it stops on the last card
    for (let i = 0; i < 8; i++) {
      act(() => { vi.advanceTimersByTime(CARD_MS + 200); });
    }
    expect(screen.getByText("Your year at a glance")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(CARD_MS * 3); });
    expect(screen.getByText("Your year at a glance")).toBeTruthy();
  });

test("reduced motion turns auto-advance off", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("reduce"), media: q, addEventListener() {},
    removeEventListener() {} }));
  vi.useFakeTimers();
  render(<WrappedStory onClose={onClose} />);
  await flush();
  fireEvent.click(zone("right"));
  act(() => { vi.advanceTimersByTime(CARD_MS * 5); });
  expect(screen.getByText("They came from")).toBeTruthy();
});

test("switching the year refetches and returns to the first card",
  async () => {
    await open();
    expect(wrapped).toHaveBeenLastCalledWith(undefined);
    resp = { ...base, year: 2025, partial: false,
      received: { ...base.received, mails: 777 } };
    fireEvent.change(screen.getByLabelText("Year"),
      { target: { value: "2025" } });
    await screen.findByText("777");
    expect(wrapped).toHaveBeenLastCalledWith(2025);
    expect(screen.getByText("mails in 2025")).toBeTruthy();
  });

test("a year without mail shows only the intro", async () => {
  resp = { ...base, received: { ...base.received, mails: 0 } };
  await open();
  expect(screen.getByText("No mail from 2026 in your mailbox.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Next card" })).toHaveProperty(
    "disabled", true);
});

test("Save image: names are masked unless 'Show names' is on", async () => {
  await open();
  for (let i = 0; i < 8; i++) fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(screen.getByText("Your year at a glance")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save image" }));
  await flush();
  expect(svgToPngBlob).toHaveBeenCalledTimes(1);
  const hidden = svgToPngBlob.mock.calls[0][0];
  expect(hidden).not.toContain("news@shop.example");
  expect(hidden).not.toContain("Shop News");
  expect(hidden).toContain("n...@...example");
  expect(saveBlob).toHaveBeenCalledWith("mailbroom-wrapped-2026.png",
    expect.any(Blob));
  fireEvent.click(screen.getByLabelText("Show names"));
  fireEvent.click(screen.getByRole("button", { name: "Save image" }));
  await flush();
  expect(svgToPngBlob.mock.calls[1][0]).toContain("Shop News");
});

test("German", async () => {
  setLang("de");
  render(<WrappedStory onClose={onClose} />);
  await screen.findByText("Du hast erhalten");
  expect(screen.getByText("Mails bisher in 2026")).toBeTruthy();
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(screen.getByText("Gesendet von")).toBeTruthy();
});
