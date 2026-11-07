import { afterEach } from "vitest";

// The URL hash is the app's page (nav.ts) and outlives a test's cleanup():
// reset it so one test's page never leaks into the next.
afterEach(() => {
  if (typeof window !== "undefined" && window.location.hash)
    window.location.hash = "";
});
