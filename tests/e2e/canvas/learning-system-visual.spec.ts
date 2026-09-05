/**
 * Visual regression tests for the non-disruptive onboarding & learning system.
 *
 * Uses Playwright's toHaveScreenshot() for pixel-level comparison against
 * stored baselines. Each test captures a specific learning surface.
 *
 * Run: npx playwright test tests/e2e/canvas/learning-system-visual.spec.ts --project=chromium
 * Update baselines: npx playwright test tests/e2e/canvas/learning-system-visual.spec.ts --update-snapshots
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function waitForRectanglePainted(page: import('@playwright/test').Page) {
  await expect(page.getByRole('treeitem', { name: /Rectangle 1/ })).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const canvas = document.querySelector(
            'canvas.editor-canvas__content-layer',
          ) as HTMLCanvasElement | null;
          const context = canvas?.getContext('2d');
          if (!canvas || !context || canvas.width < 476 || canvas.height < 301) return false;
          const pixel = context.getImageData(475, 300, 1, 1).data;
          return pixel[1]! > 100 && pixel[0]! < 150 && pixel[2]! > 100;
        }),
      { timeout: 10000 },
    )
    .toBe(true);
}

test.describe('Learning system visual regression', () => {
  test.describe.configure({ mode: 'serial' });

  test('empty canvas — no blocking modals', async ({ page }) => {
    // Clear learning state before navigating
    await page.goto('/', { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.removeItem('strata:onboarding');
      localStorage.removeItem('strata:tips-today');
      localStorage.removeItem('varve:safe-mode');
    });
    await navigateToEditor(page);
    await page.waitForTimeout(500);
    // Verify no welcome/tour modal is blocking
    const blockingDialog = page.locator('dialog[open]').filter({
      hasText: /welcome to varve/i,
    });
    await expect(blockingDialog).toHaveCount(0);
    // Capture the clean editor state
    await expect(page.locator('.editor-canvas, canvas').first()).toHaveScreenshot(
      'empty-canvas-no-modal.png',
      { maxDiffPixels: 200 },
    );
  });

  test('micro-hint — Rectangle tool first use', async ({ page }) => {
    await page.goto('/', { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.removeItem('strata:onboarding');
      localStorage.removeItem('strata:tips-today');
    });
    await navigateToEditor(page);
    await page.waitForTimeout(500);
    // Select Rectangle tool
    await page.keyboard.press('r');
    await page.waitForTimeout(800);
    // Capture the micro-hint
    const hint = page.locator('.micro-hint');
    await expect(hint).toBeVisible({ timeout: 3000 });
    await expect(hint).toHaveScreenshot('micro-hint-rect.png', { maxDiffPixels: 100 });
  });

  test('spotlight tour — Drawing tools step', async ({ page }) => {
    await page.goto('/', { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.removeItem('strata:onboarding');
      localStorage.removeItem('strata:tips-today');
    });
    await navigateToEditor(page);
    await page.waitForTimeout(500);
    // Open Help → Take a Tour
    await page.getByRole('menuitem', { name: 'Help' }).click({ timeout: 5000 });
    await page.waitForTimeout(200);
    await page.getByRole('menuitem', { name: 'Take a Tour' }).click({ timeout: 5000 });
    await page.waitForTimeout(500);
    // Capture the spotlight overlay
    const spotlight = page.locator('.spotlight-overlay');
    await expect(spotlight).toBeVisible({ timeout: 3000 });
    await expect(spotlight).toHaveScreenshot('spotlight-tour-step1.png', { maxDiffPixels: 200 });
  });

  test('settings dialog — General section', async ({ page }) => {
    await page.goto('/', { timeout: 300000, waitUntil: 'domcontentloaded' });
    await navigateToEditor(page);
    await page.waitForTimeout(500);
    // Open Settings
    await page.keyboard.press('Control+,');
    await page.waitForTimeout(1500);
    // Capture the settings dialog
    const dialog = page.locator('dialog[open]').filter({ hasText: 'Settings' });
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await expect(dialog).toHaveScreenshot('settings-dialog-general.png', { maxDiffPixels: 200 });
  });

  test('dark mode — editor with drawn shape', async ({ page }) => {
    await page.goto('/', { timeout: 300000, waitUntil: 'domcontentloaded' });
    await navigateToEditor(page);
    await page.waitForTimeout(500);
    // Draw a rectangle
    await page.keyboard.press('r');
    const canvas = page.locator('.editor-canvas, canvas').first();
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 400, box.y + 250);
      await page.mouse.down();
      await page.mouse.move(box.x + 550, box.y + 350, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(300);
    }
    await waitForRectanglePainted(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    // Switch to dark mode
    await page.evaluate(() => {
      localStorage.setItem('varve-theme', 'dark');
      document.documentElement.dataset.theme = 'dark';
    });
    await page.waitForTimeout(500);
    await waitForRectanglePainted(page);
    // Capture dark mode
    await expect(canvas).toHaveScreenshot('dark-mode-editor.png', { maxDiffPixels: 200 });
  });
});
