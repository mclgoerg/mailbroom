// @vitest-environment jsdom
/* Menu: opens on trigger click, runs the item action and closes, and
 * closes on Escape / outside click. */

import { act, cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";

import {
  isModalOpen, AccountAvatar, BulkBar, Button, Checkbox, Chip, ChipGroup, ChipSegment,
  ConfirmDialog, DIALOG_ARM_MS, DialogProvider, PromptDialog, EmptyState, MailRow, Menu, MenuDivider,
  MenuHeading, MenuItem, Modal, Notice, ProgressBar, Segmented, ToastProvider,
  confirmDialog,
  LINK, RatingChips, Tag, ensureAiAck, promptDialog, ProtectButton, useToast,
} from "./components/ui";

afterEach(cleanup);

/** Dialogs ignore confirm/submit for DIALOG_ARM_MS after opening. */
const armed = () => new Promise((r) => setTimeout(r, DIALOG_ARM_MS + 30));

const renderMenu = (onPick: () => void) =>
  render(
    <Menu label="Profile" trigger={<>👤</>}>
      <MenuHeading>me@x.example</MenuHeading>
      <MenuItem onClick={onPick}>Do it</MenuItem>
    </Menu>,
  );

test("menu opens, runs the action and closes again", () => {
  const onPick = vi.fn();
  renderMenu(onPick);
  expect(screen.queryByText("Do it")).toBeNull();
  fireEvent.click(screen.getByLabelText("Profile"));
  expect(screen.getByText("me@x.example")).toBeTruthy();
  fireEvent.click(screen.getByText("Do it"));
  expect(onPick).toHaveBeenCalledOnce();
  expect(screen.queryByText("Do it")).toBeNull();     // closed after click
});

test("menu closes on Escape without running anything", () => {
  const onPick = vi.fn();
  renderMenu(onPick);
  fireEvent.click(screen.getByLabelText("Profile"));
  expect(screen.getByText("Do it")).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByText("Do it")).toBeNull();
  expect(onPick).not.toHaveBeenCalled();
});

test("MenuItem renders a sub line and marks the active row", () => {
  render(
    <Menu label="Accounts" trigger={<>👤</>}>
      <MenuItem active sub="marcel@proton.example">proton</MenuItem>
      <MenuItem active={false} sub="marcel@icloud.example">icloud</MenuItem>
    </Menu>,
  );
  fireEvent.click(screen.getByLabelText("Accounts"));
  const rows = screen.getAllByRole("menuitemradio");
  expect(rows).toHaveLength(2);
  expect(rows[0].getAttribute("aria-checked")).toBe("true");
  expect(rows[1].getAttribute("aria-checked")).toBe("false");
  expect(screen.getByText("marcel@proton.example")).toBeTruthy();
});

test("AccountAvatar shows the first letter and a stable, distinct hue "
  + "per name", () => {
  render(<>
    <AccountAvatar name="proton" />
    <AccountAvatar name="icloud" />
  </>);
  expect(screen.getByText("p")).toBeTruthy();
  expect(screen.getByText("i")).toBeTruthy();
  const [a, b] = screen.getAllByText(/^[a-z]$/);
  expect(a.className).not.toBe(b.className);       // distinct hues
});

test("menu flips to left-aligned when right-aligned would run off the " +
  "left screen edge (trigger wrapped to the start of a row)", () => {
  const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
  rect.mockReturnValue({ left: -60, right: 140, width: 200, height: 80,
    top: 0, bottom: 80, x: -60, y: 0, toJSON: () => ({}) });
  renderMenu(() => {});
  fireEvent.click(screen.getByLabelText("Profile"));
  const popover = screen.getByText("Do it").closest("div.absolute")!;
  expect(popover.className).toContain("left-0");
  expect(popover.className).not.toContain("right-0");
  rect.mockRestore();
});

test("menu stays right-aligned when it fits", () => {
  const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
  rect.mockReturnValue({ left: 120, right: 320, width: 200, height: 80,
    top: 0, bottom: 80, x: 120, y: 0, toJSON: () => ({}) });
  renderMenu(() => {});
  fireEvent.click(screen.getByLabelText("Profile"));
  const popover = screen.getByText("Do it").closest("div.absolute")!;
  expect(popover.className).toContain("right-0");
  rect.mockRestore();
});

// jsdom can't hit-test, so pin the stacking layers at class level: the
// popover must sit on the dropdown layer, above the sticky table header.
test("menu popover uses the dropdown layer", () => {
  renderMenu(vi.fn());
  fireEvent.click(screen.getByLabelText("Profile"));
  const pop = screen.getByText("Do it").closest("div.absolute")!;
  expect(pop.className).toContain("z-(--z-dropdown)");
});

