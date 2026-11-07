// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { hashOf, parseHash, useNav } from "./nav";

afterEach(() => { window.location.hash = ""; });

test("parseHash accepts known pages and rejects the rest", () => {
  expect(parseHash("#/senders")).toBe("senders");
  expect(parseHash("#/all")).toBe("all");
  expect(parseHash("#/all?x=1")).toBe("all");
  expect(parseHash("")).toBeNull();
  expect(parseHash("#/nope")).toBeNull();
  expect(hashOf("all")).toBe("#/all");
});

test("an empty or unknown hash shows the fallback without rewriting the URL", () => {
  const { result } = renderHook(() => useNav("all"));
  expect(result.current[0]).toBe("all");
  expect(window.location.hash).toBe("");
  window.location.hash = "#/bogus";
  const again = renderHook(() => useNav());
  expect(again.result.current[0]).toBe("senders");
});

test("setPage writes the hash and back/forward (hashchange) follow", () => {
  const { result } = renderHook(() => useNav());
  act(() => result.current[1]("all"));
  expect(result.current[0]).toBe("all");
  expect(window.location.hash).toBe("#/all");
  act(() => {
    window.location.hash = "#/senders";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(result.current[0]).toBe("senders");
});

test("Back to an empty hash returns to the start page, whatever the fallback became", () => {
  const { result, rerender } = renderHook(({ f }) => useNav(f),
    { initialProps: { f: "senders" as const } });
  act(() => result.current[1]("all"));
  // the caller's fallback follows the page (persisted view); it must not matter
  rerender({ f: "all" as unknown as "senders" });
  act(() => {
    window.location.hash = "";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(result.current[0]).toBe("senders");
});
