/**
 * Browser demo PWA acceptance against a built /try artifact.
 *
 * The default E2E run uses the Vite dev server, where the demo service worker
 * is deliberately not registered (HMR would fight it). These checks only run
 * when `VARVE_DEMO_DIST_URL` points at a served production demo build, e.g.:
 *
 *   pnpm --filter @varve/desktop build:try
 *   node apps/website/scripts/serve-dist.mjs 1492 /tmp/varve-chromeos-stage2-serve
 *   VARVE_DEMO_DIST_URL=http://127.0.0.1:1492 \
 *     pnpm exec playwright test tests/e2e/browser/try-pwa.spec.ts \
 *       --project=chromium --workers=1 --reporter=line
 *
 * The serving directory must contain `try/index.html` and require an
 * `index.html` at its root (serve-dist's convention); see the stage 2 audit
 * for the exact staging command. Chromium only: service-worker install/update
 * semantics are the behavior under test.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const DEMO_DIST_URL = process.env.VARVE_DEMO_DIST_URL?.replace(/\/+$/, '');
const DEMO_DIST_DIR = process.env.VARVE_DEMO_DIST_DIR;
const SHELL_CACHE = 'varve-demo-shell-v2';
const UPDATE_MARKER_CACHE = 'varve-demo-pwa-test-marker';

async function gotoDemo(page: Page): Promise<void> {
  await page.goto(`${DEMO_DIST_URL}/try/`, { timeout: 120000, waitUntil: 'domcontentloaded' });
}

async function waitForEditorReady(page: Page): Promise<void> {
  await page.locator('[data-varve-editor-ready="true"]').waitFor({ timeout: 120000 });
}

async function dismissRecoveryDialog(page: Page): Promise<void> {
  const dialog = page.locator('dialog.crash-dialog[open]').first();
  if (await dialog.isVisible({ timeout: 1500 }).catch(() => false)) {
    await dialog
      .getByRole('button', { name: /review my documents|close/i })
      .first()
      .click({ timeout: 5000 })
      .catch(() => undefined);
  }
}

/** Wait until the service worker has cached the shell's entry graph. */
async function waitForPrecache(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async (cacheName: string) => {
          const names = await caches.keys();
          if (!names.includes(cacheName)) return 0;
          const cache = await caches.open(cacheName);
          const keys = await cache.keys();
          return keys.filter((key) => new URL(key.url).pathname.startsWith('/try/assets/')).length;
        }, SHELL_CACHE),
      { timeout: 180000, message: 'the shell entry graph should be precached' },
    )
    .toBeGreaterThan(0);
}

test.describe('browser demo PWA acceptance (built artifact)', () => {
  test.describe.configure({ timeout: 300000 });
  test.skip(!DEMO_DIST_URL, 'set VARVE_DEMO_DIST_URL to a served production /try build');
  test.skip(({ browserName }) => browserName !== 'chromium', 'service worker semantics: chromium');

  test('partial/unfinished offline setup gets a truthful unavailable page', async ({
    page,
    context,
  }) => {
    await gotoDemo(page);
    await waitForEditorReady(page);
    await dismissRecoveryDialog(page);

    // Simulate "the browser installed the worker but the app copy is gone or
    // was never completed" — the honest partial-precache state. A first-ever
    // offline visit with no worker at all cannot render app UI (no code has
    // ever run), which is why this state is the one the worker must answer.
    await page.evaluate(async () => {
      const names = await caches.keys();
      for (const name of names) {
        if (name.startsWith('varve-demo-shell-')) await caches.delete(name);
      }
    });

    await context.setOffline(true);
    try {
      const response = await page.goto(`${DEMO_DIST_URL}/try/`, {
        timeout: 60000,
        waitUntil: 'domcontentloaded',
      });
      // The worker answers with its own 503 document rather than pretending.
      expect(response?.status()).toBe(503);
      await expect(page.getByText(/not available offline yet/i)).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/nothing was deleted/i)).toBeVisible();
      await test.info().attach('offline-fallback.png', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    } finally {
      await context.setOffline(false);
    }
  });

  test('offline launch after a verified setup reaches the editor', async ({ page, context }) => {
    await gotoDemo(page);
    await waitForEditorReady(page);
    await dismissRecoveryDialog(page);
    await waitForPrecache(page);

    // The registration claims clients at activate, but the first document's
    // subresources were fetched before it existed; one online reload puts the
    // page fully under the worker, which is the "verified setup" condition.
    await page.reload({ timeout: 120000, waitUntil: 'domcontentloaded' });
    await waitForEditorReady(page);
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
        timeout: 60000,
        message: 'the demo page should be controlled by its service worker',
      })
      .toBe(true);

    await context.setOffline(true);
    try {
      await page.reload({ timeout: 120000, waitUntil: 'domcontentloaded' });
      await waitForEditorReady(page);
      await dismissRecoveryDialog(page);

      // Offline is stated, not implied away, and the sample document opened.
      await expect(page.locator('.varve-demo-banner__offline')).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 30000 });
      await test.info().attach('offline-relaunch.png', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    } finally {
      await context.setOffline(false);
    }
  });

  test('a waiting update is offered, not forced, and activates on request', async ({ page }) => {
    test.skip(
      !DEMO_DIST_DIR,
      'set VARVE_DEMO_DIST_DIR to the disposable staged build; the test replaces the served worker',
    );
    await gotoDemo(page);
    await waitForEditorReady(page);
    await dismissRecoveryDialog(page);

    // Byte-different worker written into the disposable staged copy. The
    // marker cache it creates on `activate` proves the new version actually
    // took over; nothing is modified in the repository or the deployed site.
    const servedWorkerPath = join(DEMO_DIST_DIR as string, 'try', 'varve-demo-sw.js');
    const originalWorker = readFileSync(servedWorkerPath, 'utf8');
    const updatedWorker = `${originalWorker}\nself.addEventListener('activate', () => { void caches.open('${UPDATE_MARKER_CACHE}'); });\n`;
    writeFileSync(servedWorkerPath, updatedWorker);
    try {
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration?.update();
      });

      const banner = page.locator('.varve-stale-asset-banner');
      await expect(banner).toBeVisible({ timeout: 60000 });
      await expect(banner).toContainText(/newer version/i);

      // Nothing reloads until the visitor chooses to; the page stays put.
      await expect(page.locator('[data-varve-editor-ready="true"]')).toBeVisible();

      await banner.getByRole('button', { name: /update and reload/i }).click();
      await page.waitForLoadState('domcontentloaded');
      await waitForEditorReady(page);

      await expect
        .poll(
          () =>
            page.evaluate(async (marker: string) => {
              const names = await caches.keys();
              return names.includes(marker);
            }, UPDATE_MARKER_CACHE),
          { timeout: 60000, message: 'the updated worker should activate after consent' },
        )
        .toBe(true);
    } finally {
      writeFileSync(servedWorkerPath, originalWorker);
    }
  });
});
