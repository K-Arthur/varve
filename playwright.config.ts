import { defineConfig, devices } from '@playwright/test';

const e2ePort = process.env.VARVE_E2E_PORT ?? '1420';
const e2eBaseUrl = `http://localhost:${e2ePort}`;

export default defineConfig({
  testDir: './tests/e2e',
  // Warm the dev server's module graph before any spec runs (see
  // tests/e2e/global-setup.ts) — first-load transform of this app takes
  // ~90-100s on a cold cache and killed the first test of every run.
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: 'html',
  // 180s: measured cold first-paint on a fresh vite transform cache is ~100s
  // on this machine and worse on CI runners (shared cache, slower disks). A
  // 60s test timeout made every spec die in navigateToEditor's page.goto on
  // the first test of a run even though the dev server itself was healthy.
  // Assertion/action timeouts (expect 10s, per-step 15-45s) still bound real
  // hangs; this only extends the navigation/compile budget.
  timeout: 180000,
  expect: { timeout: 10000 },
  use: {
    baseURL: e2eBaseUrl,
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
      testIgnore: /visual\/replay\.spec\.ts/,
    },
    {
      name: 'chromium-snapshot',
      use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'] },
      testMatch: /guides-visual\.spec\.ts/,
    },
    // Visual regression harness (tests/e2e/visual/replay.spec.ts): one
    // project per DPR. 1x/2x always run; 3x is behind an env var since a
    // third full baseline set roughly triples this suite's snapshot count
    // and CI time for a tier DPR bugs are least likely to hide in.
    {
      name: 'chromium-visual-1x',
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 },
      testMatch: /visual\/replay\.spec\.ts/,
    },
    {
      name: 'chromium-visual-2x',
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 2 },
      testMatch: /visual\/replay\.spec\.ts/,
    },
    ...(process.env.VARVE_VISUAL_3X
      ? [
          {
            name: 'chromium-visual-3x',
            use: { ...devices['Desktop Chrome'], deviceScaleFactor: 3 },
            testMatch: /visual\/replay\.spec\.ts/,
          },
        ]
      : []),
    {
      name: 'tauri',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /tauri\/.*\.spec\.ts/,
    },
    // WebGPU compute agreement (tests/e2e/effects/gpu-agreement.spec.ts):
    // Playwright's default headless-shell build ships without WebGPU, and
    // its default --no-startup-window flag prevents GPU process init
    // entirely. Drop the flag and enable the Vulkan/SwiftShader adapter
    // path; the spec skips when no adapter is available.
    {
      name: 'chromium-gpu',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        retries: process.env.CI ? 3 : 1,
        launchOptions: {
          pipe: false,
          ignoreDefaultArgs: ['--no-startup-window'],
          args: [
            '--enable-features=Vulkan',
            '--use-angle=vulkan',
            '--enable-unsafe-swiftshader',
            '--remote-debugging-port=0',
          ],
        },
      },
      testMatch: /effects\/gpu-agreement\.spec\.ts/,
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        // React's development build plus the full inspector can exceed
        // Firefox's headless slow-script watchdog on software-rendered CI.
        // Keep the watchdog enabled, but give real pointer workflows enough
        // time to finish. Production performance is covered separately.
        firefoxUserPrefs: { 'dom.max_script_run_time': 30 },
      },
    },
    // Safari/WebKit requires macOS for full testing — runs basic smoke tests on Linux
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `pnpm --filter @varve/desktop exec vite --port ${e2ePort}`,
    url: e2eBaseUrl,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
