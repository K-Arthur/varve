import { defineConfig, devices } from '@playwright/test';

/**
 * Persistent-profile config: reuses a chromium user-data dir so the app's
 * JS is served from the disk cache and navigation fits well inside the
 * hard-coded 120s goto budget even under concurrent workspace load.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 1200000,
  expect: { timeout: 60000 },
  fullyParallel: false,
  workers: 1,
  outputDir: 'test-results/warm-1431',
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:1431',
    trace: 'retain-on-failure',
    contextOptions: {},
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'] },
    },
  ],
});
