/**
 * Global setup — warm the vite dev server before any test runs.
 *
 * The editor's module graph takes ~90-100s to transform on a cold cache
 * (measured on this machine; CI runners are slower). Without this warm-up,
 * the first test of every run died in navigateToEditor's page.goto or
 * .layers-panel wait even though the dev server itself was healthy.
 *
 * The warm-up runs once per `playwright test` invocation (before any spec),
 * loads the app in a real browser, and waits until the editor's home screen
 * is interactive. By the time the first test starts, vite has already
 * transformed the full module graph, so navigateToEditor's generous timeouts
 * are never exercised against a cold cache.
 *
 * The webServer (`pnpm --filter @varve/desktop exec vite`) is started by
 * Playwright before globalSetup runs. If it is not reachable, fail fast with
 * a clear message instead of letting every spec die with opaque timeouts.
 */
import type { FullConfig } from '@playwright/test';
import { type Browser, chromium } from '@playwright/test';

const PORT = Number(process.env.VARVE_E2E_PORT ?? '1420');
const BASE_URL = `http://localhost:${PORT}`;

async function waitForServer(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/`);
      if (res.ok) return;
    } catch {
      /* server not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Warm-up: dev server not reachable at ${BASE_URL} after ${timeoutMs}ms. ` +
      'Check the webServer command in playwright.config.ts.',
  );
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  await waitForServer(60_000);

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(BASE_URL, { timeout: 180_000, waitUntil: 'domcontentloaded' });
    // Handle safe mode dialog if present (from a previous crash)
    const continueBtn = page.getByRole('button', { name: /continue normal startup/i });
    if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await continueBtn.click({ timeout: 5000 });
      await page.waitForTimeout(1000);
    }
    // The editor's module graph (Menubar, CanvasArea, inspector, ...) is
    // lazy: vite only transforms it when the editor actually mounts. Waiting
    // for the home screen's New button alone leaves the expensive part
    // untouched. Click through to a real editor so the full graph is
    // transformed before any spec runs.
    await page.getByRole('button', { name: /^new$/i }).waitFor({
      state: 'visible',
      timeout: 180_000,
    });
    await page.getByRole('button', { name: /^new$/i }).click({ timeout: 30_000 });
    await page
      .locator('dialog[open]')
      .getByRole('button', { name: /^create design$/i })
      .waitFor({ timeout: 30_000 });
    await page
      .locator('dialog[open]')
      .getByRole('button', { name: /^create design$/i })
      .click({ timeout: 30_000 });
    await page
      .locator('.editor__layers-panel, .layers-panel')
      .first()
      .waitFor({ timeout: 180_000 });
    await page.close();
  } finally {
    await browser?.close();
  }
}
