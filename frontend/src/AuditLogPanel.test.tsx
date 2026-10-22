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
const downloadFile = vi.fn().mockResolvedValue(undefined);

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { audit: (...args: unknown[]) => audit(...args),
    auditExportUrl: () => "/api/audit/export" },
  downloadFile: (...args: unknown[]) => downloadFile(...args),
  fmtSize: (b: number) => `${b} B`,
}));

import { AuditLogPanel } from "./components/AuditLogPanel";

afterEach(() => { cleanup(); audit.mockClear(); downloadFile.mockClear(); });

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
  await waitFor(() => screen.getByText("Nothing recorded yet"));
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
  fireEvent.click(screen.getByTitle("Close"));
  expect(onClose).toHaveBeenCalled();
});

test("resolves a rule actor to its current name when known", async () => {
  const rule = { id: "abc123", name: "Grok" } as any;
  render(<AuditLogPanel rules={[rule]} onClose={() => {}} />);
  await waitFor(() => screen.getByText(/rule “Grok”/));
  expect(screen.queryByText(/rule “abc123”/)).toBeNull();
});

test("CSV export fetches and saves a blob instead of navigating", async () => {
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await waitFor(() => screen.getByText(/item 0/));
  fireEvent.click(screen.getByText("CSV"));
  expect(downloadFile).toHaveBeenCalledWith("/api/audit/export");
});

test("an empty log hides the pager, the CSV button and the 0-0 summary",
  async () => {
    audit.mockResolvedValueOnce({ total: 0, entries: [] });
    render(<AuditLogPanel rules={[]} onClose={() => {}} />);
    await waitFor(() => screen.getByText("Nothing recorded yet"));
    expect(screen.queryByText(/Next/)).toBeNull();
    expect(screen.queryByText(/Previous/)).toBeNull();
    expect(screen.queryByText("CSV")).toBeNull();
    expect(screen.queryByText(/of 0/)).toBeNull();
  });

test("with entries the pager sits below the list as small buttons",
  async () => {
    render(<AuditLogPanel rules={[]} onClose={() => {}} />);
    await waitFor(() => screen.getByText(/item 0/));
    const list = screen.getByText(/item 0/);
    const prev = screen.getByText(/Previous/).closest("button")!;
    expect(prev.compareDocumentPosition(list)
      & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(screen.getByText("CSV")).toBeTruthy();
  });

test("the tooltip of a failed entry words a coded error in the interface " +
  "language and keeps older plain text", async () => {
  audit.mockResolvedValueOnce({ total: 2, entries: [
    { ts: 5, action: "empty_trash", actor: "user", account: "a", count: 3,
      bytes: 0, label: "", outcome: "partial",
      error: "deleted_then_failed:n=3,cause=cannot_expunge" },
    { ts: 4, action: "purge", actor: "user", account: "a", count: 0,
      bytes: 0, label: "", outcome: "error",
      error: "moved to Trash, could not verify for permanent deletion" }] });
  render(<AuditLogPanel rules={[]} onClose={() => {}} />);
  await waitFor(() => screen.getByTitle(/3 mails were permanently deleted/));
  expect(screen.getByTitle("The server did not remove the marked mails. "
    + "(3 mails were permanently deleted before the failure)")).toBeTruthy();
  expect(screen.getByTitle(/could not verify for permanent deletion/))
    .toBeTruthy();
});
