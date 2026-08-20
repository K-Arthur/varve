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

/**
 * Save explicitly and wait for the status to settle.
 *
 * The demo has no autosave — that is documented behaviour, not an oversight
 * ("No autosave to disk; edits between explicit saves are lost on close"), so
 * waiting for the status to reach "Saved" on its own waits forever. With the
 * File System Access API removed the save lands as a Blob download, which is
 * the Firefox/Safari path.
 */
async function saveAndWait(page: Page): Promise<void> {
  const download = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await page.keyboard.press('ControlOrMeta+s');
  await download;
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
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
    // Scoped to the intro paragraph: /browser demo/i also matches the
    // disclosure summary ("What's limited in the browser demo"), which makes
    // an unscoped getByText a strict-mode violation rather than an assertion.
    const intro = banner.locator('.varve-demo-banner__intro');
    await expect(intro).toContainText(/browser demo/i);
    await expect(intro).toContainText(/nothing uploaded/i);
    const consent = banner.locator('.varve-demo-banner__consent');
    await expect(consent).toBeVisible();
    await expect(consent.getByRole('button', { name: 'Allow' })).toBeVisible();
    await expect(consent.getByRole('button', { name: 'No thanks' })).toBeVisible();

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

  test('remembers an explicit analytics choice and does not ask again', async ({ page }) => {
    await page.goto(DEMO_URL, { timeout: 120000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.layers-panel', { timeout: 60000 });

    const banner = page.locator('.varve-demo-banner');
    const consent = banner.locator('.varve-demo-banner__consent');
    await expect(consent).toBeVisible();
    await consent.getByRole('button', { name: 'No thanks' }).click();
    await expect(consent).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem('varve-editor-settings');
          return raw ? JSON.parse(raw).privacy?.usageAnalytics : undefined;
        }),
      )
      .toBe('denied');

    await page.reload({ timeout: 120000 });
    await page.waitForSelector('.layers-panel', { timeout: 60000 });
    await expect(page.locator('.varve-demo-banner')).toBeVisible();
    await expect(page.locator('.varve-demo-banner__consent')).toHaveCount(0);
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

    await saveAndWait(page);

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
    // Wait for the editor to finish mounting before touching focus. The canvas
    // claims focus as it mounts, so focusing the summary any earlier is a race
    // the test loses in Firefox and happens to win in Chromium — which read as
    // a Firefox accessibility bug until the settle was added.
    await page.waitForSelector('.layers-panel', { timeout: 60000 });
    await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 30000 });

    const summary = page.locator('.varve-demo-banner__limits summary');
    await expect(summary).toBeVisible();

    // Toggle via keyboard: Enter opens, a second Enter closes.
    await summary.focus();
    await expect(summary).toBeFocused();
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

    await saveAndWait(page);

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

  // The demo exposes only the three workspaces that genuinely work in a
  // browser. Print has no printers to talk to, Motion cannot hold a frame
  // budget in a tab, and Codegen/Logo/Email are narrow power-user surfaces.
  test('offers only the primary workspaces, and withheld ones stay unreachable', async ({
    page,
  }) => {
    await page.goto(DEMO_URL, { timeout: 120000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.layers-panel', { timeout: 60000 });
    await dismissRecoveryDialog(page);

    const tabs = page.locator('.workspace-tabs__tab');
    await expect(tabs).toHaveCount(3);
    const labels = (await tabs.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-mode')),
    )) as string[];
    expect(labels.sort()).toEqual(['design', 'drawing', 'image']);

    // Not merely hidden from the tabs: the View menu keeps withheld capability
    // names visible but genuinely disabled, while allowed modes remain active.
    for (const mode of ['print', 'motion', 'codegen', 'logo', 'email']) {
      await expect(page.locator(`.workspace-tabs [data-mode="${mode}"]`)).toHaveCount(0);
    }
    await page.getByRole('menuitem', { name: 'View' }).click();
    const viewMenu = page.locator('.editor-menubar__menu');
    for (const mode of ['Print', 'Motion', 'Codegen', 'Logo', 'Email']) {
      await expect(
        viewMenu.getByRole('menuitemradio', { name: `Workspace: ${mode}` }),
      ).toBeDisabled();
    }
    for (const mode of ['Design', 'Draw', 'Photo']) {
      await expect(
        viewMenu.getByRole('menuitemradio', { name: `Workspace: ${mode}` }),
      ).not.toBeDisabled();
    }
  });

  // Every visitor is a first-time user, so any first-run surface fires on every
  // single load. Three of them used to stack over the sample document.
  test('opens straight onto the sample document with nothing covering it', async ({ page }) => {
    await page.goto(DEMO_URL, { timeout: 120000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.layers-panel', { timeout: 60000 });
    await dismissRecoveryDialog(page);
    await expect(page.getByRole('treeitem')).toHaveCount(10, { timeout: 30000 });

    // No welcome dialog, no missing-font dialog, no getting-started checklist.
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.getByText('Welcome to Varve')).toBeHidden();
    await expect(page.getByText(/missing fonts/i)).toHaveCount(0);
    await expect(page.locator('.onboarding-checklist--open')).toHaveCount(0);
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