test("z-index scale is strictly ordered sticky < bulkbar < dropdown < modal < toast", async () => {
  // vitest blanks CSS imports (even ?raw), so read the file from disk (cwd is frontend/).
  // @ts-expect-error node builtins have no types in this project
  const { readFileSync } = await import("node:fs");
  const indexCss: string = readFileSync("src/index.css", "utf8");
  const z = (n: string) => Number(new RegExp(`--z-${n}:\\s*(\\d+)`).exec(indexCss)?.[1]);
  const order = ["sticky", "bulkbar", "dropdown", "modal", "toast"].map(z);
  expect(order.every(Number.isFinite)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(new Set(order).size).toBe(order.length);
});

// vitest blanks CSS imports (even ?raw), so read the file from disk.
async function indexCss(): Promise<string> {
  // @ts-expect-error node builtins have no types in this project
  const { readFileSync } = await import("node:fs");
  return readFileSync("src/index.css", "utf8");
}

test("index.css defines the type layers, semantic pairs, radii and shadows", async () => {
  const css = await indexCss();
  for (const l of ["title", "heading", "body", "body-mobile", "meta",
    "caption", "section"]) expect(css).toContain(`@utility type-${l} `);
  for (const k of ["safe", "review", "keep", "info", "attach", "new"]) {
    expect(css).toContain(`--color-${k}-bg:`);
    expect(css).toContain(`--color-${k}-fg:`);
  }
  for (const k of ["danger:", "danger-h:", "danger-fg:", "overlay:"]) {
    expect(css).toContain(`--color-${k}`);
  }
  for (const r of ["badge", "control", "card", "dialog"]) {
    expect(css).toContain(`--radius-${r}:`);
  }
  expect(css).toContain("@custom-variant coarse (@media (pointer: coarse))");
  expect(css).toContain("--color-faint: #9a8a70");
  expect(css).toContain("--color-faint: #7a6a50");
  expect(css).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--color-accent\)/);
  // shadows have a dark default and a light override
  expect(css.match(/--shadow-popover:/g)).toHaveLength(2);
  expect(css.match(/--shadow-bar:/g)).toHaveLength(2);
});

test("Button variants render", () => {
  render(<>
    {(["primary", "secondary", "quiet", "danger", "danger-quiet"] as const)
      .map((v) => <Button key={v} variant={v}>{v}</Button>)}
  </>);
  expect(screen.getByText("primary").className).toContain("bg-accent");
  expect(screen.getByText("quiet").className).toContain("bg-transparent");
  expect(screen.getByText("danger").className).toContain("bg-danger");
  expect(screen.getByText("danger-quiet").className).toContain("text-danger-fg");
});

test("Button sizes carry the touch heights; passes aria-* and type through", () => {
  render(<>
    <Button>md</Button>
    <Button size="sm" type="submit" aria-describedby="x">sm</Button>
  </>);
  expect(screen.getByText("md").className).toContain("min-h-9");
  expect(screen.getByText("md").className).toContain("coarse:min-h-10");
  const sm = screen.getByText("sm");
  expect(sm.className).toContain("min-h-8");
  expect(sm.className).toContain("coarse:min-h-9");
  expect(sm.getAttribute("type")).toBe("submit");
  expect(sm.getAttribute("aria-describedby")).toBe("x");
});

test("icon Button requires a label and renders it as aria-label + title", () => {
  render(<Button size="icon" label="Close"><span>x</span></Button>);
  const b = screen.getByLabelText("Close");
  expect(b.getAttribute("title")).toBe("Close");
  expect(b.className).toContain("size-9");
  // @ts-expect-error an icon button without a label does not type-check
  render(<Button size="icon">y</Button>);
});

test("disabled Button is flat chip/faint with no opacity and does not fire", () => {
  const onClick = vi.fn();
  render(<Button variant="danger" disabled onClick={onClick}>go</Button>);
  const b = screen.getByText("go");
  fireEvent.click(b);
  expect(onClick).not.toHaveBeenCalled();
  expect(b.className).toContain("disabled:bg-chip");
  expect(b.className).toContain("disabled:text-faint");
  expect(b.className).toContain("disabled:cursor-not-allowed");
  expect(b.className).not.toContain("opacity");
  expect(b.className).toContain("enabled:hover:bg-danger-h");  // no hover when disabled
});

test("MenuItem danger and disabled styles, MenuDivider separator", () => {
  render(
    <Menu label="M" trigger={<>m</>}>
      <MenuItem danger>Empty</MenuItem>
      <MenuDivider />
      <MenuItem disabled>Nope</MenuItem>
    </Menu>,
  );
  fireEvent.click(screen.getByLabelText("M"));
  expect(screen.getByText("Empty").closest("button")!.className)
    .toContain("text-danger-fg");
  expect(screen.getByRole("separator")).toBeTruthy();
  const nope = screen.getByText("Nope").closest("button")!;
  expect(nope.className).toContain("disabled:text-faint");
  expect(nope.className).not.toContain("opacity");
});

test("Checkbox toggles, forwards aria-label/disabled, label is the hit area", () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <Checkbox checked={false} onChange={onChange} aria-label="pick" />);
  const box = screen.getByLabelText("pick") as HTMLInputElement;
  expect(box.type).toBe("checkbox");
  fireEvent.click(box);
  expect(onChange).toHaveBeenCalledOnce();
  expect(box.closest("label")!.className).toContain("coarse:min-h-11");
  rerender(<Checkbox checked onChange={onChange} disabled label="Mine" />);
  const labelled = screen.getByLabelText("Mine") as HTMLInputElement;
  expect(labelled.checked).toBe(true);
  expect(labelled.disabled).toBe(true);
});

test("Chip toggles aria-pressed and shows the on style; ChipGroup segments", () => {
  const onClick = vi.fn();
  const { rerender } = render(<Chip on={false} onClick={onClick}>AI</Chip>);
  const chip = screen.getByRole("button", { name: "AI" });
  expect(chip.getAttribute("aria-pressed")).toBe("false");
  expect(chip.className).toContain("bg-panel2");
  fireEvent.click(chip);
  expect(onClick).toHaveBeenCalledOnce();
  rerender(<Chip on onClick={onClick}>AI</Chip>);
  expect(chip.getAttribute("aria-pressed")).toBe("true");
  expect(chip.className).toContain("border-accent");
  expect(chip.className).toContain("rounded-full");

  const pick = vi.fn();
  render(
    <ChipGroup label="Inactive:">
      <ChipSegment onClick={() => pick("6")}>6 mo</ChipSegment>
      <ChipSegment on onClick={() => pick("12")}>1 yr</ChipSegment>
    </ChipGroup>);
  expect(screen.getByRole("group")).toBeTruthy();
  fireEvent.click(screen.getByText("6 mo"));
  expect(pick).toHaveBeenCalledWith("6");
  expect(screen.getByText("1 yr").getAttribute("aria-pressed")).toBe("true");
});

