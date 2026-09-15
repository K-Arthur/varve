import { expect, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Selection rasterization', () => {
  test('rasterizes at an explicit PPI and supports one-step undo/redo', async ({ page }) => {
    await navigateToEditor(page);

    await page.keyboard.press('r');
    await dragOnCanvas(page, 180, 160, 420, 360);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await openMenu(page, 'Object');
    await page.getByRole('menuitem', { name: /^Rasterize$/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Rasterize' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: '300 PPI' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // The workflow defaults to preserving an editable source. It is hidden
    // while the raster copy is visible, so the result has two layer records.
    await dialog.getByRole('button', { name: 'Rasterize' }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 20000 });
    await expect(page.getByRole('treeitem').filter({ hasText: /Rasterized Copy/i })).toHaveCount(1);

    await page.keyboard.press('Control+z');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.keyboard.press('Control+Shift+z');
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
  });
});
