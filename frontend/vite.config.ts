import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Local dev: proxy API calls to the backend container/port.
    proxy: { "/api": "http://127.0.0.1:8765" },
  },
});