test("Notice shows its text and icon and can be dismissed", () => {
  const onClose = vi.fn();
  render(<Notice icon={<i data-testid="ic" />} onClose={onClose}>Heads up</Notice>);
  expect(screen.getByText("Heads up")).toBeTruthy();
  expect(screen.getByTestId("ic")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Dismiss"));
  expect(onClose).toHaveBeenCalledOnce();
});

function ToastHarness({ opts }: { opts?: Parameters<ReturnType<typeof useToast>["show"]>[1] }) {
  const toast = useToast();
  return <button onClick={() => toast.show("Saved", opts)}>fire</button>;
}

test("Toast auto-dismisses after 8s, errors stay, close button and action work", () => {
  vi.useFakeTimers();
  try {
    const undo = vi.fn();
    const { rerender } = render(
      <ToastProvider><ToastHarness /></ToastProvider>);
    fireEvent.click(screen.getByText("fire"));
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(document.querySelector("[aria-live=polite]")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(7900); });
    expect(screen.getByText("Saved")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText("Saved")).toBeNull();

    rerender(<ToastProvider>
      <ToastHarness opts={{ variant: "error" }} /></ToastProvider>);
    fireEvent.click(screen.getByText("fire"));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText("Saved")).toBeTruthy();          // errors persist
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByText("Saved")).toBeNull();

    rerender(<ToastProvider>
      <ToastHarness opts={{ action: { label: "Undo", onClick: undo } }} />
    </ToastProvider>);
    fireEvent.click(screen.getByText("fire"));
    fireEvent.click(screen.getByText("Undo"));
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText("Saved")).toBeNull();
  } finally { vi.useRealTimers(); }
});

test("toast stack sits on the toast layer above the bulk bar", () => {
  render(<ToastProvider><ToastHarness /></ToastProvider>);
  fireEvent.click(screen.getByText("fire"));
  const stack = document.querySelector("[aria-live=polite]") as HTMLElement;
  expect(stack.className).toContain("z-(--z-toast)");
  expect(stack.className).toContain("pmc-toasts");
});

test("confirmDialog resolves true on confirm, false on Cancel / Esc / backdrop", async () => {
  render(<DialogProvider><span>app</span></DialogProvider>);
  const opts = { title: "Delete?", body: "Gone", bullets: ["3 mails"],
    confirmLabel: "Delete", tone: "danger" as const };
  const ask = async (act2: () => void) => {
    let result: boolean | undefined;
    const p = confirmDialog(opts).then((v) => { result = v; });
    await screen.findByText("Delete?");
    expect(screen.getByText("3 mails")).toBeTruthy();
    await armed();
    act2();
    await p;
    expect(screen.queryByText("Delete?")).toBeNull();
    return result;
  };
  expect(await ask(() => fireEvent.click(screen.getByText("Delete")))).toBe(true);
  expect(await ask(() => fireEvent.click(screen.getByText("Cancel")))).toBe(false);
  expect(await ask(() => fireEvent.keyDown(window, { key: "Escape" }))).toBe(false);
  expect(await ask(() => fireEvent.click(
    screen.getByRole("dialog").parentElement!))).toBe(false);
});

test("a confirm tapped right after opening is ignored; after the delay it resolves", async () => {
  vi.useFakeTimers();
  try {
    const onResult = vi.fn();
    render(<ConfirmDialog title="Sure?" confirmLabel="Delete" tone="danger"
      onResult={onResult} />);
    // the 2nd tap of a double-tap (a pointer click has detail >= 1)
    fireEvent.click(screen.getByText("Delete"), { detail: 2 });
    expect(onResult).not.toHaveBeenCalled();
    expect(screen.getByText("Sure?")).toBeTruthy();   // still open
    fireEvent.click(screen.getByText("Cancel"));      // Cancel is never delayed
    expect(onResult).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(DIALOG_ARM_MS - 1);
    fireEvent.click(screen.getByText("Delete"), { detail: 1 });
    expect(onResult).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    fireEvent.click(screen.getByText("Delete"), { detail: 1 });
    expect(onResult).toHaveBeenLastCalledWith(true);
  } finally { vi.useRealTimers(); }
});

test("a keyboard-activated confirm (click detail 0) is not swallowed by the guard", () => {
  vi.useFakeTimers();
  try {
    const onResult = vi.fn();
    render(<ConfirmDialog title="Sure?" confirmLabel="Delete" tone="danger"
      onResult={onResult} />);
    fireEvent.click(screen.getByText("Delete"), { detail: 0 });
    expect(onResult).toHaveBeenCalledWith(true);
  } finally { vi.useRealTimers(); }
});

test("PromptDialog ignores a submit (Enter / tap) right after opening", () => {
  vi.useFakeTimers();
  try {
    const onResult = vi.fn();
    render(<PromptDialog title="Name" label="Name" initial="x" onResult={onResult} />);
    fireEvent.click(screen.getByText("OK"), { detail: 1 });
    expect(onResult).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DIALOG_ARM_MS);
    fireEvent.click(screen.getByText("OK"), { detail: 1 });
    expect(onResult).toHaveBeenCalledWith("x");
  } finally { vi.useRealTimers(); }
});

