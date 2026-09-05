import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.ATLAS_TEST_PORT ?? 3211);
const externalBaseURL = process.env.ATLAS_TEST_BASE_URL;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: externalBaseURL ?? `http://127.0.0.1:${port}`,
    storageState: process.env.ATLAS_TEST_STORAGE_STATE,
    // Explicit automation opt-out for Vercel's preview-only feedback overlay.
    // This does not alter deployment protection or project settings.
    extraHTTPHeaders: process.env.ATLAS_SKIP_PREVIEW_TOOLBAR === "1"
      ? { "x-vercel-skip-toolbar": "1" }
      : undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: externalBaseURL ? undefined : {
    command: `npm run dev -- --port ${port}`,
    url: `http://127.0.0.1:${port}/atlas`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
