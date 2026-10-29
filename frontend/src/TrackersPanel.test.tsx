// @vitest-environment jsdom
/* Tools -> Trackers: the states (no scan / no index / not checked yet /
 * partial coverage / data), the sender tap, "Check older mails" with its
 * confirm, and German. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TrackersPanel } from "./components/TrackersPanel";
import { DialogProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog }
  from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { TrackerReport } from "./types";

const trackers = vi.fn();
const indexBuild = vi.fn();

vi.mock("./api", () => ({
  api: {
    trackers: () => trackers(),
    indexBuild: (...a: unknown[]) => indexBuild(...a),
  },
  fmtSize: (b: number) => `${b} B`,
}));

const est = { mails: 40, bytes: 4000, bytes_max: 8000, free: 100000 };
const rep = (over: Partial<TrackerReport> = {}): TrackerReport => ({
  usable: true, reason: null, docs: 40, checked: 40, pixel: 25, click: 30,
  any: 32, senders: 2,
  top_senders: [
    { key: "news@shop.example", label: "Shop News", checked: 20,
      tracked: 18, pixel: 18, click: 20, hosts: ["pix.example"] },
    { key: "deals@promo.example", label: "Promo Deals", checked: 10,
      tracked: 1, pixel: 0, click: 1, hosts: [] },
  ],
  top_hosts: [{ host: "pix.example", mails: 18, senders: 1 },
    { host: "go.example", mails: 1, senders: 1 }],
  mode: "local", secret_key_set: true, scanned: true, estimate_full: est,
  job: { status: "idle", progress: "", error: "", done: 0, total: 0 },
  ...over,
});

const onPick = vi.fn();
const show = () => render(<DialogProvider>
  <TrackersPanel account="main" onClose={() => {}} onPickSender={onPick} />
</DialogProvider>);

beforeEach(() => setLang("en"));
afterEach(() => {
  cleanup();
  trackers.mockReset();
  indexBuild.mockReset();
  onPick.mockReset();
  setLang("en");
});

test("data: headline share, numbers, senders, hosts and the explainer",
  async () => {
    trackers.mockResolvedValue(rep());
    show();
    await screen.findByText("63% of the mails we checked carry a tracking "
      + "pixel");
    expect(screen.getByText(/Mailbroom never loads remote images/)).toBeTruthy();
    expect(screen.getByText("Checked 40 of 40 mails")).toBeTruthy();
    expect(screen.getByText("with tracking pixel")).toBeTruthy();
    expect(screen.getByText("Shop News")).toBeTruthy();
    expect(screen.getByText(/18 of 20 mails tracked · pix\.example/))
      .toBeTruthy();
    expect(screen.getByText("pix.example")).toBeTruthy();
    expect(screen.getByText(/18 mails · 1 sender$/)).toBeTruthy();
    // full coverage: nothing to check
    expect(screen.queryByRole("button", { name: "Check older mails" }))
      .toBeNull();
  });

test("tapping a sender hands its address to the caller", async () => {
  trackers.mockResolvedValue(rep());
  show();
  fireEvent.click(await screen.findByRole("button",
    { name: "Show mails from Shop News" }));
  expect(onPick).toHaveBeenCalledWith("news@shop.example");
});

test("no index: explains, offers the build behind the confirm", async () => {
  trackers.mockResolvedValue(rep({ usable: false, reason: "index_missing",
    docs: 0, checked: 0, top_senders: [], top_hosts: [] }));
  show();
  await screen.findByText("No body index yet");
  expect(screen.getByText(/detected while the local body index is built/))
    .toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Build the body index" }));
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("40 scanned mails");
  await cancelDialog();
  await expectNoDialog();
  expect(indexBuild).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Build the body index" }));
  await pressDialog("Build the body index");
  await waitFor(() => expect(indexBuild).toHaveBeenCalledWith("main", false));
});

test("no index and local mode off / no key: only the explanation",
  async () => {
    trackers.mockResolvedValue(rep({ usable: false, docs: 0, checked: 0,
      mode: "server", top_senders: [], top_hosts: [] }));
    show();
    await screen.findByText(/Switch mail-text search to/);
    expect(screen.queryByRole("button", { name: "Build the body index" }))
      .toBeNull();
  });

test("index without tracker rows: 'Not checked yet' + Check older mails",
  async () => {
    trackers.mockResolvedValue(rep({ checked: 0, pixel: 0, click: 0, any: 0,
      senders: 0, top_senders: [], top_hosts: [] }));
    show();
    await screen.findByText("Not checked yet");
    fireEvent.click(screen.getByRole("button", { name: "Check older mails" }));
    await pressDialog("Check older mails");
    await waitFor(() => expect(indexBuild).toHaveBeenCalledWith("main", true));
  });

test("partial coverage shows 'Checked N of M' and Check older mails "
  + "(cancel does nothing)", async () => {
  trackers.mockResolvedValue(rep({ docs: 100, checked: 40 }));
  show();
  await screen.findByText("Checked 40 of 100 mails");
  fireEvent.click(screen.getByRole("button", { name: "Check older mails" }));
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("tracking pixels and click-tracking");
  await cancelDialog();
  await expectNoDialog();
  expect(indexBuild).not.toHaveBeenCalled();
});

test("a running job shows progress instead of the report", async () => {
  trackers.mockResolvedValue(rep({
    job: { status: "running", progress: "5/40", error: "", done: 5,
      total: 40 } }));
  show();
  await screen.findAllByText(/Checking mails/);
  expect(screen.queryByText("Shop News")).toBeNull();
});

test("no scan yet", async () => {
  trackers.mockResolvedValue(rep({ scanned: false, usable: false }));
  show();
  await screen.findByText("Scan your mailbox first");
});

test("checked mails without any tracking say so", async () => {
  trackers.mockResolvedValue(rep({ pixel: 0, click: 0, any: 0, senders: 0,
    top_senders: [], top_hosts: [] }));
  show();
  await screen.findByText("No tracking pixels found in the mails we checked");
  expect(screen.getByText("No tracking found in the 40 checked mails."))
    .toBeTruthy();
});

test("German", async () => {
  setLang("de");
  trackers.mockResolvedValue(rep());
  show();
  await screen.findByText("63 % der geprüften Mails enthalten ein "
    + "Tracking-Pixel");
  expect(screen.getByText("40 von 40 Mails geprüft")).toBeTruthy();
  expect(screen.getByText("Absender mit dem meisten Tracking")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Mails von Shop News anzeigen" }))
    .toBeTruthy();
});
