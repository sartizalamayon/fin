import { defineConfig, devices } from "@playwright/test";

/**
 * Mobile-first: the primary E2E project is a phone viewport. Desktop is the
 * secondary check, not the other way round.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  /*
   * `channel: "chrome"` drives the locally installed Google Chrome instead of
   * Playwright's bundled Chromium. Set via PLAYWRIGHT_CHANNEL so CI can fall
   * back to the bundled build, while a machine without room for a ~540MB
   * browser download can still run the suite.
   */
  projects: [
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
      },
    },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm build && pnpm start",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
