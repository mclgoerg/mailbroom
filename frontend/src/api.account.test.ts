// @vitest-environment jsdom
/* Calls made for the account being edited in Settings carry that account
 * explicitly - never the active one that `withAccount` would add. */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, setAccount } from "./api";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  vi.stubGlobal("fetch", fetchMock);
  setAccount("active");
});
afterEach(() => { fetchMock.mockReset(); setAccount(""); });

const urls = () => fetchMock.mock.calls.map((c) => c[0] as string);

test("folder-picker calls name the edited account, not the active one",
  async () => {
    await api.setFolderRole("trash", "Trash", "edited");
    await api.lookalike("Deleted Items", "edited");
    await api.moveLookalike("Deleted Items", 1, 2, "edited");
    await api.undo(-1, { ts: 1, label: "x", count: 1 }, "edited");
    expect(urls()).toEqual([
      "/api/folders/role?account=edited",
      "/api/folders/lookalike?folder=Deleted%20Items&account=edited",
      "/api/folders/move_contents?account=edited",
      "/api/undo?account=edited"]);
  });

test("without an explicit account the active one is used", async () => {
  await api.setFolderRole("trash", "Trash");
  await api.lookalike("A");
  expect(urls()).toEqual(["/api/folders/role?account=active",
    "/api/folders/lookalike?folder=A&account=active"]);
});

test("an account name is URL-encoded", async () => {
  await api.setFolderRole("trash", "Trash", "me & you");
  expect(urls()).toEqual(["/api/folders/role?account=me%20%26%20you"]);
});
