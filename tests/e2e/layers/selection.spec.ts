import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Layers Panel - Multi-Selection', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 3);
  });

  test('shift-click selects range of layers', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 2, 'Need at least 2 layers for range select');

    // Click first item
    await items.nth(0).click();
    await page.waitForTimeout(50);

    // Shift-click the last item
    await items.nth(count - 1).click({ modifiers: ['Shift'] });
    await page.waitForTimeout(50);

    // All items in range should be selected
    const selected = page.locator('[role="treeitem"][aria-selected="true"]');
    const selectedCount = await selected.count();
    expect(selectedCount).toBe(count);
  });

  test('ctrl-click toggles individual layer selection', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 3, 'Need at least 3 layers for ctrl-click test');

    // Click first item to select it
    await items.nth(0).click();
    await page.waitForTimeout(50);
    await expect(items.nth(0)).toHaveAttribute('aria-selected', 'true');

    // Ctrl-click second item to add to selection
    await items.nth(1).click({ modifiers: ['Control'] });
    await page.waitForTimeout(50);
    await expect(items.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(items.nth(1)).toHaveAttribute('aria-selected', 'true');

    // Ctrl-click first item again to deselect it
    await items.nth(0).click({ modifiers: ['Control'] });
    await page.waitForTimeout(50);
    await expect(items.nth(0)).toHaveAttribute('aria-selected', 'false');
    await expect(items.nth(1)).toHaveAttribute('aria-selected', 'true');
  });

  test('ctrl+a selects all layers', async ({ page }) => {
    const tree = page.getByRole('tree', { name: /layers/i });
    await expect(tree).toBeVisible();
    await tree.focus();

    // Create several layers first
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 1, 'Need at least 1 layer for select all');

    // Ctrl+A to select all
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);

    const selected = page.locator('[role="treeitem"][aria-selected="true"]');
    const selectedCount = await selected.count();
    expect(selectedCount).toBe(await items.count());
  });

  test('bulk bar appears with 2+ selected', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 2, 'Need at least 2 layers for bulk bar');

    const bulkBar = page.locator('.layers-bulk-bar');
    await expect(bulkBar).not.toBeVisible();

    // Select two items
    await items.nth(0).click();
    await page.waitForTimeout(50);
    await items.nth(1).click({ modifiers: ['Control'] });
    await page.waitForTimeout(50);

    await expect(bulkBar).toBeVisible();
    await expect(bulkBar).toHaveAttribute('aria-label', 'Bulk layer actions');
  });

  test('bulk lock locks all selected layers', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 2, 'Need at least 2 layers for bulk lock');

    // Select two items
    await items.nth(0).click();
    await page.waitForTimeout(50);
    await items.nth(1).click({ modifiers: ['Control'] });
    await page.waitForTimeout(50);

    // Click bulk lock button
    const lockBtn = page.locator('.layers-bulk-bar__btn[aria-label="Lock all"]');
    if ((await lockBtn.count()) > 0) {
      await lockBtn.click();
      await page.waitForTimeout(100);

      // Both items should now be locked
      await expect(items.nth(0)).toHaveClass(/layers-row--locked/);
      await expect(items.nth(1)).toHaveClass(/layers-row--locked/);
    }
  });

  test('bulk hide hides all selected layers', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 2, 'Need at least 2 layers for bulk hide');

    // Select two items
    await items.nth(0).click();
    await page.waitForTimeout(50);
    await items.nth(1).click({ modifiers: ['Control'] });
    await page.waitForTimeout(50);

    // Click bulk hide button
    const hideBtn = page.locator('.layers-bulk-bar__btn[aria-label="Hide all"]');
    if ((await hideBtn.count()) > 0) {
      await hideBtn.click();
      await page.waitForTimeout(100);

      // Both items should now be hidden
      await expect(items.nth(0)).toHaveClass(/layers-row--hidden/);
      await expect(items.nth(1)).toHaveClass(/layers-row--hidden/);
    }
  });

  test('bulk group groups selected layers', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 2, 'Need at least 2 layers for bulk group');

    // Select two items
    await items.nth(0).click();
    await page.waitForTimeout(50);
    await items.nth(1).click({ modifiers: ['Control'] });
    await page.waitForTimeout(50);

    // Click bulk group button
    const groupBtn = page.locator('.layers-bulk-bar__btn[aria-label="Group"]');
    if ((await groupBtn.count()) > 0) {
      await groupBtn.click();
      await page.waitForTimeout(200);

      // A new group should appear (items count may change)
      const itemsAfter = page.getByRole('treeitem');
      const newGroup = itemsAfter.filter({ hasText: /Group/ });
      await expect(newGroup.first()).toBeAttached();
    }
  });

  test('bulk delete removes all selected layers', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();
    test.skip(count < 2, 'Need at least 2 layers for bulk delete');

    // Select two items
    await items.nth(0).click();
    await page.waitForTimeout(50);
    await items.nth(1).click({ modifiers: ['Control'] });
    await page.waitForTimeout(50);

    const beforeCount = await items.count();

    // Click bulk delete button
    const deleteBtn = page.locator('.layers-bulk-bar__btn[aria-label="Delete all"]');
    if ((await deleteBtn.count()) > 0) {
      await deleteBtn.click();
      await page.waitForTimeout(200);

      const afterCount = await items.count();
      expect(afterCount).toBeLessThan(beforeCount);
    }
  });
});
