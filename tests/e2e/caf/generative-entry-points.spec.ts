import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('Generative Edit entry points', () => {
  async function importRealPhoto(page: import('@playwright/test').Page): Promise<void> {
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve(__dirname, '..', 'fixtures', 'real-life-still-life.jpg'));
    await page.getByRole('treeitem').first().waitFor({ timeout: 60_000 });
  }

  test('opens the shared workflow from a real-photo layer context menu', async ({ page }) => {
    test.setTimeout(180_000);
    await navigateToEditor(page);
    await importRealPhoto(page);

    const imageLayer = page.getByRole('treeitem').first();
    await expect(imageLayer).toBeVisible();
    await imageLayer.click({ button: 'right' });

    const menu = page.getByRole('menu', { name: 'Layer context menu' });
    await expect(menu).toBeVisible();
    const openGenerativeEdit = menu.getByRole('menuitem', { name: 'Generative Edit…' });
    await expect(openGenerativeEdit).toBeVisible();
    await openGenerativeEdit.click();

    const dialog = page.locator('dialog.varve-dialog--caf[open]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Content-Aware Fill');
    await expect(dialog.locator('canvas.caf-dialog__mask-canvas')).toBeVisible();
  });

  test('opens the shared workflow from the canvas context menu for a real photo', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await navigateToEditor(page);
    await importRealPhoto(page);

    const imageLayer = page.getByRole('treeitem').first();
    await imageLayer.click();
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible();
    await canvas.click({ button: 'right', position: { x: 12, y: 300 } });

    const menu = page.getByRole('menu', { name: 'Canvas context menu' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Generative Edit…' }).click();

    await expect(page.locator('dialog.varve-dialog--caf[open]')).toBeVisible();
  });
});
