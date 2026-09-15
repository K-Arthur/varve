/**
 * Selection quick bar — appears for image/path/multi, not for plain rects.
 */
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Selection quick bar', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('shows remove-background for an imported image', async ({ page }) => {
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.getByRole('treeitem').first().click();
    const bar = page.getByTestId('selection-quick-bar');
    await expect(bar).toBeVisible({ timeout: 5000 });
    // Scope to the bar — inspector also has a "Remove background" control.
    await expect(bar.getByRole('button', { name: /remove background/i })).toBeVisible();
    await expect(bar.getByRole('button', { name: /^crop$/i })).toBeVisible();
  });

  test('shows edit-nodes for a pencil path', async ({ page }) => {
    // Pencil drag is more reliable in headless than pen multi-click + Enter
    await page.keyboard.press('Shift+KeyP');
    await dragOnCanvas(page, 120, 120, 380, 260);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.keyboard.press('v');
    await page.getByRole('treeitem').first().click();
    const bar = page.getByTestId('selection-quick-bar');
    await expect(bar).toBeVisible({ timeout: 5000 });
    await expect(bar.getByRole('button', { name: /edit nodes/i })).toBeVisible();
  });

  test('does not show for a plain rectangle', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.getByRole('treeitem').first().click();
    await expect(page.getByTestId('selection-quick-bar')).toHaveCount(0);
  });
});
