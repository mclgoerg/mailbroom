import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.DEMO_PORT || 4173);

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  // A backend call that waits on a thread the demo never runs hangs the
  // worker for good: the per-test limit turns that into a clean failure.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: "chromium",
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node serve.mjs",
    url: `http://127.0.0.1:${PORT}/demo/`,
    reuseExistingServer: false,
    env: { DEMO_PORT: String(PORT) },
  },
});
