import { defineConfig, devices } from '@playwright/test';

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
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'] },
    },
  ],
});
