// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { DE } from "../locales/de";
import { EN } from "../locales/en";
import { setLang } from "../i18n";
import { DemoBoot } from "./DemoBoot";
import type { BootState } from "./runtime";

vi.mock("../App", () => ({ default: () => <div>the app</div> }));

import { DialogProvider, ToastProvider } from "../components/ui";
import { DemoRoot } from "./DemoRoot";
import { fakeRuntime } from "./fakeWorker";

afterEach(() => { cleanup(); setLang("en"); });

type Booting = Extract<BootState, { phase: "booting" }>;
const booting = (over: Partial<Booting> = {}): Booting => ({
  phase: "booting", step: "download", done: [], mb: 0, totalMb: 0, ...over });

test("shows the title, the privacy line and the phone hint", () => {
  render(<DemoBoot state={booting()} onRetry={() => {}} />);
  expect(screen.getByText("Getting your demo ready to rake it")).toBeTruthy();
  expect(screen.getByText(/Everything runs in your browser/)).toBeTruthy();
  expect(screen.getByText(/Best on a computer/)).toBeTruthy();
});

test("download progress shows megabytes and a bar", () => {
  render(<DemoBoot state={booting({ mb: 3.04, totalMb: 8.1 })}
    onRetry={() => {}} />);
  expect(screen.getByText("3.0 of 8.1 MB")).toBeTruthy();
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow"))
    .toBe("3.04");
});

test("finished steps carry a checkmark, the running one a spinner", () => {
  render(<DemoBoot state={booting({ step: "libraries",
    done: ["download", "python"] })} onRetry={() => {}} />);
  expect(screen.getAllByLabelText("Done")).toHaveLength(2);
  expect(screen.getAllByRole("status")).toHaveLength(1);   // the spinner
  expect(screen.queryByText(/ of .* MB/)).toBeNull();
});

test("German wording", () => {
  setLang("de");
  render(<DemoBoot state={booting()} onRetry={() => {}} />);
  expect(screen.getByText("Deine Demo wird gerade zusammengeharkt …"))
    .toBeTruthy();
  expect(screen.getByText(/Alles läuft in deinem Browser/)).toBeTruthy();
});

test.each(["unsupported", "stalled", "error"] as const)(
  "failure (%s): a plain message and a retry button, no spinner", (reason) => {
    const retry = vi.fn();
    render(<DemoBoot state={{ phase: "failed", reason }} onRetry={retry} />);
    expect(screen.getByText(EN[`demo.fail.${reason}`])).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

test("every demo string exists in English and German", () => {
  const keys = Object.keys(EN).filter((k) => k.startsWith("demo."));
  expect(keys.length).toBeGreaterThan(15);
  for (const k of keys) {
    expect(DE[k], k).toBeTruthy();
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    expect(ph(DE[k]), k).toEqual(ph(EN[k]));
  }
  expect(Object.keys(DE).filter((k) => k.startsWith("demo.")).sort())
    .toEqual(keys.sort());
});

const root = () => {
  const f = fakeRuntime();
  f.runtime.start();
  render(<ToastProvider><DialogProvider>
    <DemoRoot runtime={f.runtime} /></DialogProvider></ToastProvider>);
  return f;
};

test("boot screen until ready, then banner + app", async () => {
  const f = root();
  expect(screen.queryByText("the app")).toBeNull();
  const { act } = await import("@testing-library/react");
  act(() => f.last().emit({ type: "ready", clockShiftMs: 0 }));
  expect(screen.getByText("the app")).toBeTruthy();
  expect(screen.getByText("Demo - your changes live only in this tab"))
    .toBeTruthy();
});

test("Reset demo asks, then boots a fresh worker and shows the boot screen",
  async () => {
    const f = root();
    const { act, waitFor } = await import("@testing-library/react");
    act(() => f.last().emit({ type: "ready", clockShiftMs: 0 }));

    fireEvent.click(screen.getByRole("button", { name: "Reset demo" }));
    await screen.findByText("Reset the demo?");
    expect(f.made).toHaveLength(1);                  // not yet: still asking
    // the dialog ignores a confirm in its first moments (double-tap guard)
    await new Promise((r) => setTimeout(r, 600));
    const buttons = screen.getAllByRole("button", { name: "Reset demo" });
    fireEvent.click(buttons[buttons.length - 1], { detail: 0 });

    await waitFor(() => expect(f.made).toHaveLength(2));
    expect(f.made[0].terminated).toBe(true);
    expect(screen.queryByText("the app")).toBeNull();
    expect(screen.getByText("Getting your demo ready to rake it")).toBeTruthy();
  });

test("Reset demo, declined: nothing changes", async () => {
  const f = root();
  const { act } = await import("@testing-library/react");
  act(() => f.last().emit({ type: "ready", clockShiftMs: 0 }));
  fireEvent.click(screen.getByRole("button", { name: "Reset demo" }));
  await screen.findByText("Reset the demo?");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(f.made).toHaveLength(1);
  expect(screen.getByText("the app")).toBeTruthy();
});