test("PromptDialog: Enter right after opening submits (keyboard is exempt)", () => {
  vi.useFakeTimers();
  try {
    const onResult = vi.fn();
    render(<PromptDialog title="Name" label="Name" initial="x" onResult={onResult} />);
    // Enter in a text field: the browser clicks the submit button, detail 0.
    fireEvent.click(screen.getByText("OK"), { detail: 0 });
    expect(onResult).toHaveBeenCalledWith("x");
  } finally { vi.useRealTimers(); }
});

test("danger confirm focuses Cancel, primary confirm focuses the confirm button", async () => {
  render(
    <ConfirmDialog title="T" confirmLabel="Do" tone="danger" onResult={() => {}} />);
  expect(document.activeElement).toBe(screen.getByText("Cancel"));
  cleanup();
  render(<ConfirmDialog title="T" confirmLabel="Do" onResult={() => {}} />);
  expect(document.activeElement).toBe(screen.getByText("Do"));
});

test("ConfirmDialog cancelLabel replaces Cancel", () => {
  const onResult = vi.fn();
  render(<ConfirmDialog title="T" confirmLabel="Do" cancelLabel="Only block"
    onResult={onResult} />);
  expect(screen.queryByText("Cancel")).toBeNull();
  fireEvent.click(screen.getByText("Only block"));
  expect(onResult).toHaveBeenCalledWith(false);
});

test("ensureAiAck asks once: declining stays unacknowledged, accepting is remembered", async () => {
  localStorage.clear();
  render(<DialogProvider><span /></DialogProvider>);
  let p = ensureAiAck();
  fireEvent.click(await screen.findByText("Cancel"));
  expect(await p).toBe(false);
  expect(localStorage.getItem("pmc_ai_ack")).toBeNull();
  p = ensureAiAck();
  await screen.findByText("Continue");
  await armed();
  fireEvent.click(screen.getByText("Continue"));
  expect(await p).toBe(true);
  expect(await ensureAiAck()).toBe(true);        // no dialog the second time
  localStorage.clear();
});

test("ProtectButton exposes aria-pressed and an optional visible label", () => {
  const { rerender } = render(<ProtectButton on={false} showLabel onClick={() => {}} />);
  const btn = screen.getByRole("button");
  expect(btn.getAttribute("aria-pressed")).toBe("false");
  expect(btn.textContent).toBe("Protect");
  rerender(<ProtectButton on showLabel onClick={() => {}} />);
  expect(btn.getAttribute("aria-pressed")).toBe("true");
  expect(btn.textContent).toBe("Protected");
});

test("confirmDialog rejects without a provider (the action must not proceed)", async () => {
  await expect(confirmDialog({ title: "x", confirmLabel: "y" }))
    .rejects.toThrow(/DialogProvider/);
});

test("promptDialog validates, submits the value, and cancels with null", async () => {
  render(<DialogProvider><span>app</span></DialogProvider>);
  const validate = (v: string) => (v.trim() ? null : "Name required");
  let p = promptDialog({ title: "Rename", label: "Name", initial: "old", validate });
  const input = (await screen.findByLabelText("Name")) as HTMLInputElement;
  expect(input.value).toBe("old");
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: "  " } });
  expect(screen.getByRole("alert").textContent).toBe("Name required");
  await armed();
  fireEvent.click(screen.getByText("OK"));              // invalid: stays open
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.change(input, { target: { value: "new" } });
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByText("OK"));
  expect(await p).toBe("new");

  p = promptDialog({ title: "Rename", label: "Name" });
  await screen.findByLabelText("Name");
  fireEvent.click(screen.getByText("Cancel"));
  expect(await p).toBeNull();
});

test("Modal sizes map to 448 / 672 / 768 px, full = lg at fixed height", () => {
  const panel = () => screen.getByText("body").closest<HTMLElement>("[role=dialog]")!;
  const sizes: [Parameters<typeof Modal>[0]["size"], string][] = [
    ["sm", "sm:max-w-md"], ["md", "sm:max-w-2xl"], ["lg", "sm:max-w-3xl"]];
  for (const [size, cls] of sizes) {
    render(<Modal size={size} onClose={() => {}}>body</Modal>);
    expect(panel().className).toContain(cls);
    cleanup();
  }
  render(<Modal full onClose={() => {}}>body</Modal>);
  expect(panel().className).toContain("sm:max-w-3xl");
  expect(panel().className).toContain("sm:h-[88vh]");
  expect(panel().className).toContain("h-dvh");     // full-screen on phones
  cleanup();
  render(<Modal onClose={() => {}}>body</Modal>);   // default md, shrinks to content
  expect(panel().className).toContain("sm:max-w-2xl");
  expect(panel().className).toContain("sm:h-auto");
  // phone insets: top for every full-screen modal, bottom for the content-
  // sized ones (full panels put the inset on their own footers)
  expect(panel().className).toContain("max-sm:pt-[env(safe-area-inset-top)]");
  expect(panel().className).toContain("max-sm:pb-[env(safe-area-inset-bottom)]");
  cleanup();
  render(<Modal size="sm" onClose={() => {}}>body</Modal>);   // phone bottom sheet
  expect(panel().className).not.toContain("h-dvh");
  expect(panel().parentElement!.className).toContain("items-end");
  expect(panel().parentElement!.className).toContain("bg-overlay");
});

test("EmptyState keeps children usage and adds icon/title/hint/action", () => {
  const { rerender } = render(<EmptyState>nothing</EmptyState>);
  expect(screen.getByText("nothing")).toBeTruthy();
  rerender(<EmptyState icon={<i data-testid="i" />} title="No mails"
    hint="Try a scan" action={<button>Scan</button>} />);
  for (const x of ["No mails", "Try a scan", "Scan"]) {
    expect(screen.getByText(x)).toBeTruthy();
  }
  expect(screen.getByTestId("i")).toBeTruthy();
});

