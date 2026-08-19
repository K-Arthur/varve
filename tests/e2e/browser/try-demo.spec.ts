/**
 * Public browser demo (/try) — E2E smoke and visual verification.
 *
 * Runs against the Vite dev server with the ?try=1 query param (no build
 * required) to verify the demo-mode wiring, sample document seeding,
 * persistence, limitation banner, and capability-gating behaviour.
 */
import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas } from '../shared';

const DEMO_URL = '/?try=1';

/** Dismiss the crash-recovery dialog if present. */
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

/** Force the no-File-System-Access save path (Blob download + IDB mirror). */
async function forceDownloadSaveFallback(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
  });
}

test.describe('browser demo (/try)', () => {
  test.describe.configure({ timeout: 240000 });

  test('boots directly into the editor with a sample document — no Home screen', async ({
    page,
  }) => {
    await page.goto(DEMO_URL, { timeout: 120000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.layers-panel', { timeout: 60000 });
    await dismissRecoveryDialog(page);

    // Title reflects the demo.
    await expect(page).toHaveTitle(/try in browser/i);

    // The demo banner is visible with honest copy.
    const banner = page.locator('.varve-demo-banner');
    await expect(banner).toBeVisible({ timeout: 10000 });
    await expect(banner.getByText(/browser demo/i)).toBeVisible();
    await expect(banner.getByText(/nothing uploaded/i)).toBeVisible();

    // The download-desktop CTA links to the website.
    const cta = banner.getByRole('link', { name: /download desktop/i });
    await expect(cta).toBeVisible();
    const href = await cta.getAttribute('href');
    expect(href).toMatch(/download/i);

    // The sample document has at least 3 layers (frame, shapes, text).
    const items = page.getByRole('treeitem');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // The canvas is visible and non-zero size.
    const canvas = page.locator('.editor-canvas canvas, canvas').first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test('WASM engine loads in the demo', async ({ page }) => {
    const wasmUrls: string[] = [];
    page.on('response', (res) => {
      if (/\/wasm\/varve_wasm.*_bg\.wasm$/.test(res.url()) && res.status() === 200) {
        wasmUrls.push(res.url());
      }
    });
    const warnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.text().includes('WASM engine failed')) warnings.push(msg.text());
    });

    await page.goto(DEMO_URL, { timeout: 120000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.layers-panel', { timeout: 60000 });

    await expect
      .poll(() => wasmUrls.length, { timeout: 30000, message: 'WASM binary should be fetched' })
      .toBeGreaterThan(0);
    expect(warnings).toEqual([]);
  });

  test('edit, save (Blob fallback), reload, and reopen — persistence works', async ({ page }) => {
    await forceDownloadSaveFallback(page);
    await page.goto(DEMO_URL, { timeout: 120000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.layers-panel', { timeout: 60000 });
    await dismissRecoveryDialog(page);

    const before = await page.getByRole('treeitem').count();

    // Draw a shape so the document is non-trivial.
    await page.keyboard.press('r');
    await dragOnCanvas(page, 40, 40, 200, 140);
    await page.keyboard.press('v');

    await expect(page.getByRole('treeitem')).toHaveCount(before + 1, { timeout: 15000 });

    // Wait for the save to land in IndexedDB.
    const saveStatus = page.locator('.save-status');
    await expect(saveStatus).toHaveText('Saved', { timeout: 30000 });

    // Reload and verify the sample card is present.
    await dismissRecoveryDialog(page);
    await page.reload({ timeout: 120000 });
    await dismissRecoveryDialog(page);
    await page.waitForSelector('.layers-panel', { timeout: 60000 });

    // The document re-opens with the sample + our added shape.
    await expect(page.getByRole('treeitem')).toHaveCount(before + 1, { timeout: 15000 });

    // The demo banner reappears on every visit.
    await expect(page.locator('.varve-demo-banner')).toBeVisible({ timeout: 10000 });
  });

  test('demo banner limitations disclosure is keyboard accessible', async ({ page }) => {
    await page.goto(DEMO_URL, { timeout: 120000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.varve-demo-banner', { timeout: 60000 });

    const summary = page.locator('.varve-demo-banner__limits summary');
    await expect(summary).toBeVisible();

    // Toggle via keyboard: Enter opens, Escape (or second Enter) closes.
    await summary.focus();
    await page.keyboard.press('Enter');
    const list = page.locator('.varve-demo-banner__limits ul');
    await expect(list).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(list).not.toBeVisible();
  });

  test('storage denial still allows the demo to open (in-memory)', async ({ page }) => {
    await page.addInitScript(() => {
      const fail = (): never => {
        throw new DOMException(
          'The operation failed for reasons unrelated to the database itself',
          'SecurityError',
        );
      };
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        value: {
          open: fail,
          databases: async () => [],
          cmp: () => 0,
          deleteDatabase: fail,
        },
      });
    });

    await page.goto(DEMO_URL, { timeout: 120000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.varve-demo-banner', { timeout: 60000 });

    // The editor still boots even with no IDB.
    await page.locator('.layers-panel').waitFor({ timeout: 60000 });
    const canvas = page.locator('.editor-canvas canvas, canvas').first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
  });

  test('mobile viewport: demo boots, canvas visible, banner readable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(DEMO_URL, { timeout: 120000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.layers-panel', { timeout: 60000 });

    await expect(page.locator('.varve-demo-banner')).toBeVisible({ timeout: 10000 });
    const canvas = page.locator('.editor-canvas canvas, canvas').first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test('sample document is not re-seeded over user edits', async ({ page }) => {
    await forceDownloadSaveFallback(page);
    await page.goto(DEMO_URL, { timeout: 120000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.layers-panel', { timeout: 60000 });
    await dismissRecoveryDialog(page);

    const before = await page.getByRole('treeitem').count();

    // Make an edit.
    await page.keyboard.press('r');
    await dragOnCanvas(page, 40, 40, 200, 140);
    await page.keyboard.press('v');
    await expect(page.getByRole('treeitem')).toHaveCount(before + 1, { timeout: 15000 });

    // Wait for save.
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });

    // Revisit via reload.
    await dismissRecoveryDialog(page);
    await page.reload({ timeout: 120000 });
    await dismissRecoveryDialog(page);
    await page.waitForSelector('.layers-panel', { timeout: 60000 });

    // The sample still has our added shape — no re-seeding clobbered it.
    await expect(page.getByRole('treeitem')).toHaveCount(before + 1, { timeout: 15000 });
  });

  // Regression: the recovery prompt used to be appended to <body> with no
  // styles. Because #root already fills 100dvh inside an overflow:hidden
  // body, it laid out *below the fold* — present in the DOM, impossible to
  // see or click. Assert it lands inside the viewport, not merely that it
  // exists.
  test('stale-asset recovery prompt is visible inside the viewport', async ({ page }) => {
    await page.goto(DEMO_URL, { timeout: 120000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.layers-panel', { timeout: 60000 });
    await dismissRecoveryDialog(page);

    // Simulate the post-deploy state: a hashed chunk the shell references is gone.
    await page.evaluate(() => {
      const script = document.createElement('script');
      script.src = '/assets/chunk-removed-by-a-deploy.js';
      document.head.appendChild(script);
    });

    const banner = page.locator('.varve-stale-asset-banner');
    await expect(banner).toBeVisible({ timeout: 10000 });

    const viewport = page.viewportSize();
    const box = await banner.boundingBox();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);

    // Both controls are reachable, and dismissing removes the prompt.
    await expect(banner.getByRole('button', { name: /reload demo/i })).toBeVisible();
    await banner.getByRole('button', { name: /dismiss update notice/i }).click();
    await expect(banner).toHaveCount(0);
  });

  test('demo attaches screenshots for visual inspection', async ({ page }) => {
    await page.goto(DEMO_URL, { timeout: 120000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.layers-panel', { timeout: 60000 });

    await page.screenshot({ path: 'reports/try-demo/light.png', fullPage: true });
    await test.info().attach('demo-light.png', {
      path: 'reports/try-demo/light.png',
      contentType: 'image/png',
    });
  });
});
