import { defineConfig, devices } from '@playwright/test';

/**
 * Website E2E configuration.
 *
 * Runs the same suite twice:
 *   - ghpages:      static build for GitHub Pages project mode (base /varve)
 *   - custom-domain: static build for a custom domain (base /)
 *
 * Both builds are produced by `pnpm build:website:both` before the run.
 */
// Overridable so the suite can run alongside a website dev server, which
// occupies 4321 by default. Without this the run aborts with "port already
// used" and the only way out is killing the developer's own dev server.
const GH_PAGES_PORT = Number(process.env.VARVE_WEBSITE_E2E_PORT ?? 4321);
const CUSTOM_PORT = Number(process.env.VARVE_WEBSITE_E2E_PORT_ROOT ?? 4322);

export default defineConfig({
  testDir: './apps/website/tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 4,
  reporter: 'list',
  timeout: 45000,
  expect: { timeout: 10000 },
  webServer: [
    {
      command: `node apps/website/scripts/serve-dist.mjs ${GH_PAGES_PORT} apps/website/dist`,
      port: GH_PAGES_PORT,
      reuseExistingServer: false,
      timeout: 15000,
    },
    {
      command: `node apps/website/scripts/serve-dist.mjs ${CUSTOM_PORT} apps/website/dist-root`,
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
    },
    {
      name: 'custom-domain',
      testMatch: /.*\.spec\.ts/,
      // Rendering is base-path independent; the visual baselines run once.
      testIgnore: /visual\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${CUSTOM_PORT}/`,
      },
    },
  ],
});
