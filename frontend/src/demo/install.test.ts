// @vitest-environment jsdom
/* The fetch intercept, driven through the UI's real call sites (api.ts and
 * the backup upload shape of SettingsModal) against a fake worker. */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, downloadFile } from "../api";
import { fakeRuntime, type FakeWorker } from "./fakeWorker";
import { installDemo } from "./install";

const realFetch = window.fetch;
const RealES = (window as unknown as { EventSource: unknown }).EventSource;
let passthrough: ReturnType<typeof vi.fn>;
let w: FakeWorker;
let runtime: ReturnType<typeof fakeRuntime>["runtime"];

beforeEach(() => {
  passthrough = vi.fn(async () => new Response("outside"));
  window.fetch = passthrough as unknown as typeof fetch;
  const f = fakeRuntime();
  runtime = f.runtime;
  runtime.start();
  w = f.last();
  w.emit({ type: "ready", clockShiftMs: 0 });
  installDemo(runtime);
});
afterEach(() => {
  window.fetch = realFetch;
  (window as unknown as { EventSource: unknown }).EventSource = RealES;
  vi.restoreAllMocks();
});

const json = (o: unknown): [number, [string, string][], string] =>
  [200, [["Content-Type", "application/json"]], JSON.stringify(o)];

test("req(): GET json with the query string, POST json with a body", async () => {
  w.answer = (m) => m.method === "GET" ? json({ build: "demo" }) : json({ id: "p1" });
  expect(await api.version()).toEqual({ build: "demo" });
  const created = await api.createPreset("Old", "age:>1y");
  expect(created).toEqual({ id: "p1" });

  const [get, post] = w.requests;
  expect(get).toMatchObject({ method: "GET", path: "/api/version", body: null });
  expect(post).toMatchObject({ method: "POST", path: "/api/presets" });
  expect(JSON.parse(post.body as string)).toEqual({ name: "Old", query: "age:>1y" });
  expect(post.headers["content-type"]).toBe("application/json");
  expect(passthrough).not.toHaveBeenCalled();
});

test("query strings are split off the path (and not re-encoded)", async () => {
  await fetch("/api/search?q=a%20b&scope=body");
  expect(w.requests[0]).toMatchObject({ path: "/api/search",
    query: "q=a%20b&scope=body" });
});

test("a blob download keeps the bytes and Content-Disposition", async () => {
  w.answer = () => [200, [["content-type", "text/csv"],
    ["Content-Disposition", 'attachment; filename="senders.csv"']], "a,b\n1,2\n"];
  const saved: { name: string; blob: Blob }[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
    saved.push({ name: "", blob: b as Blob }); return "blob:x";
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      saved[0].name = this.download;
    });
  await downloadFile("/api/export?grouping=sender");
  expect(click).toHaveBeenCalled();
  expect(saved[0].name).toBe("senders.csv");
  expect(await saved[0].blob.text()).toBe("a,b\n1,2\n");
});

test("DELETE (rules, presets) carries the method and a 204 has no body", async () => {
  w.answer = () => [204, [], ""];
  await api.deleteRule("r1");
  await api.deletePreset("p1");
  expect(w.requests.map((m) => [m.method, m.path]))
    .toEqual([["DELETE", "/api/rules/r1"], ["DELETE", "/api/presets/p1"]]);
});

test("the backup upload (a JSON body posted by hand) arrives intact", async () => {
  const backup = { rules: [{ id: "r" }], note: "ä€" };
  const res = await fetch("/api/import_config", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(backup) });
  expect(res.ok).toBe(true);
  expect(JSON.parse(w.requests[0].body as string)).toEqual(backup);
});

test("a binary body reaches the worker as bytes", async () => {
  await fetch("/api/x", { method: "POST", body: new Uint8Array([1, 2, 3]) });
  expect([...(w.requests[0].body as Uint8Array)]).toEqual([1, 2, 3]);
});

test("backend errors pass through as responses (a 500 is not a crash)", async () => {
  w.answer = () => [500, [["content-type", "text/plain"]], "Internal Server Error"];
  const res = await fetch("/api/state");
  expect(res.status).toBe(500);
  expect(await res.text()).toBe("Internal Server Error");
});

test("anything that is not /api/ goes to the real fetch", async () => {
  await fetch("/demo/icon.svg");
  await fetch("https://elsewhere.example/api/state");
  expect(passthrough).toHaveBeenCalledTimes(2);
  expect(w.requests).toHaveLength(0);
});

test("EventSource throws, so App falls back to polling", () => {
  const ES = (window as unknown as { EventSource: new (u: string) => unknown })
    .EventSource;
  expect(() => new ES("/api/events")).toThrow();
});

test("without a ready backend a call fails like a network error", async () => {
  runtime.start();                              // reset: booting again
  await expect(fetch("/api/state")).rejects.toThrow(TypeError);
});
