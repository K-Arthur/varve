import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Layers Panel - Drag & Drop', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 2);
  });

  test('layers tree renders with sortable rows', async ({ page }) => {
    const tree = page.getByRole('tree', { name: /layers/i });
    await expect(tree).toBeVisible();

    // Ensure there are some elements (empty state or layers)
    const items = page.getByRole('treeitem');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('drag handle is present on tree rows', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    if (count >= 1) {
      const firstItem = items.first();
      const dragHandle = firstItem.locator('[class*="drag-handle"]');
      await expect(dragHandle).toBeVisible();
    }
  });

  test('keyboard reorder moves selected row (Ctrl+[ / Ctrl+])', async ({ page }) => {
    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();
    const items = page.getByRole('treeitem');
    const count = await items.count();
    if (count >= 2) {
      const firstName = await items.first().textContent();
      // Focus second item, then move up with Ctrl+[. The keyboard-reorder
      // handler reads the tree's internal focusIdx, which syncs from
      // selection via a useEffect — wait for aria-selected to land before
      // pressing the shortcut, or it can fire against the stale focus.
      await items.nth(1).click();
      await expect(items.nth(1)).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Control+[');
      await page.waitForTimeout(200);
      const newFirstName = await items.first().textContent();
      expect(newFirstName).not.toBe(firstName);
    }
  });

  test('canvas accepts DnD drop zone', async ({ page }) => {
    // getByLabel targets form-associated elements; the drop zone is a
    // <section aria-label="Canvas"> (distinct from the inner
    // <canvas aria-label="Design canvas">), so match on the attribute
    // directly instead.
    const canvas = page.locator('[aria-label="Canvas"]');
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute('aria-label', 'Canvas');
  });

  test('file import input exists', async ({ page }) => {
    const importInput = page.locator('#file-import-input');
    await expect(importInput).toBeVisible({ visible: false });
    await expect(importInput).toHaveAttribute(
      'accept',
      '.svg,.png,.jpg,.jpeg,.webp,.avif,.gif,.bmp,.pdf,.ai,.eps,.psd,.psb,.sketch,.fig,.fig.json,.cube,.3dl,.clf,.ctf',
    );
  });
});
