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
    await page
      .locator('.editor-menubar__workspace-btn')
      .filter({ hasText: /^Photo$/ })
      .click();
    await expect(
      page.locator('.editor-menubar__workspace-btn').filter({ hasText: /^Photo$/ }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-panel="layers"]')).toBeVisible();
    await expect(page.locator('[data-panel="inspector"]')).toBeVisible();
    await expect(page.locator('.page-nav-container')).not.toBeVisible();
    await expect(page.locator('[data-testid="toolbar"]')).toBeVisible();
  });

  test('Ctrl+Shift+4 switches to Photo workspace', async ({ page }) => {
    await page.keyboard.press('Control+Shift+4');
    await expect(
      page.locator('.editor-menubar__workspace-btn').filter({ hasText: /^Photo$/ }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  test('comparing before/after overlays the original image and toggles off', async ({ page }) => {
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await page
      .locator('.editor-menubar__workspace-btn')
      .filter({ hasText: /^Photo$/ })
      .click();

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
});
