/* Demo mode (the in-browser demo, backend/demo.py): the backend refuses
 * anything that needs a network ("Not available in the demo."), so the UI
 * disables those controls up front instead of inviting the error.
 *
 * The signal is either the `VITE_DEMO` build constant (the demo ships its
 * own `vite build`) or `demo: true` from /api/auth (App sets it). With
 * neither, isDemo() is false and every gate is a no-op. */

import { useSyncExternalStore } from "react";
import { t } from "./i18n";

let fromServer = false;
const listeners = new Set<() => void>();

export const isDemo = (): boolean =>
  import.meta.env.VITE_DEMO === "1" || fromServer;

export function setDemo(on: boolean): void {
  if (on === fromServer) return;
  fromServer = on;
  listeners.forEach((l) => l());
}

export function useDemo(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    isDemo);
}

/** The visible/tooltip reason for a gated control. */
export const demoHint = (): string => t("ferr.not_in_demo");
