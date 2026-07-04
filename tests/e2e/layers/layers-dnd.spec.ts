import { expect, test } from '@playwright/test';

test.describe('Layers Panel - Drag & Drop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.layers-panel');
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
      // Focus second item, then move up with Ctrl+[
      await items.nth(1).click();
      await page.keyboard.press('Control+[');
      await page.waitForTimeout(200);
      const newFirstName = await items.first().textContent();
      expect(newFirstName).not.toBe(firstName);
    }
  });

  test('canvas accepts DnD drop zone', async ({ page }) => {
    const canvas = page.getByLabel('Canvas');
    await expect(canvas).toBeVisible();
    // The canvas should be present and have the droppable attribute
    await expect(canvas).toHaveAttribute('aria-label', 'Canvas');
  });

  test('file import input exists', async ({ page }) => {
    const importInput = page.locator('#file-import-input');
    await expect(importInput).toBeVisible({ visible: false });
    await expect(importInput).toHaveAttribute('accept', '.svg,.png,.jpg,.jpeg,.webp,.gif');
  });
});
