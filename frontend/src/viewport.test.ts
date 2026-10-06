// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installViewportGuard, resetViewportOffset } from "./viewport";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.scrollTop = 0;
});

function size(w: number, h: number) {
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: h, configurable: true });
}

test("resetViewportOffset is a no-op when already at the origin", () => {
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  expect(resetViewportOffset()).toBe(false);
  expect(scrollTo).not.toHaveBeenCalled();
});

test("resetViewportOffset recenters a stale document scroll", () => {
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  document.documentElement.scrollTop = 40;
  expect(resetViewportOffset()).toBe(true);
  expect(document.documentElement.scrollTop).toBe(0);
  expect(scrollTo).toHaveBeenCalledWith(0, 0);
});

test("resetViewportOffset also catches a visualViewport offset", () => {
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Object.defineProperty(window, "visualViewport", {
    configurable: true, value: { offsetTop: 0, offsetLeft: 47 } });
  expect(resetViewportOffset()).toBe(true);
  expect(scrollTo).toHaveBeenCalledWith(0, 0);
  Object.defineProperty(window, "visualViewport", {
    configurable: true, value: null });
});

test("rotation re-centers once the new size has settled", () => {
  size(390, 844);
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const off = installViewportGuard();
  document.documentElement.scrollTop = 25;
  size(844, 390);
  window.dispatchEvent(new Event("resize"));
  expect(scrollTo).not.toHaveBeenCalled();       // still settling
  vi.advanceTimersByTime(300);
  expect(document.documentElement.scrollTop).toBe(0);
  expect(scrollTo).toHaveBeenCalledTimes(1);
  off();
});

test("same-orientation resizes (keyboard) do nothing", () => {
  size(390, 844);
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const off = installViewportGuard();
  document.documentElement.scrollTop = 25;
  size(390, 500);
  window.dispatchEvent(new Event("resize"));
  vi.advanceTimersByTime(1000);
  expect(scrollTo).not.toHaveBeenCalled();
  off();
});

test("orientationchange fires the guard even without a size flip", () => {
  size(390, 844);
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const off = installViewportGuard();
  document.documentElement.scrollTop = 25;
  window.dispatchEvent(new Event("orientationchange"));
  vi.advanceTimersByTime(300);
  expect(scrollTo).toHaveBeenCalledTimes(1);
  off();
});

test("closing the keyboard (focusout) re-centers a scrolled document", () => {
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const off = installViewportGuard();
  document.documentElement.scrollTop = 29;
  document.dispatchEvent(new Event("focusout"));
  expect(scrollTo).not.toHaveBeenCalled();
  vi.advanceTimersByTime(300);
  expect(document.documentElement.scrollTop).toBe(0);
  expect(scrollTo).toHaveBeenCalledTimes(1);
  off();
});
