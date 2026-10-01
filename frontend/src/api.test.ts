/* Account scoping: every API path is tagged with the active account. */

import { expect, test } from "vitest";
import { api, setAccount, withAccount } from "./api";

test("withAccount appends the active account to every path", () => {
  setAccount("");
  expect(withAccount("/api/state")).toBe("/api/state");
  setAccount("work mail");
  expect(withAccount("/api/state")).toBe("/api/state?account=work%20mail");
  expect(withAccount("/api/group?grouping=sender&key=x"))
    .toBe("/api/group?grouping=sender&key=x&account=work%20mail");
  setAccount("");   // don't leak into other tests
});

test("exportUrl appends repeated keys params only when keys are given",
  () => {
  expect(api.exportUrl("sender")).toBe("/api/export?grouping=sender");
  expect(api.exportUrl("sender", [])).toBe("/api/export?grouping=sender");
  expect(api.exportUrl("sender", ["a@x.example", "b c@x.example"])).toBe(
    "/api/export?grouping=sender&keys=a%40x.example"
    + "&keys=b%20c%40x.example");
});