test("MailRow: checkbox and open are separate targets, unread/selected states", () => {
  const onToggle = vi.fn();
  const onOpen = vi.fn();
  const { container } = render(
    <MailRow checked={false} onToggle={onToggle} unread subject="Hello"
      meta="6 Oct · me@x" trailing={<button>pin</button>} onOpen={onOpen}
      selected />);
  fireEvent.click(screen.getByLabelText("Select mail"));
  expect(onToggle).toHaveBeenCalledOnce();
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Hello"));
  expect(onOpen).toHaveBeenCalledOnce();
  expect(screen.getByText("6 Oct · me@x")).toBeTruthy();
  expect(screen.getByText("unread")).toBeTruthy();   // not only a coloured dot
  expect((container.firstChild as HTMLElement).dataset.selected).toBe("true");
  fireEvent.click(screen.getByText("pin"));
  expect(onOpen).toHaveBeenCalledOnce();
});

test("MailRow without onToggle has no checkbox", () => {
  render(<MailRow subject="S" onOpen={() => {}} />);
  expect(screen.queryByRole("checkbox")).toBeNull();
});

test("Esc closes only the topmost modal, even after parent re-renders", async () => {
  const closePanel = vi.fn();
  let bump!: () => void;
  const Parent = () => {
    const [n, setN] = useState(0);
    bump = () => setN((x) => x + 1);
    // inline onClose: a new function identity on every render
    return <Modal onClose={() => closePanel(n)}>panel</Modal>;
  };
  render(<DialogProvider><Parent /></DialogProvider>);
  expect(isModalOpen()).toBe(true);
  let result: boolean | undefined;
  const p = confirmDialog({ title: "Sure?", confirmLabel: "Yes" })
    .then((v) => { result = v; });
  await screen.findByText("Sure?");
  act(() => bump());                    // must not move the panel above the confirm
  fireEvent.keyDown(window, { key: "Escape" });
  await p;
  expect(result).toBe(false);
  expect(closePanel).not.toHaveBeenCalled();          // panel stays open
  expect(screen.getByText("panel")).toBeTruthy();
  await waitFor(() => expect(screen.queryByText("Sure?")).toBeNull());
  fireEvent.keyDown(window, { key: "Escape" });       // now it is the top
  expect(closePanel).toHaveBeenCalledExactlyOnceWith(1);   // latest onClose
  cleanup();
  expect(isModalOpen()).toBe(false);
});

test("Modal is always a labelled dialog (labelledBy / describedBy)", () => {
  render(<Modal onClose={() => {}} labelledBy="h" describedBy="d">
    <h2 id="h">Heading</h2><p id="d">Details</p></Modal>);
  const dlg = screen.getByRole("dialog");
  expect(dlg.getAttribute("aria-modal")).toBe("true");
  expect(screen.getByRole("dialog", { name: "Heading" })).toBe(dlg);
  expect(dlg.getAttribute("aria-describedby")).toBe("d");
});

test("ConfirmDialog is named by its heading and described by its body", () => {
  render(<ConfirmDialog title="Delete 3?" body="Cannot be undone"
    bullets={["a"]} confirmLabel="Delete" onResult={() => {}} />);
  const dlg = screen.getByRole("dialog", { name: "Delete 3?" });
  const desc = document.getElementById(dlg.getAttribute("aria-describedby")!)!;
  expect(desc.textContent).toContain("Cannot be undone");
  expect(desc.textContent).toContain("a");
});

test("a toast's timer is not restarted by re-renders or other toasts", () => {
  vi.useFakeTimers();
  try {
    let api!: ReturnType<typeof useToast>;
    const Grab = () => { api = useToast(); return null; };
    const { rerender } = render(<ToastProvider><Grab /></ToastProvider>);
    act(() => { api.show("first"); });
    act(() => { vi.advanceTimersByTime(7000); });
    act(() => { api.show("second"); });               // provider re-renders
    rerender(<ToastProvider><Grab /></ToastProvider>);
    act(() => { vi.advanceTimersByTime(1100); });     // first is now 8.1 s old
    expect(screen.queryByText("first")).toBeNull();
    expect(screen.getByText("second")).toBeTruthy();
    // parent re-rendering every 3 s must not keep a toast alive either
    for (let i = 0; i < 3; i++) {
      rerender(<ToastProvider><Grab /></ToastProvider>);
      act(() => { vi.advanceTimersByTime(3000); });
    }
    expect(screen.queryByText("second")).toBeNull();
  } finally { vi.useRealTimers(); }
});

test("toast variants carry an icon; errors are role=alert, others are not", () => {
  let api!: ReturnType<typeof useToast>;
  const Grab = () => { api = useToast(); return null; };
  render(<ToastProvider><Grab /></ToastProvider>);
  act(() => {
    api.show("fine", { variant: "success" });
    api.show("info!");
    api.show("broke", { variant: "error" });
  });
  for (const v of ["info", "success", "error"]) {
    const el = document.querySelector(`[data-variant=${v}]`)!;
    expect(el.querySelector("svg")).toBeTruthy();
  }
  expect(screen.getByRole("alert").textContent).toContain("broke");
  expect(document.querySelectorAll("[role=alert]")).toHaveLength(1);
});

test("ChipGroup is named by its label; segments keep their ring inside the pill", () => {
  render(<ChipGroup label="Inactive:">
    <ChipSegment>6 mo</ChipSegment></ChipGroup>);
  expect(screen.getByRole("group", { name: "Inactive:" })).toBeTruthy();
  const seg = screen.getByText("6 mo");
  expect(seg.className).toContain("focus-visible:-outline-offset-2");
  expect(seg.className).toContain("whitespace-nowrap");
  render(<Chip>One</Chip>);
  expect(screen.getByText("One").className).toContain("whitespace-nowrap");
});

