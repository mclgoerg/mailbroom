// @vitest-environment jsdom
/* Saved filter presets (one-tap chips, PR #4): chip renders from
 * state.presets, tapping one replaces the filter query, and the save
 * affordance prompts for a name and posts the current filter. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

let state: any;

const createPreset = vi.fn().mockResolvedValue(
  { id: "p1", name: "Old parcels", query: "from:parcels@shipping.example age:>1y", account: "proton" });
const updatePreset = vi.fn().mockResolvedValue(
  { id: "p1", name: "Old parcels", query: "from:parcels@shipping.example age:>1y", account: "proton" });
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
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
import type { AppState, Config } from "./types";

const acct = {
  excluded_folders: [] as string[],
  host: "h", port: 993, security: "ssl" as const,
  smtp_host: "", smtp_port: 587, smtp_security: "auto" as const,
  user: "", password: "", password_set: true,
  cafile: "", preset: "custom" as const, oauth: null,
  digest: { schedule: "off" as const, recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours" as const, value: 6,
    align_minute: 0 },
};

const cfg: Config = {
  default_account: "proton",
  accounts: { proton: { ...acct, user: "marcel@proton.example" } },
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {}, new_sender_window_days: 7,
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
  groups: { sender: {}, smart: {}, domain: {}, subject: {}, thread: {} },
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

const openFilterMenu = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Filter" }));
};
// The saved filters live in the Filter menu; leaves it open.
const openSaved = async () => {
  await openFilterMenu();
  await screen.findByRole("group", { name: "Saved filters" });
};

test("a saved preset is listed in the Filter menu with its name", async () => {
  localStorage.setItem("pmc_account", "proton");
  state = { ...baseState, presets: [
    { id: "p1", name: "Old parcels", query: "from:parcels@shipping.example age:>1y",
      account: "proton" }] };
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await openSaved();
});

test("tapping a saved filter replaces the filter query", async () => {
  localStorage.setItem("pmc_account", "proton");
  state = { ...baseState, presets: [
    { id: "p1", name: "Old parcels", query: "from:parcels@shipping.example age:>1y",
      account: "proton" }] };
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await openSaved();
  const filterInput = screen.getByPlaceholderText(
    "Search or filter…") as HTMLInputElement;
  fireEvent.change(filterInput, { target: { value: "something else" } });
  expect(filterInput.value).toBe("something else");

  fireEvent.click(screen.getByText("Old parcels"));
  // REPLACES, not appends.
  expect(filterInput.value).toBe("from:parcels@shipping.example age:>1y");
});

test("deleting a saved preset confirms, then calls api.deletePreset",
  async () => {
    localStorage.setItem("pmc_account", "proton");
    state = { ...baseState, presets: [
      { id: "p1", name: "Old parcels", query: "from:parcels@shipping.example age:>1y",
        account: "proton" }] };
    render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
    await openSaved();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete: Old parcels" }));
    expect((await findDialog()).textContent).toContain("Old parcels");
    await pressDialog("Delete");
    await waitFor(() => expect(deletePreset).toHaveBeenCalledWith("p1"));
  });

test("declining the delete confirmation never calls api.deletePreset",
  async () => {
    localStorage.setItem("pmc_account", "proton");
    state = { ...baseState, presets: [
      { id: "p1", name: "Old parcels", query: "from:parcels@shipping.example age:>1y",
        account: "proton" }] };
    render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
    await openSaved();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete: Old parcels" }));
    await cancelDialog();
    await expectNoDialog();
    expect(deletePreset).not.toHaveBeenCalled();
  });

test("the save entry is disabled until the filter has text, then " +
  "prompts for a name and saves", async () => {
  localStorage.setItem("pmc_account", "proton");
  state = { ...baseState };
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(screen.getByPlaceholderText("Search or filter…"))
    .toBeTruthy());
  const saveBtn = () => screen.getByRole("menuitem",
    { name: /^Save current filter/ }) as HTMLButtonElement;
  await openFilterMenu();
  expect(saveBtn().disabled).toBe(true);
  fireEvent.keyDown(document, { key: "Escape" });

  const filterInput = screen.getByPlaceholderText("Search or filter…");
  fireEvent.change(filterInput, { target: { value: "from:parcels@shipping.example age:>1y" } });
  await openFilterMenu();
  expect(saveBtn().disabled).toBe(false);

  fireEvent.click(saveBtn());
  const dlg = await findDialog();
  fireEvent.change(within(dlg).getByLabelText("Name"),
    { target: { value: "Old parcels" } });
  await pressDialog("Save");
  await waitFor(() => expect(createPreset).toHaveBeenCalledWith(
    "Old parcels", "from:parcels@shipping.example age:>1y"));
});

test("declining the save name prompt never calls api.createPreset",
  async () => {
    localStorage.setItem("pmc_account", "proton");
    state = { ...baseState };
    render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
    await waitFor(() => expect(screen.getByPlaceholderText("Search or filter…"))
      .toBeTruthy());
    const filterInput = screen.getByPlaceholderText("Search or filter…");
    fireEvent.change(filterInput, { target: { value: "from:parcels@shipping.example" } });
    await openFilterMenu();
    fireEvent.click(screen.getByRole("menuitem",
      { name: /^Save current filter/ }));
    await cancelDialog();
    await expectNoDialog();
    expect(createPreset).not.toHaveBeenCalled();
  });

test("editing a preset opens an inline editor prefilled with ITS OWN " +
  "query (not whatever's in the filter box); Save updates it, keeping " +
  "its name", async () => {
  localStorage.setItem("pmc_account", "proton");
  state = { ...baseState, presets: [
    { id: "p1", name: "Old parcels", query: "from:parcels@shipping.example age:>1y",
      account: "proton" }] };
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await openSaved();

  // Unrelated text sitting in the filter box must NOT leak into the edit.
  const filterInput = screen.getByPlaceholderText(
    "Search or filter…") as HTMLInputElement;
  fireEvent.change(filterInput, { target: { value: "something unrelated" } });

  fireEvent.click(screen.getByRole("menuitem", { name: "Edit: Old parcels" }));
  const editInput =
    screen.getByDisplayValue("from:parcels@shipping.example age:>1y") as HTMLInputElement;
  expect(editInput).not.toBe(filterInput);

  fireEvent.change(editInput, { target: { value: "from:parcels@shipping.example age:>2y" } });
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(updatePreset).toHaveBeenCalledWith(
    "p1", "Old parcels", "from:parcels@shipping.example age:>2y"));
  // the editor closes itself once the save lands
  await waitFor(() => expect(screen.queryByText("Save")).toBeNull());
  // the main filter box is still exactly what the user typed into it
  expect(filterInput.value).toBe("something unrelated");
});

test("Cancel closes the inline editor without calling api.updatePreset",
  async () => {
    localStorage.setItem("pmc_account", "proton");
    state = { ...baseState, presets: [
      { id: "p1", name: "Old parcels", query: "from:parcels@shipping.example age:>1y",
        account: "proton" }] };
    render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
    await openSaved();
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit: Old parcels" }));
    expect(screen.getByDisplayValue("from:parcels@shipping.example age:>1y")).toBeTruthy();

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Save")).toBeNull();
    expect(updatePreset).not.toHaveBeenCalled();
  });

test("a clear button appears once the filter has text and empties it",
  async () => {
    localStorage.setItem("pmc_account", "proton");
    state = { ...baseState };
    render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
    await waitFor(() => expect(screen.getByPlaceholderText("Search or filter…"))
      .toBeTruthy());
    expect(screen.queryByLabelText("Clear filter")).toBeNull();

    const filterInput = screen.getByPlaceholderText(
      "Search or filter…") as HTMLInputElement;
    fireEvent.change(filterInput, { target: { value: "from:parcels@shipping.example age:>1y" } });
    const clearBtn = screen.getByLabelText("Clear filter");

    fireEvent.click(clearBtn);
    expect(filterInput.value).toBe("");
    expect(screen.queryByLabelText("Clear filter")).toBeNull();
  });

test("an applied saved filter shows as a removable token; picking it again "
  + "clears the filter", async () => {
  localStorage.setItem("pmc_account", "proton");
  state = { ...baseState, presets: [
    { id: "p1", name: "Old parcels", query: "from:parcels@shipping.example age:>1y",
      account: "proton" }] };
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await openSaved();
  const box = screen.getByPlaceholderText("Search or filter…") as
    HTMLInputElement;
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Old parcels" }));
  expect(box.value).toBe("from:parcels@shipping.example age:>1y");
  expect(screen.getByTestId("filter-token").textContent).toContain("Old parcels");

  await openFilterMenu();
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Old parcels" }));
  expect(box.value).toBe("");
  expect(screen.queryByTestId("filter-token")).toBeNull();

  await openFilterMenu();
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Old parcels" }));
  fireEvent.click(screen.getByRole("button",
    { name: "Remove filter “Old parcels”" }));
  expect(box.value).toBe("");
});
