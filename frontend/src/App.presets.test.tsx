// @vitest-environment jsdom
/* Saved filter presets (one-tap chips, PR #4): chip renders from
 * state.presets, tapping one replaces the filter query, and the save
 * affordance prompts for a name and posts the current filter. */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

let state: any;

const createPreset = vi.fn().mockResolvedValue(
  { id: "p1", name: "Old DHL", query: "from:dhl age:>1y", account: "proton" });
const updatePreset = vi.fn().mockResolvedValue(
  { id: "p1", name: "Old DHL", query: "from:dhl age:>1y", account: "proton" });
const deletePreset = vi.fn().mockResolvedValue(undefined);

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
    createPreset: (...args: unknown[]) => createPreset(...args),
    updatePreset: (...args: unknown[]) => updatePreset(...args),
    deletePreset: (...args: unknown[]) => deletePreset(...args),
  },
  downloadFile: () => Promise.resolve(),
  setAccount: () => {},
  withAccount: (p: string) => p,
  fmtSize: (b: number) => `${b} B`,
  fmtUsd: (c: number) => `$${c}`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
}));

import App from "./App";
import type { AppState, Config } from "./types";

const acct = {
  excluded_folders: [] as string[],
  host: "h", port: 993, security: "ssl" as const,
  smtp_host: "", smtp_port: 587, smtp_security: "auto" as const,
  user: "", password: "", password_set: true,
  cafile: "", preset: "custom" as const, oauth: null,
};

