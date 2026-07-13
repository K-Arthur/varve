import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:1420',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    // clipboard-read/write permission grants are only supported by
    // Chromium's Permissions API — Firefox and WebKit fail context/page
    // creation outright ("Unknown permission") if asked to grant them, so
    // this is scoped to the Chromium projects rather than the top-level
    // `use` block.
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'] },
    },
    {
      name: 'chromium-snapshot',
      use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'] },
      testMatch: /guides-visual\.spec\.ts/,
    },
    {
      name: 'tauri',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /tauri\/.*\.spec\.ts/,
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // Safari/WebKit requires macOS for full testing — runs basic smoke tests on Linux
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'pnpm --filter @strata/desktop dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
