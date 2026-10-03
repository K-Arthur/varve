import { defineConfig, devices } from '@playwright/test';
import { resolveRunOutput } from './scripts/quality/playwright-run-output.mjs';
import { websiteE2ePorts } from './scripts/website/e2e-ports.cjs';

/**
 * Website E2E configuration.
 *
 * Runs the same suite twice:
 *   - ghpages:       legacy GitHub Pages project-mode build (base /varve),
 *                    built by `pnpm build:website:pages` into dist-pages
 *   - custom-domain: production build for the custom domain (base /),
 *                    built by `pnpm build:website` into dist
 *
 * Both builds are produced by `pnpm test:website:e2e` before the run.
 */
// Local defaults avoid Astro's 4321 dev server; explicit environment overrides win.
const { pages: GH_PAGES_PORT, root: CUSTOM_PORT } = websiteE2ePorts();
const workers = Number(process.env.VARVE_E2E_WORKERS ?? '1');
if (!Number.isInteger(workers) || workers < 1) {
  throw new Error(`VARVE_E2E_WORKERS must be a positive integer; received ${workers}`);
}
const outputSuffix = resolveRunOutput(process.env, { prefix: 'website', port: GH_PAGES_PORT });

export default defineConfig({
  testDir: './apps/website/tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers,
  outputDir: `test-results/${outputSuffix}`,
  reporter: [
    ['list'],
    [
      './scripts/quality/browser-progress.mjs',
      { outputFile: `test-results/${outputSuffix}/progress.json` },
    ],
    ...(process.env.VARVE_CI_PLAYWRIGHT_REPORT
      ? [['json', { outputFile: process.env.VARVE_CI_PLAYWRIGHT_REPORT }] as const]
      : []),
  ],
  timeout: 45000,
  expect: { timeout: 10000 },
  webServer: [
    {
      command: `node apps/website/scripts/serve-dist.mjs ${GH_PAGES_PORT} apps/website/dist-pages`,
      port: GH_PAGES_PORT,
      reuseExistingServer: false,
      timeout: 15000,
    },
    {
      command: `node apps/website/scripts/serve-dist.mjs ${CUSTOM_PORT} apps/website/dist`,
      port: CUSTOM_PORT,
      reuseExistingServer: false,
      timeout: 15000,
    },
  ],
  projects: [
    {
      name: 'ghpages',
      testMatch: /.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${GH_PAGES_PORT}/varve`,
      },
      testIgnore: /touch-targets\.spec\.ts/,
    },
    {
      name: 'custom-domain',
      testMatch: /.*\.spec\.ts/,
      // Rendering is base-path independent; the visual baselines run once.
      testIgnore: /(visual|touch-targets)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${CUSTOM_PORT}/`,
      },
    },
    {
      name: 'touch',
      testMatch: /touch-targets\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        baseURL: `http://127.0.0.1:${GH_PAGES_PORT}/varve`,
      },
    },
  ],
});
