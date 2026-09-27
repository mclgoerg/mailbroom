// @vitest-environment jsdom
/* Login gate: password submit calls the API; OIDC mode links to the
 * server-side redirect endpoint. */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const logins: string[] = [];
vi.mock("./api", () => ({
  api: {
    login: (pw: string) => {
      logins.push(pw);
      return pw === "right" ? Promise.resolve({ ok: true })
        : Promise.reject(new Error("wrong password"));
    },
  },
}));

import { Login } from "./components/Login";

afterEach(cleanup);

test("password mode submits and reports success", async () => {
  let ok = false;
  render(<Login mode="password" onLogin={() => { ok = true; }} />);
  fireEvent.change(screen.getByPlaceholderText("Password"),
    { target: { value: "right" } });
  fireEvent.click(screen.getByText("Sign in"));
  await Promise.resolve();
  await Promise.resolve();
  expect(logins).toEqual(["right"]);
  expect(ok).toBe(true);
});

test("wrong password shows the error and stays", async () => {
  let ok = false;
  render(<Login mode="password" onLogin={() => { ok = true; }} />);
  fireEvent.change(screen.getByPlaceholderText("Password"),
    { target: { value: "nope" } });
  fireEvent.click(screen.getByText("Sign in"));
  expect(await screen.findByText(/wrong password/)).toBeTruthy();
  expect(ok).toBe(false);
});

test("oidc mode renders the SSO link", () => {
  render(<Login mode="oidc" onLogin={() => {}} />);
  const a = screen.getByText("Sign in with SSO") as HTMLAnchorElement;
  expect(a.getAttribute("href")).toBe("/api/oidc/login");
});