test("DialogProvider returns focus to the opener and settles pending on unmount", async () => {
  const { unmount } = render(<DialogProvider>
    <button>opener</button></DialogProvider>);
  const opener = screen.getByText("opener");
  opener.focus();
  const p = confirmDialog({ title: "Sure?", confirmLabel: "Yes" });
  await screen.findByText("Sure?");
  await waitFor(() => expect(document.activeElement).not.toBe(opener));
  await armed();
  fireEvent.click(screen.getByText("Yes"));
  expect(await p).toBe(true);
  await waitFor(() => expect(document.activeElement).toBe(opener));

  const pending = confirmDialog({ title: "Again?", confirmLabel: "Yes" });
  const prompt = promptDialog({ title: "New name", label: "Name" });
  await screen.findByText("Again?");
  unmount();
  expect(await pending).toBe(false);
  expect(await prompt).toBeNull();
});

test("queued dialogs are removed by id and shown one after another", async () => {
  render(<DialogProvider><span>app</span></DialogProvider>);
  const a = confirmDialog({ title: "First", confirmLabel: "Yes" });
  const b = confirmDialog({ title: "Second", confirmLabel: "Yes" });
  await screen.findByText("First");
  expect(screen.queryByText("Second")).toBeNull();
  await armed();
  fireEvent.click(screen.getByText("Yes"));
  expect(await a).toBe(true);
  await screen.findByText("Second");
  fireEvent.click(screen.getByText("Cancel"));
  expect(await b).toBe(false);
});

test("PromptDialog with an invalid initial value shows the error on submit", async () => {
  render(<DialogProvider><span>app</span></DialogProvider>);
  const p = promptDialog({ title: "New name", label: "Name", initial: "",
    validate: (v) => (v ? null : "Required") });
  const input = await screen.findByLabelText("Name");
  expect(screen.queryByRole("alert")).toBeNull();
  await armed();
  fireEvent.submit(input.closest("form")!);           // Enter
  expect(screen.getByRole("alert").textContent).toBe("Required");
  fireEvent.click(screen.getByText("Cancel"));
  expect(await p).toBeNull();
});

test("ConfirmDialog body scrolls; sm Modal is capped in height", () => {
  render(<ConfirmDialog title="T" bullets={Array.from({ length: 80 }, (_, i) => `m${i}`)}
    confirmLabel="Go" onResult={() => {}} />);
  const dlg = screen.getByRole("dialog");
  expect(dlg.className).toContain("max-h-[88dvh]");
  expect(screen.getByText("T").parentElement!.className)
    .toContain("overflow-y-auto");
});

test("MailRow: transparent base border, underline on the subject only, compact checkbox", () => {
  const { container } = render(
    <MailRow subject="Hi" meta="6 Oct" onToggle={() => {}} onOpen={() => {}} />);
  const row = container.firstChild as HTMLElement;
  expect(row.className).toContain("border-l-2");
  expect(row.className).toContain("border-l-transparent");
  expect(screen.getByText("Hi").className).toContain("group-hover:underline");
  expect(screen.getByText("6 Oct").className).not.toContain("underline");
  expect(screen.getByLabelText("Select mail").closest("label")!.className)
    .toContain("-my-3");
});

