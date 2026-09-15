import { defineConfig, devices } from '@playwright/test';

/**
 * Local fidelity validation against an already-built, frozen desktop preview.
 * Start Vite preview separately and set VARVE_LAYER_FIDELITY_URL when it is
 * not listening on the default port. Keeping webServer out of this config is
 * intentional: HMR must not be able to change the document or provider graph
 * during a pixel/structure comparison.
 */
const baseURL = process.env.VARVE_LAYER_FIDELITY_URL ?? 'http://127.0.0.1:5491';
const outputDir =
  process.env.VARVE_LAYER_FIDELITY_OUTPUT_DIR ?? 'test-results/layer-fidelity-preview';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 180000,
  expect: { timeout: 15000 },
  outputDir,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['clipboard-read', 'clipboard-write'],
      },
      testIgnore: /visual\/replay\.spec\.ts/,
    },
  ],
});
