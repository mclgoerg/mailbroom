// @vitest-environment jsdom
/* Filter menu of the Senders toolbar: sections, toggling, saved-filter
 * actions, the active token + dot. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { activeFilterLabel, FilterMenu, FilterToken }
  from "./components/FilterMenu";
import type { FilterPreset } from "./types";

afterEach(cleanup);

const quick = (k: string) => ({ aisafe: "ai:safe", older6: "age:>6m",
  older12: "age:>1y", older24: "age:>2y", unsub_pending: "is:unsub",
  new: "is:new", still: "is:still-mailing" } as Record<string, string>)[k]
  ?? "";
const saved: FilterPreset[] = [
  { id: "p1", name: "Old news", query: "from:news.example age:>1y",
    account: "a" }];

const setup = (over: Partial<Parameters<typeof FilterMenu>[0]> = {}) => {
  const p = { onQuick: vi.fn(), onApply: vi.fn(), onEdit: vi.fn(),
    onDelete: vi.fn(), onSave: vi.fn(), run: vi.fn() };
  render(<FilterMenu filter="" quick={quick} newCount={0} stillCount={0}
    presets={saved} onQuick={p.onQuick} onApply={p.onApply}
    onEdit={p.onEdit} onDelete={p.onDelete} onSave={p.onSave}
    onAi={{ run: p.run }} {...over} />);
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  return p;
};

test("quick filters, inactive row and saved filters call back", () => {
  const p = setup();
  fireEvent.click(screen.getByRole("menuitemradio", { name: "AI-safe groups" }));
  expect(p.onQuick).toHaveBeenLastCalledWith("aisafe");
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: "1 yr" }));
  expect(p.onQuick).toHaveBeenLastCalledWith("older12");
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Old news" }));
  expect(p.onApply).toHaveBeenCalledWith(saved[0]);
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Edit: Old news" }));
  expect(p.onEdit).toHaveBeenCalledWith(saved[0]);
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete: Old news" }));
  expect(p.onDelete).toHaveBeenCalledWith(saved[0]);
});

test("New / Still mailing appear only with senders; the active one is checked",
  () => {
    setup();
    expect(screen.queryByRole("menuitemradio", { name: /^New/ })).toBeNull();
    cleanup();
    setup({ newCount: 3, stillCount: 2, filter: "is:new" });
    expect(screen.getByRole("menuitemradio", { name: "New (3)" })
      .getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: "Still mailing (2)" })
      .getAttribute("aria-checked")).toBe("false");
  });

test("Save current filter is disabled without a filter; the AI entry is "
  + "absent, off or live as given", () => {
  setup({ onAi: undefined });
  expect((screen.getByRole("menuitem", { name: /^Save current filter/ }) as
    HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("menuitem", { name: /Describe a filter/ }))
    .toBeNull();
  cleanup();
  setup({ onAi: { disabled: true, hint: "Not in the demo", run: vi.fn() } });
  expect((screen.getByRole("menuitem", { name: /Describe a filter/ }) as
    HTMLButtonElement).disabled).toBe(true);
});

test("an applied filter turns the trigger into a dot-marked tinted button",
  () => {
    setup();
    expect(screen.queryByTestId("filter-dot")).toBeNull();
    cleanup();
    setup({ filter: "from:x.example" });
    expect(screen.getByTestId("filter-dot")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter" }).className)
      .toContain("bg-accent-tint");
    fireEvent.click(screen.getByRole("menuitem",
      { name: /^Save current filter/ }));
  });

test("the token label names a quick or saved filter, not a typed one", () => {
  const counts = { new: 2, still: 0 };
  const label = (f: string) => activeFilterLabel(f, saved, quick, counts);
  expect(label("")).toBeNull();
  expect(label("ai:safe")).toBe("AI-safe groups");
  expect(label("age:>1y")).toBe("Inactive: 1 yr");
  expect(label("is:new")).toBe("New (2)");
  expect(label("is:still-mailing")).toBeNull();      // none -> no entry
  expect(label("from:news.example age:>1y")).toBe("Old news");
  expect(label("from:typed.example")).toBeNull();
});

test("FilterToken removes via its labelled button", () => {
  const onRemove = vi.fn();
  render(<FilterToken label="Old news" onRemove={onRemove} />);
  fireEvent.click(screen.getByRole("button",
    { name: "Remove filter “Old news”" }));
  expect(onRemove).toHaveBeenCalled();
});

test("a saved filter row shows its active check and caps a long name", () => {
  const long: FilterPreset = { id: "p2", account: "a",
    name: "Newsletters I stopped reading", query: "from:long.example" };
  setup({ presets: [long], filter: "from:long.example" });
  const row = screen.getByRole("menuitemradio",
    { name: "Newsletters I stopped reading" });
  expect(row.getAttribute("aria-checked")).toBe("true");
  expect(row.querySelector("svg.lucide-check")).toBeTruthy();   // visible
  const name = row.querySelector("span")!;
  expect(name.className).toContain("truncate");
  expect(name.className).toContain("max-w-40");   // phone clamp
});

test("the token takes its own line on phones", () => {
  render(<FilterToken label="x" onRemove={() => {}} />);
  expect(screen.getByTestId("filter-token").parentElement!.className)
    .toContain("basis-full");
});
