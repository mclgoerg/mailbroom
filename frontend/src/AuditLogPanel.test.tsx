// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, fireEvent } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { AuditEntry } from "./types";

const entries: AuditEntry[] = Array.from({ length: 3 }, (_, i) => ({
  ts: 1700000000 + i, account: "default", actor: i === 0 ? "rule:abc123"
    : "user", action: i === 0 ? "rule_execute" : i === 1 ? "trash"
    : "unsubscribe",
  count: i + 1, bytes: 1000 * (i + 1), label: `item ${i}`,
  outcome: i === 2 ? "failed" : "ok", error: i === 2 ? "boom" : "",
}));

const audit = vi.fn().mockResolvedValue({ total: 3, entries });

vi.mock("./api", () => ({
  api: { audit: (...args: unknown[]) => audit(...args),
    auditExportUrl: () => "/api/audit/export" },
  fmtSize: (b: number) => `${b} B`,
}));

import { AuditLogPanel } from "./components/AuditLogPanel";

afterEach(() => { cleanup(); audit.mockClear(); });

test("renders entries newest-fetched-order with actor/outcome", async () => {
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await waitFor(() => screen.getByText(/item 0/));
  expect(screen.getByText(/item 1/)).toBeTruthy();
  expect(screen.getByText(/item 2/)).toBeTruthy();
  expect(screen.getByText(/rule “abc123”/)).toBeTruthy();
  expect(screen.getAllByText("failed").length).toBeGreaterThan(0);
  expect(audit).toHaveBeenCalledWith(0, 50);
});

test("empty state shows when there is nothing to show", async () => {
  audit.mockResolvedValueOnce({ total: 0, entries: [] });
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await waitFor(() => screen.getByText("Nothing recorded yet."));
});

test("Next/Previous page through results", async () => {
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await waitFor(() => screen.getByText(/item 0/));
  const next = screen.getByText(/Next/).closest("button");
  expect(next?.disabled).toBe(true);   // only 3 of 3 shown
});

test("close button calls onClose", async () => {
  const onClose = vi.fn();
  render(<AuditLogPanel rules={[]} onClose={onClose} />);
  await waitFor(() => screen.getByText(/item 0/));
  fireEvent.click(screen.getByText("✕"));
  expect(onClose).toHaveBeenCalled();
});

test("resolves a rule actor to its current name when known", async () => {
  const rule = { id: "abc123", name: "Grok" } as any;
  render(<AuditLogPanel rules={[rule]} onClose={() => {}} />);
  await waitFor(() => screen.getByText(/rule “Grok”/));
  expect(screen.queryByText(/rule “abc123”/)).toBeNull();
});
