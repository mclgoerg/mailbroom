/* Account scoping: every API path is tagged with the active account. */

import { expect, test } from "vitest";
import { setAccount, withAccount } from "./api";

test("withAccount appends the active account to every path", () => {
  setAccount("");
  expect(withAccount("/api/state")).toBe("/api/state");
  setAccount("work mail");
  expect(withAccount("/api/state")).toBe("/api/state?account=work%20mail");
  expect(withAccount("/api/group?grouping=sender&key=x"))
    .toBe("/api/group?grouping=sender&key=x&account=work%20mail");
  setAccount("");   // don't leak into other tests
});
