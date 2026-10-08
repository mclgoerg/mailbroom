// @vitest-environment jsdom
/* Settings: local index status + build/update/rebuild/cancel/delete. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { IndexPanel } from "./components/IndexPanel";
import { DialogProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog }
  from "./dialogTestUtils";
import type { IndexInfo } from "./types";

const indexInfo = vi.fn();
const indexBuild = vi.fn();
const indexDelete = vi.fn();
const indexCancel = vi.fn();

vi.mock("./api", () => ({
  api: {
    indexInfo: (...a: unknown[]) => indexInfo(...a),
    indexBuild: (...a: unknown[]) => indexBuild(...a),
    indexDelete: (...a: unknown[]) => indexDelete(...a),
    indexCancel: (...a: unknown[]) => indexCancel(...a),
  },
}));

const MB = 1048576;
const est = (mails: number, over = {}) => ({
  mails, bytes: mails * 6144, bytes_max: mails * 12288, free: 500 * MB,
  ...over });

const info = (over: Partial<IndexInfo> = {}): IndexInfo => ({
  mode: "local", secret_key_set: true, exists: false, usable: false,
  reason: "index_missing", docs: 0, built_ts: null, bytes: 0,
  estimate: est(1000), estimate_full: est(1000),
  job: { status: "idle", progress: "", error: "", done: 0, total: 0 },
  ...over,
});

beforeEach(() => {
  indexBuild.mockResolvedValue({ ok: true });
  indexDelete.mockResolvedValue({ ok: true });
  indexCancel.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  indexInfo.mockReset();
  indexBuild.mockReset();
  indexDelete.mockReset();
  indexCancel.mockReset();
});

const renderPanel = (over: Partial<Parameters<typeof IndexPanel>[0]> = {}) =>
  render(<DialogProvider><IndexPanel account="proton" savedMode="local"
    secretKeySet {...over} /></DialogProvider>);

test("without MAILBROOM_SECRET_KEY it only explains and never calls the API",
  () => {
    renderPanel({ secretKeySet: false });
    expect(screen.getByText(/needs MAILBROOM_SECRET_KEY/)).toBeTruthy();
    expect(indexInfo).not.toHaveBeenCalled();
  });

test("the mode must be saved as local before an index can be built", () => {
  renderPanel({ savedMode: "server" });
  expect(screen.getByText(/Save the settings first/)).toBeTruthy();
  expect(indexInfo).not.toHaveBeenCalled();
});

test("first build asks for consent, then starts the job", async () => {
  indexInfo.mockResolvedValue(info());
  renderPanel();
  await screen.findByText("No index built yet.");
  expect(indexInfo).toHaveBeenCalledWith("proton");
  expect(screen.queryByText("Rebuild")).toBeNull();
  fireEvent.click(screen.getByText("Build index"));
  const asked = (await findDialog()).textContent as string;
  expect(asked).toMatch(/no readable text/);
  // the storage the user is agreeing to, up front
  expect(asked).toContain("1000 scanned mails");
  expect(asked).toContain("roughly 5.9 MB of disk space");
  expect(asked).toContain("up to 11.7 MB");
  expect(asked).toContain("500.0 MB are free");
  expect(asked).not.toContain("may not fit");
  expect(indexBuild).not.toHaveBeenCalled();     // nothing starts before OK
  await pressDialog("Build index");
  await waitFor(() => expect(indexBuild).toHaveBeenCalledWith("proton", false));
});

test("the estimate is shown before the button is pressed", async () => {
  indexInfo.mockResolvedValue(info());
  renderPanel();
  await screen.findByText(
    /Estimated disk space: about 5\.9 MB for 1000 mails \(up to 11\.7 MB/);
  expect(screen.getByText(/500\.0 MB free on the data volume/)).toBeTruthy();
});

test("a build that may not fit warns in the prompt and in the panel",
  async () => {
    indexInfo.mockResolvedValue(info({ estimate: est(100000, {
      free: 100 * MB }) }));
    renderPanel();
    await screen.findByText(/Estimated disk space/);
    expect(screen.getByText(/may not fit on the data volume/)).toBeTruthy();
    fireEvent.click(screen.getByText("Build index"));
    expect((await findDialog()).textContent)
      .toContain("Warning: that may not fit");
  });

test("nothing to read means nothing to consent to", async () => {
  indexInfo.mockResolvedValue(info({ exists: true, usable: true,
    reason: null, docs: 5, built_ts: 1790000000, estimate: est(0) }));
  renderPanel();
  fireEvent.click(await screen.findByText("Update now"));
  await waitFor(() => expect(indexBuild).toHaveBeenCalledWith("proton", false));
  await expectNoDialog();
  expect(screen.queryByText(/Estimated disk space/)).toBeNull();
});

test("rebuild is estimated for every scanned mail", async () => {
  indexInfo.mockResolvedValue(info({ exists: true, usable: true,
    reason: null, docs: 5, built_ts: 1790000000, estimate: est(0),
    estimate_full: est(2000) }));
  renderPanel();
  fireEvent.click(await screen.findByText("Rebuild"));
  expect((await findDialog()).textContent).toContain("2000 scanned mails");
  await pressDialog("Rebuild");
  await waitFor(() => expect(indexBuild).toHaveBeenLastCalledWith(
    "proton", true));
});

test("declining the consent starts nothing", async () => {
  indexInfo.mockResolvedValue(info());
  renderPanel();
  fireEvent.click(await screen.findByText("Build index"));
  await cancelDialog();
  await expectNoDialog();
  expect(indexBuild).not.toHaveBeenCalled();
});

test("a usable index shows its size, offers update/rebuild/delete", async () => {
  indexInfo.mockResolvedValue(info({ exists: true, usable: true, reason: null,
    docs: 1531, bytes: 3 * 1048576, built_ts: 1790000000 }));
  renderPanel();
  await screen.findByText(/1531 mails indexed, last updated/);
  expect(screen.getByText("Disk space used: 3.0 MB")).toBeTruthy();
  fireEvent.click(screen.getByText("Update now"));
  await pressDialog("Update now");
  await waitFor(() => expect(indexBuild).toHaveBeenCalledWith("proton", false));
  fireEvent.click(screen.getByText("Rebuild"));
  await pressDialog("Rebuild");
  await waitFor(() => expect(indexBuild).toHaveBeenLastCalledWith(
    "proton", true));
  fireEvent.click(screen.getByText("Delete index"));
  await pressDialog("Delete index");
  await waitFor(() => expect(indexDelete).toHaveBeenCalledWith("proton"));
});

test("a running job shows progress and can be cancelled", async () => {
  indexInfo.mockResolvedValue(info({ exists: true, bytes: 512 * 1024,
    job: { status: "running", progress: "40/120", error: "", done: 40,
      total: 120 } }));
  renderPanel();
  await screen.findByText(/Indexing… 40\/120 \(33%\)/);
  expect(screen.getByText("Disk space used: 512 KB")).toBeTruthy();
  const bar = screen.getByRole("progressbar");
  expect(bar.getAttribute("aria-valuenow")).toBe("40");
  expect(bar.getAttribute("aria-valuemax")).toBe("120");
  expect((bar.firstElementChild as HTMLElement).style.width).toBe("33%");
  expect(screen.queryByText("Build index")).toBeNull();
  fireEvent.click(screen.getByText("cancel"));
  await waitFor(() => expect(indexCancel).toHaveBeenCalledWith("proton"));
});

test("an index built under another key says it must be rebuilt", async () => {
  indexInfo.mockResolvedValue(info({ exists: true, reason: "index_key" }));
  renderPanel();
  await screen.findByText(/different secret key/);
  // an unusable index still occupies space - and can be deleted
  expect(screen.getByText("Disk space used: 0 B")).toBeTruthy();
  expect(screen.getByText("Delete index")).toBeTruthy();
});

test("API errors are shown", async () => {
  indexInfo.mockResolvedValue(info());
  indexBuild.mockRejectedValue(new Error("busy"));
  renderPanel();
  fireEvent.click(await screen.findByText("Build index"));
  await pressDialog("Build index");
  await screen.findByText("busy");
});

test("before the total is known the bar is empty, not NaN", async () => {
  indexInfo.mockResolvedValue(info({ exists: true,
    job: { status: "running", progress: "connecting…", error: "", done: 0,
      total: 0 } }));
  renderPanel();
  await screen.findByText(/Indexing… connecting…/);
  const bar = screen.getByRole("progressbar");
  expect(bar.hasAttribute("aria-valuenow")).toBe(false);
  expect((bar.firstElementChild as HTMLElement).style.width).toBe("0%");
});

test("large volumes are shown in GB, not thousands of MB", async () => {
  indexInfo.mockResolvedValue(info({ estimate: est(100000, {
    free: 64 * 1024 * MB }) }));
  renderPanel();
  await screen.findByText(/64\.0 GB free on the data volume/);
  expect(screen.getByText(/about 585\.9 MB for 100000 mails \(up to 1\.1 GB/))
    .toBeTruthy();
});

test("cancelling the delete confirmation keeps the index", async () => {
  indexInfo.mockResolvedValue(info({ exists: true, usable: true, reason: null,
    docs: 5, built_ts: 1790000000 }));
  renderPanel();
  fireEvent.click(await screen.findByText("Delete index"));
  await cancelDialog();
  await expectNoDialog();
  expect(indexDelete).not.toHaveBeenCalled();
});
