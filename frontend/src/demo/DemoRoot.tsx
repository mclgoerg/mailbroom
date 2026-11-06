import { useSyncExternalStore } from "react";
import App from "../App";
import { DemoBanner } from "./DemoBanner";
import { DemoBoot } from "./DemoBoot";
import type { DemoRuntime } from "./runtime";

/** Boot screen until the backend is up, then the banner and the real app.
 *  Resetting boots a fresh worker, which swaps the app out for the boot
 *  screen again (and so also drops the UI's own state). */
export function DemoRoot({ runtime }: { runtime: DemoRuntime }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getState);
  if (state.phase !== "ready") {
    return <DemoBoot state={state} onRetry={() => runtime.start()} />;
  }
  return (
    <>
      <DemoBanner onReset={() => runtime.start()} />
      <App />
    </>
  );
}