test("focus ring CSS: base outline colour, offset only for text-like fields", async () => {
  const css = await indexCss();
  // The ring rules live in @layer base so utilities (-outline-offset-2,
  // outline-accent/60) can override them. jsdom can't compute cascade
  // layers, so pin the source structure; the computed values were checked
  // in headless Chromium (see PR).
  const base = css.slice(css.indexOf("@layer base {"));
  expect(base).toMatch(/:where\(\*\) \{[^}]*outline-color: var\(--color-accent\)/);
  expect(base).toMatch(/^  :focus-visible \{/m);
  expect(css).toMatch(/input:not\(\[type="checkbox"\][^{]*\):focus-visible/);
});

test("Tag tones map to the semantic bg/fg pairs on the caption layer", () => {
  render(<>
    <Tag>plain</Tag>
    <Tag tone="safe">safe</Tag>
    <Tag tone="attach">attach</Tag>
  </>);
  expect(screen.getByText("plain").className).toContain("type-caption");
  expect(screen.getByText("plain").className).toContain("bg-chip");
  expect(screen.getByText("safe").className).toContain("bg-safe-bg");
  expect(screen.getByText("safe").className).toContain("text-safe-fg");
  expect(screen.getByText("attach").className).toContain("bg-attach-bg");
});

test("LINK is the shared underline look for text buttons", () => {
  expect(LINK).toContain("underline");
});

test("ProgressBar: determinate carries its value, indeterminate none", () => {
  const { rerender } = render(<ProgressBar thin value={3} max={12} label="x" />);
  const bar = screen.getByRole("progressbar");
  expect(bar.getAttribute("aria-valuenow")).toBe("3");
  expect(bar.className).toContain("h-0.5");
  rerender(<ProgressBar thin indeterminate value={0} max={0} label="x" />);
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow"))
    .toBeNull();
});

test("Segmented marks the current segment and reports a change", () => {
  const onChange = vi.fn();
  render(
    <Segmented label="View" value="b" onChange={onChange}
      options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />);
  expect(screen.getByRole("tablist", { name: "View" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "B" }).getAttribute("aria-selected"))
    .toBe("true");
  expect(screen.getByRole("tab", { name: "A" }).getAttribute("aria-selected"))
    .toBe("false");
  fireEvent.click(screen.getByRole("tab", { name: "A" }));
  expect(onChange).toHaveBeenCalledWith("a");
});

test("a Menu with a variant renders a Button trigger", () => {
  render(<Menu variant="secondary" trigger={<>Tools</>}>
    <MenuItem>One</MenuItem></Menu>);
  const b = screen.getByRole("button", { name: "Tools" });
  expect(b.className).toContain("bg-chip");
  fireEvent.click(b);
  expect(screen.getByText("One")).toBeTruthy();
});

test("Segmented: roving tabindex, arrows move focus only, Enter activates",
  () => {
    const onChange = vi.fn();
    render(
      <Segmented label="View" value="b" onChange={onChange}
        options={[{ value: "a", label: "A" }, { value: "b", label: "B" },
          { value: "c", label: "C" }]} />);
    const tab = (n: string) => screen.getByRole("tab", { name: n });
    expect(tab("B").tabIndex).toBe(0);
    expect(tab("A").tabIndex).toBe(-1);
    tab("B").focus();
    fireEvent.keyDown(tab("B"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab("C"));
    fireEvent.keyDown(tab("C"), { key: "ArrowRight" });   // wraps
    expect(document.activeElement).toBe(tab("A"));
    fireEvent.keyDown(tab("A"), { key: "End" });
    expect(document.activeElement).toBe(tab("C"));
    fireEvent.keyDown(tab("C"), { key: "Home" });
    expect(document.activeElement).toBe(tab("A"));
    fireEvent.keyDown(tab("A"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tab("C"));
    expect(onChange).not.toHaveBeenCalled();              // manual activation
    fireEvent.click(tab("C"));
    expect(onChange).toHaveBeenCalledWith("c");
  });

test("Menu: roles, focus on open, arrow keys, Esc / Tab return focus", () => {
  render(<><Menu label="More" trigger={<>⋯</>}>
    <MenuItem>One</MenuItem><MenuItem disabled>Two</MenuItem>
    <MenuItem>Three</MenuItem></Menu><button>after</button></>);
  const trigger = screen.getByLabelText("More");
  expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  fireEvent.click(trigger);
  expect(screen.getByRole("menu")).toBeTruthy();
  const one = screen.getByRole("menuitem", { name: "One" });
  const three = screen.getByRole("menuitem", { name: "Three" });
  expect(document.activeElement).toBe(one);
  fireEvent.keyDown(one, { key: "ArrowDown" });          // skips disabled
  expect(document.activeElement).toBe(three);
  fireEvent.keyDown(three, { key: "ArrowDown" });
  expect(document.activeElement).toBe(one);
  fireEvent.keyDown(one, { key: "ArrowUp" });
  expect(document.activeElement).toBe(three);
  fireEvent.keyDown(three, { key: "Home" });
  expect(document.activeElement).toBe(one);
  fireEvent.keyDown(one, { key: "End" });
  expect(document.activeElement).toBe(three);

  fireEvent.keyDown(three, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);

  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "One" }),
    { key: "Tab" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);

  fireEvent.click(trigger);                              // item click closes
  fireEvent.click(screen.getByRole("menuitem", { name: "One" }));
  expect(document.activeElement).toBe(trigger);
});

test("Esc in a Menu inside a Modal closes only the menu; then the Modal", () => {
  const onClose = vi.fn();
  render(<Modal onClose={onClose}>
    <Menu label="More" trigger={<>⋯</>}><MenuItem>One</MenuItem></Menu>
  </Modal>);
  const trigger = screen.getByLabelText("More");
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "One" }),
    { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
  fireEvent.keyDown(trigger, { key: "Escape" });         // no menu open now
  expect(onClose).toHaveBeenCalledOnce();
});

test("BulkBar renders every slot, Clear works, and --bulkbar-h follows its mount", () => {
  const onClear = vi.fn();
  const root = document.documentElement.style;
  const offset = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get")
    .mockReturnValue(96);
  const { unmount } = render(
    <BulkBar summary="2 groups · 5 mails" onClear={onClear}
      secondary={<button>Export</button>} modifiers={<span>Limit to:</span>}
      action={<span>Action slot</span>} primary={<button>Trash 5</button>} />);
  expect(screen.getByRole("region", { name: "Selection actions" })).toBeTruthy();
  for (const txt of ["2 groups · 5 mails", "Export", "Limit to:",
    "Action slot", "Trash 5"]) expect(screen.getByText(txt)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(onClear).toHaveBeenCalled();
  expect(root.getPropertyValue("--bulkbar-h")).toBe("96px");
  unmount();
  expect(root.getPropertyValue("--bulkbar-h")).toBe("");
  offset.mockRestore();
});

test("MailRow: every part of the row is a target (no dead strips)", () => {
  render(<MailRow subject="Hi" meta="x" onToggle={() => {}} onOpen={() => {}}
    trailing={<button>pin</button>} />);
  expect(screen.getByLabelText("Select mail").closest("label")!.className)
    .toContain("-ml-3");
  const open = screen.getByText("Hi").closest("button")!;
  expect(open.className).toContain("-my-3");
  expect(open.className).toContain("self-stretch");
  expect(screen.getByText("pin").parentElement!.className)
    .toContain("self-stretch");
});

test("MailRow: dateIso renders a ShortDate with the ISO day as tooltip", () => {
  render(<MailRow subject="Hi" meta="x" dateIso="2025-01-02" />);
  expect(screen.getByText("2 Jan 2025").getAttribute("title"))
    .toBe("2025-01-02");
});

test("Modal moves focus in, traps Tab (both directions) and restores focus on close", () => {
  const Host = () => {
    const [open, setOpen] = useState(false);
    return <>
      <button onClick={() => setOpen(true)}>open</button>
      <button>behind</button>
      {open && <Modal onClose={() => setOpen(false)}>
        <button>first</button><input aria-label="mid" />
        <button>last</button>
      </Modal>}
    </>;
  };
  render(<Host />);
  const opener = screen.getByText("open");
  opener.focus();
  fireEvent.click(opener);
  const dlg = screen.getByRole("dialog");
  expect(dlg.contains(document.activeElement)).toBe(true);
  const [first, last] = [screen.getByText("first"), screen.getByText("last")];
  // Tab from the last control wraps to the first, never to the page behind.
  last.focus();
  expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false);   // prevented
  expect(document.activeElement).toBe(first);
  expect(fireEvent.keyDown(first, { key: "Tab", shiftKey: true })).toBe(false);
  expect(document.activeElement).toBe(last);
  // Mid-dialog Tab is left to the browser (not prevented).
  const mid = screen.getByLabelText("mid");
  mid.focus();
  expect(fireEvent.keyDown(mid, { key: "Tab" })).toBe(true);
  // Focus that escaped to the page is pulled back in.
  screen.getByText("behind").focus();
  fireEvent.keyDown(document.body, { key: "Tab" });
  expect(dlg.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
});

test("a nested modal traps on its own and hands focus back to the one below", () => {
  const Host = () => {
    const [inner, setInner] = useState(false);
    return <Modal onClose={() => {}}>
      <button onClick={() => setInner(true)}>spawn</button>
      {inner && <Modal size="sm" onClose={() => setInner(false)}>
        <button>only</button></Modal>}
    </Modal>;
  };
  render(<Host />);
  const spawn = screen.getByText("spawn");
  spawn.focus();
  fireEvent.click(spawn);
  const only = screen.getByText("only");
  only.focus();
  fireEvent.keyDown(only, { key: "Tab" });
  expect(document.activeElement).toBe(only);            // wraps onto itself
  fireEvent.keyDown(window, { key: "Escape" });
  expect(document.activeElement).toBe(spawn);
});

test("RatingChips: a labelled button whose popover explains the counts", () => {
  const onRow = vi.fn();
  render(<div onClick={onRow}>
    <RatingChips ratings={{ delete_safe: 3, review: 0, keep: 2 }} />
  </div>);
  const btn = screen.getByRole("button", {
    name: "Per-mail AI ratings: 3 safe to delete, 2 keep" });
  expect(btn.textContent).toBe("🟢3🔴2");            // zero buckets stay out
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(btn);
  const pop = screen.getByRole("dialog", { name: "Per-mail AI ratings" });
  expect(pop.textContent).toContain("3 safe to delete");
  expect(pop.textContent).toContain("2 keep");
  expect(btn.getAttribute("aria-expanded")).toBe("true");
  expect(onRow).not.toHaveBeenCalled();             // never opens the row
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("using a toast's button while a panel is open returns focus to that panel, not <body>", () => {
  let show!: ReturnType<typeof useToast>["show"];
  const Grab = () => { show = useToast().show; return null; };
  render(<ToastProvider><Grab />
    <Modal onClose={() => {}}><button>inside</button></Modal></ToastProvider>);
  const dlg = screen.getByRole("dialog");
  const ran = vi.fn();
  act(() => { show("Moved", { action: { label: "Undo", onClick: ran } }); });
  const undo = screen.getByRole("button", { name: "Undo" });
  undo.focus();                                    // what a click does
  expect(document.activeElement).toBe(undo);
  fireEvent.click(undo);
  expect(ran).toHaveBeenCalled();
  expect(screen.queryByText("Moved")).toBeNull();  // toast gone ...
  expect(document.activeElement).toBe(dlg);        // ... focus is not
  // Dismiss (X) behaves the same.
  act(() => { show("Again"); });
  const x = screen.getByRole("button", { name: "Dismiss" });
  x.focus();
  fireEvent.click(x);
  expect(document.activeElement).toBe(dlg);
});

test("Tab inside a dialog can reach a toast's Undo; the trap still wraps around it", () => {
  let show!: ReturnType<typeof useToast>["show"];
  const Grab = () => { show = useToast().show; return null; };
  render(<ToastProvider><Grab />
    <Modal onClose={() => {}}><button>first</button><button>last</button></Modal>
  </ToastProvider>);
  act(() => { show("Moved", { action: { label: "Undo", onClick: () => {} } }); });
  const last = screen.getByText("last");
  last.focus();
  expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(true);   // browser moves on to the toast
  const undo = screen.getByRole("button", { name: "Undo" });
  undo.focus();
  const dismiss = screen.getByRole("button", { name: "Dismiss" });
  dismiss.focus();
  expect(fireEvent.keyDown(dismiss, { key: "Tab" })).toBe(false);  // end of the trap
  expect(document.activeElement).toBe(screen.getByText("first"));
  fireEvent.keyDown(screen.getByText("first"), { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(dismiss);                   // wraps backwards into the toasts
});

test("if the opener vanished while the dialog was open, focus falls back to its list", () => {
  const Host = () => {
    const [open, setOpen] = useState(false);
    const [row, setRow] = useState(true);
    return <div data-focus-return tabIndex={-1} data-testid="list">
      {row && <button onClick={() => setOpen(true)}>row</button>}
      {open && <Modal onClose={() => setOpen(false)}>
        <button onClick={() => setRow(false)}>trash all</button></Modal>}
    </div>;
  };
  render(<Host />);
  const row = screen.getByText("row");
  row.focus();
  fireEvent.click(row);
  fireEvent.click(screen.getByText("trash all"));     // the row unmounts
  expect(screen.queryByText("row")).toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByTestId("list"));
});
