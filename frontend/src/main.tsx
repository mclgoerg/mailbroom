import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { installViewportGuard } from "./viewport";

installViewportGuard();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <DialogProvider>
        <App />
      </DialogProvider>
    </ToastProvider>
  </StrictMode>,
);
