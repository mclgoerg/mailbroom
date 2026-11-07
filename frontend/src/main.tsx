import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { DialogProvider, ToastProvider, watchSystemTheme } from "./components/ui";
import { installViewportGuard } from "./viewport";

installViewportGuard();
watchSystemTheme();

const root = createRoot(document.getElementById("root")!);

if (import.meta.env.VITE_DEMO === "1") {
  // The in-browser demo (demo/): a build-time switch, so the normal build
  // contains none of it.
  void import("./demo/entry").then((m) => m.mountDemo(root));
} else {
  root.render(
    <StrictMode>
      <ToastProvider>
        <DialogProvider>
          <App />
        </DialogProvider>
      </ToastProvider>
    </StrictMode>,
  );
}
