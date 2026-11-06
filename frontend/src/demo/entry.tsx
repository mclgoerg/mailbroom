/* Entry of the demo build (main.tsx, only when VITE_DEMO=1). */

import type { Root } from "react-dom/client";
import { StrictMode } from "react";
import { DialogProvider, ToastProvider } from "../components/ui";
import { DemoRoot } from "./DemoRoot";
import { installDemo } from "./install";
import { DemoRuntime } from "./runtime";

export function mountDemo(root: Root): void {
  const runtime = new DemoRuntime({
    createWorker: () => new Worker(new URL("./worker.ts", import.meta.url),
      { type: "module" }) as never,
    // the bundle sits next to the UI: <base>bundle/ (scripts/demo-bundle)
    bundle: new URL(`${import.meta.env.BASE_URL}bundle/`, location.href).href,
  });
  installDemo(runtime);
  runtime.start();
  root.render(
    <StrictMode>
      <ToastProvider>
        <DialogProvider>
          <DemoRoot runtime={runtime} />
        </DialogProvider>
      </ToastProvider>
    </StrictMode>,
  );
}
