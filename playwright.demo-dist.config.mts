import { defineConfig, devices } from '@playwright/test';
import { DEMO_DIST_OWNERS, demoDistInputs } from './scripts/website/demo-dist-validation.mjs';

// Production /try/ owners run against the already-built, disposable combined
// Pages artifact. Never borrow the development server or modify upload input.
const inputs = demoDistInputs();
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export default defineConfig({
  testDir: `${process.cwd()}/tests/e2e/browser`,
  testMatch: DEMO_DIST_OWNERS,
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  failOnFlakyTests: true,
  updateSnapshots: 'none',
  globalTimeout: 15 * 60 * 1000,
  timeout: 120000,
  expect: { timeout: 15000 },
  outputDir: inputs.outputDir,
  reporter: [['list'], ['json', { outputFile: inputs.report }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', actionTimeout: 45000 },
  webServer: {
    command: `node apps/website/scripts/serve-dist.mjs ${inputs.port} ${shellQuote(inputs.distDir)}`,
    url: inputs.origin,
    reuseExistingServer: false,
    timeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        baseURL: inputs.origin,
      },
    },
  ],
});
