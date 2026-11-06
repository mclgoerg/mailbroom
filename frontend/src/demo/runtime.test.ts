// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { nowMs, setClockShift } from "../clock";
import { fakeRuntime } from "./fakeWorker";
import { STALL_MS } from "./runtime";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); setClockShift(0); });

test("starts the worker with the bundle URL and reports each step", () => {
  const { runtime, last } = fakeRuntime();
  runtime.start();
  expect(last().sent[0]).toEqual({ type: "boot",
    bundle: "http://localhost/demo/bundle/" });
  expect(runtime.getState()).toMatchObject({ phase: "booting",
    step: "download", done: [] });

  last().emit({ type: "progress", step: "download", done: 5e6, total: 20e6,
    wire: 8e6 });
  expect(runtime.getState()).toMatchObject({ step: "download", mb: 2,
    totalMb: 8 });

  last().emit({ type: "progress", step: "libraries" });
  expect(runtime.getState()).toMatchObject({ step: "libraries",
    done: ["download", "python"] });

  last().emit({ type: "ready", clockShiftMs: 0 });
  expect(runtime.getState()).toEqual({ phase: "ready" });
});

test("ready shifts the page's clock; a reset boot replaces the shift", () => {
  const { runtime, last } = fakeRuntime();
  runtime.start();
  const day = 86400e3;
  last().emit({ type: "ready", clockShiftMs: 90 * day });
  expect(Date.now() - nowMs()).toBe(90 * day);
  runtime.start();
  last().emit({ type: "ready", clockShiftMs: 91 * day });
  expect(Date.now() - nowMs()).toBe(91 * day);
});

test("a fatal worker error is a failure", () => {
  const { runtime, last } = fakeRuntime();
  runtime.start();
  const w = last();
  w.emit({ type: "fatal", error: "boom" });
  expect(runtime.getState()).toEqual({ phase: "failed", reason: "error" });
  expect(w.terminated).toBe(true);
});

test("a worker that cannot load (onerror) is a failure", () => {
  const { runtime, last } = fakeRuntime();
  runtime.start();
  last().onerror?.({});
  expect(runtime.getState()).toEqual({ phase: "failed", reason: "error" });
});

test("a browser without WebAssembly / module workers fails up front", () => {
  const { runtime, made } = fakeRuntime({ supported: () => false });
  runtime.start();
  expect(runtime.getState()).toEqual({ phase: "failed", reason: "unsupported" });
  expect(made).toHaveLength(0);
});

test("a step that stalls surfaces as a failure, progress keeps it alive", () => {
  const { runtime, last } = fakeRuntime();
  runtime.start();
  const w = last();
  vi.advanceTimersByTime(STALL_MS.download - 1);
  w.emit({ type: "progress", step: "download", done: 1, total: 10, wire: 5 });
  vi.advanceTimersByTime(STALL_MS.download - 1);
  expect(runtime.getState().phase).toBe("booting");
  vi.advanceTimersByTime(2);
  expect(runtime.getState()).toEqual({ phase: "failed", reason: "stalled" });
  expect(w.terminated).toBe(true);
});

test("a finished boot no longer times out", () => {
  const { runtime, last } = fakeRuntime();
  runtime.start();
  last().emit({ type: "ready", clockShiftMs: 0 });
  vi.advanceTimersByTime(10 * 60e3);
  expect(runtime.getState()).toEqual({ phase: "ready" });
});

test("retry boots a fresh worker and drops the old one", () => {
  const { runtime, made } = fakeRuntime();
  runtime.start();
  made[0].emit({ type: "fatal", error: "x" });
  runtime.start();
  expect(made).toHaveLength(2);
  expect(runtime.getState()).toMatchObject({ phase: "booting", step: "download" });
  made[0].emit({ type: "ready", clockShiftMs: 0 });      // stale: ignored
  expect(runtime.getState().phase).toBe("booting");
  made[1].emit({ type: "ready", clockShiftMs: 0 });
  expect(runtime.getState().phase).toBe("ready");
});

test("requests wait for nothing: they fail like a dropped connection", async () => {
  const { runtime } = fakeRuntime();
  runtime.start();
  await expect(runtime.request("GET", "/api/state", "", null, {}))
    .rejects.toThrow(TypeError);
});

test("reset rejects what is in flight", async () => {
  const { runtime, last } = fakeRuntime();
  runtime.start();
  last().emit({ type: "ready", clockShiftMs: 0 });
  last().answer = () => { throw new Error("unused"); };
  last().postMessage = () => {};                       // never answered
  const p = runtime.request("GET", "/api/state", "", null, {});
  runtime.start();
  await expect(p).rejects.toThrow(TypeError);
});
