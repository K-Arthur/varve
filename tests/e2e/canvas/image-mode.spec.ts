import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const VIEWPORT = { width: 1280, height: 800 };

test.describe('Image Editing Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
  });

  test('Photo workspace shows layers/inspector, hides page nav', async ({ page }) => {
    const photoWorkspace = page.getByRole('radio', { name: /^Photo workspace$/ });
    await photoWorkspace.click();
    await expect(photoWorkspace).toBeChecked();
    await expect(page.locator('[data-panel="layers"]')).toBeVisible();
    await expect(page.locator('[data-panel="inspector"]')).toBeVisible();
    await expect(page.locator('.page-nav-container')).not.toBeVisible();
    await expect(page.locator('[data-testid="toolbar"]')).toBeVisible();
  });

  test('Ctrl+Shift+4 switches to Photo workspace', async ({ page }) => {
    await page.keyboard.press('Control+Shift+4');
    await expect(page.getByRole('radio', { name: /^Photo workspace$/ })).toBeChecked();
  });

  test('comparing before/after overlays the original image and toggles off', async ({ page }) => {
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await page.getByRole('radio', { name: /^Photo workspace$/ }).click();

    // The first-launch "Getting started" checklist can open (even with a
    // delay, e.g. after completing the "import a file" step) and overlap the
    // floating toolbar, intercepting clicks; dismiss it whenever it shows up.
    const dismissChecklist = page.getByRole('button', { name: 'Dismiss' });
    async function dismissChecklistIfPresent() {
      if (await dismissChecklist.isVisible({ timeout: 3000 }).catch(() => false)) {
        await dismissChecklist.click();
        await expect(dismissChecklist).toHaveCount(0);
      }
    }
    await dismissChecklistIfPresent();

    // Compare Before/After has no dedicated toolbar button (the bottom
    // floating toolbar can overflow under the side panels at this viewport
    // width — see project notes); it's reachable via the "\" shortcut and
    // the View menu instead.
    await expect(page.locator('[data-testid="image-compare-overlay"]')).toHaveCount(0);
    await dismissChecklistIfPresent();
    await page.keyboard.press('\\');
    await expect(page.locator('[data-testid="image-compare-overlay"]')).toBeVisible();
    await expect(page.getByText('Before')).toBeVisible();

    await page.keyboard.press('\\');
    await expect(page.locator('[data-testid="image-compare-overlay"]')).toHaveCount(0);
  });

  test('one imported image survives every workspace without reimporting', async ({
    page,
  }, testInfo) => {
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/test-image.png'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    for (const workspace of ['Photo', 'Draw', 'Print', 'Motion', 'Logo', 'Codegen', 'Design']) {
      const workspaceRadio = page.getByRole('radio', {
        name: new RegExp(`^${workspace} workspace$`),
      });
      await workspaceRadio.click();
      await expect(workspaceRadio).toBeChecked();
      await expect(page.getByRole('treeitem')).toHaveCount(1);
      await expect(page.getByRole('treeitem').filter({ hasText: /test-image/i })).toBeVisible();
    }

    const reviewPath = process.env.VARVE_IMAGE_REVIEW_PATH;
    const screenshot = await page
      .getByTestId('editor-canvas')
      .screenshot(reviewPath ? { path: reviewPath } : {});
    await testInfo.attach('image-workspace-roundtrip', {
      body: screenshot,
      contentType: 'image/png',
    });
  });

  test('corrupt raster import fails locally without adding a blank layer', async ({ page }) => {
    await page.locator('#file-import-input').setInputFiles({
      name: 'corrupt.png',
      mimeType: 'image/png',
      buffer: Buffer.from([1, 2, 3, 4]),
    });

    await expect(page.getByRole('treeitem')).toHaveCount(0);
    await expect(page.getByText(/Imported 0 files; 1 failed/i)).toBeVisible();
  });
});
