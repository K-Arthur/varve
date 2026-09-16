import { defineConfig, devices } from '@playwright/test';

/**
 * Inference-probe config: runs browser probes that own their own page and
 * runtime lifecycle, with no editor and no global setup.
 *
 * The probes in this config fulfil their own minimal COOP/COEP document and
 * drive ONNX Runtime in throwaway workers, so they need neither the editor
 * bundle nor the editor warm-up that `playwright.config.ts` performs. Keeping
 * them off the main config has two effects: a probe result cannot be
 * invalidated by an unrelated in-flight editor edit, and the probe is
 * reproducible on a machine where the editor's global setup cannot complete.
 *
 * Usage:
 *   VARVE_THREADED_WASM_PROBE=1 VARVE_E2E_PORT=1620 npx playwright test \\
 *     --config=playwright.inference-probe.config.ts
 */
const e2ePort = process.env.VARVE_E2E_PORT ?? '1620';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 10 * 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/inference-probe',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${e2ePort}`,
    viewport: { width: 640, height: 480 },
  },
  projects: [
    {
      name: 'chromium',
      testMatch: /(?:threaded-wasm-probe|discovery-preprocess-parity)\.spec\.ts/,
    },
  ],
  webServer: {
    command: `pnpm --filter @varve/desktop exec vite --port ${e2ePort}`,
    url: `http://localhost:${e2ePort}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