const cfg: Config = {
  default_account: "proton",
  accounts: { proton: { ...acct, user: "marcel@proton.example" } },
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {},
  ai: { provider: "anthropic", model: "claude-sonnet-5",
    foundry_endpoint: "", price_in: 0, price_out: 0, budget_usd: 0,
    month_cost: 0, prices_effective: [2, 10], api_key: "",
    api_key_set: false, available: false, source: null,
    shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
};

const baseState: AppState = {
  account: "proton", status: "idle", scanned_ts: null, groups_rev: 0,
  progress: "", error: "", folders: [],
  groups: { sender: {}, domain: {}, subject: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: [],
  presets: [],
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  createPreset.mockClear();
  updatePreset.mockClear();
  deletePreset.mockClear();
});

test("a saved preset renders as a chip with its name", async () => {
  localStorage.setItem("pmc_account", "proton");
  state = { ...baseState, presets: [
    { id: "p1", name: "Old DHL", query: "from:dhl age:>1y",
      account: "proton" }] };
  render(<App />);
  await waitFor(() => expect(screen.getByText("Old DHL")).toBeTruthy());
});

test("tapping a saved preset chip replaces the filter query", async () => {
  localStorage.setItem("pmc_account", "proton");
  state = { ...baseState, presets: [
    { id: "p1", name: "Old DHL", query: "from:dhl age:>1y",
      account: "proton" }] };
  render(<App />);
  await waitFor(() => expect(screen.getByText("Old DHL")).toBeTruthy());
  const filterInput = screen.getByPlaceholderText(
    "filter groups…") as HTMLInputElement;
  fireEvent.change(filterInput, { target: { value: "something else" } });
  expect(filterInput.value).toBe("something else");

  fireEvent.click(screen.getByText("Old DHL"));
  // REPLACES, not appends.
  expect(filterInput.value).toBe("from:dhl age:>1y");
});

test("deleting a saved preset confirms, then calls api.deletePreset",
  async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    localStorage.setItem("pmc_account", "proton");
    state = { ...baseState, presets: [
      { id: "p1", name: "Old DHL", query: "from:dhl age:>1y",
        account: "proton" }] };
    render(<App />);
    await waitFor(() => expect(screen.getByText("Old DHL")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Delete"));
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining("Old DHL"));
    await waitFor(() => expect(deletePreset).toHaveBeenCalledWith("p1"));
    confirmSpy.mockRestore();
  });

test("declining the delete confirmation never calls api.deletePreset",
  async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    localStorage.setItem("pmc_account", "proton");
    state = { ...baseState, presets: [
      { id: "p1", name: "Old DHL", query: "from:dhl age:>1y",
        account: "proton" }] };
    render(<App />);
    await waitFor(() => expect(screen.getByText("Old DHL")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Delete"));
    expect(deletePreset).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

test("the save button is disabled until the filter has text, then " +
  "prompts for a name and saves", async () => {
  const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("Old DHL");
  localStorage.setItem("pmc_account", "proton");
  state = { ...baseState };
  render(<App />);
  await waitFor(() => expect(screen.getByPlaceholderText("filter groups…"))
    .toBeTruthy());
  const saveBtn =
    screen.getByTitle("Save current filter as a preset") as HTMLButtonElement;
  expect(saveBtn.disabled).toBe(true);

  const filterInput = screen.getByPlaceholderText("filter groups…");
  fireEvent.change(filterInput, { target: { value: "from:dhl age:>1y" } });
  expect(saveBtn.disabled).toBe(false);

  fireEvent.click(saveBtn);
  expect(promptSpy).toHaveBeenCalled();
  await waitFor(() => expect(createPreset).toHaveBeenCalledWith(
    "Old DHL", "from:dhl age:>1y"));
  promptSpy.mockRestore();
});

test("declining the save name prompt never calls api.createPreset",
  async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
    localStorage.setItem("pmc_account", "proton");
    state = { ...baseState };
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText("filter groups…"))
      .toBeTruthy());
    const filterInput = screen.getByPlaceholderText("filter groups…");
    fireEvent.change(filterInput, { target: { value: "from:dhl" } });
    fireEvent.click(screen.getByTitle("Save current filter as a preset"));
    expect(createPreset).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

test("editing a preset prompts prefilled with ITS OWN query (not " +
  "whatever's in the filter box) and keeps its name", async () => {
  const promptSpy = vi.spyOn(window, "prompt")
    .mockReturnValue("from:dhl age:>2y");
  localStorage.setItem("pmc_account", "proton");
  state = { ...baseState, presets: [
    { id: "p1", name: "Old DHL", query: "from:dhl age:>1y",
      account: "proton" }] };
  render(<App />);
  await waitFor(() => expect(screen.getByText("Old DHL")).toBeTruthy());

  // Unrelated text sitting in the filter box must NOT leak into the edit.
  const filterInput = screen.getByPlaceholderText(
    "filter groups…") as HTMLInputElement;
  fireEvent.change(filterInput, { target: { value: "something unrelated" } });

  fireEvent.click(screen.getByLabelText("Edit"));
  expect(promptSpy).toHaveBeenCalledWith(
    expect.any(String), "from:dhl age:>1y");
  await waitFor(() => expect(updatePreset).toHaveBeenCalledWith(
    "p1", "Old DHL", "from:dhl age:>2y"));
  promptSpy.mockRestore();
});

test("declining the edit query prompt never calls api.updatePreset",
  async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
    localStorage.setItem("pmc_account", "proton");
    state = { ...baseState, presets: [
      { id: "p1", name: "Old DHL", query: "from:dhl age:>1y",
        account: "proton" }] };
    render(<App />);
    await waitFor(() => expect(screen.getByText("Old DHL")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Edit"));
    expect(updatePreset).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

test("a clear button appears once the filter has text and empties it",
  async () => {
    localStorage.setItem("pmc_account", "proton");
    state = { ...baseState };
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText("filter groups…"))
      .toBeTruthy());
    expect(screen.queryByLabelText("Clear filter")).toBeNull();

    const filterInput = screen.getByPlaceholderText(
      "filter groups…") as HTMLInputElement;
    fireEvent.change(filterInput, { target: { value: "from:dhl age:>1y" } });
    const clearBtn = screen.getByLabelText("Clear filter");

    fireEvent.click(clearBtn);
    expect(filterInput.value).toBe("");
    expect(screen.queryByLabelText("Clear filter")).toBeNull();
  });
