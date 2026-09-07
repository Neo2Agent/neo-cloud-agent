import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const live = (process.env.E2E_WEB_URL || process.env.WEB_BASE_URL || "").replace(/\/$/, "");
const localPort = Number(process.env.E2E_UI_PORT ?? 18080);
const baseURL = live || `http://127.0.0.1:${localPort}`;
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  testDir: "./core/ui",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    locale: "zh-CN",
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    trace: "off",
  },
  webServer: live
    ? undefined
    : {
        command: "tsx e2e/core/ui/dev-server.ts",
        cwd: repoRoot,
        url: `${baseURL}/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        stdout: "pipe",
        stderr: "pipe",
      },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
});
