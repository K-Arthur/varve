import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Layers Panel - Multi-Selection', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 3);
    await expect(page.getByRole('treeitem')).toHaveCount(3);
  });

  test('shift-click selects range of layers', async ({ page }) => {
    const items = page.getByRole('treeitem');
    const count = await items.count();

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

    // Ctrl+A to select all
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);

    const selected = page.locator('[role="treeitem"][aria-selected="true"]');
    const selectedCount = await selected.count();
    expect(selectedCount).toBe(await items.count());
  });

  test('bulk bar appears with 2+ selected', async ({ page }) => {
    const items = page.getByRole('treeitem');

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

    // Select two items
    await items.nth(0).click();
    await page.waitForTimeout(50);
    await items.nth(1).click({ modifiers: ['Control'] });
    await page.waitForTimeout(50);

    // A normal click scrolls the rail to the control and verifies it receives
    // input. A forced click can hit different chrome at its clipped position.
    const lockBtn = page.locator('.layers-bulk-bar__btn[aria-label="Lock all"]');
    await expect(lockBtn).toBeVisible();
    await lockBtn.click();
    await expect(items.nth(0)).toHaveClass(/layers-row--locked/);
    await expect(items.nth(1)).toHaveClass(/layers-row--locked/);
  });

  test('bulk hide hides all selected layers', async ({ page }) => {
    const items = page.getByRole('treeitem');

    // Select two items
    await items.nth(0).click();
    await page.waitForTimeout(50);
    await items.nth(1).click({ modifiers: ['Control'] });
    await page.waitForTimeout(50);

    // Click bulk hide button.
    const hideBtn = page.locator('.layers-bulk-bar__btn[aria-label="Hide all"]');
    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(2);
    await expect(hideBtn).toBeVisible();
    await expect(hideBtn).toBeEnabled();
    await hideBtn.click();

    // Both selected layers are hidden; the unselected layer stays visible.
    await expect(items.nth(0)).toHaveClass(/layers-row--hidden/);
    await expect(items.nth(1)).toHaveClass(/layers-row--hidden/);
    await expect(items.nth(2)).not.toHaveClass(/layers-row--hidden/);
  });

  test('bulk group groups selected layers', async ({ page }) => {
    const items = page.getByRole('treeitem');

    // Select two items
    await items.nth(0).click();
    await page.waitForTimeout(50);
    await items.nth(1).click({ modifiers: ['Control'] });
    await page.waitForTimeout(50);

    // Click bulk group button.
    const groupBtn = page.locator('.layers-bulk-bar__btn[aria-label="Group"]');
    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(2);
    await expect(groupBtn).toBeVisible();
    await expect(groupBtn).toBeEnabled();
    await groupBtn.click();

    // A new group must appear after the real command is activated.
    const newGroup = page.locator('[role="treeitem"][data-layer-type="group"]');
    await expect(newGroup).toHaveCount(1);
    await expect(newGroup).toContainText('Group');
  });

  test('bulk delete removes all selected layers', async ({ page }) => {
    const items = page.getByRole('treeitem');

    // Select two items
    await items.nth(0).click();
    await page.waitForTimeout(50);
    await items.nth(1).click({ modifiers: ['Control'] });
    await page.waitForTimeout(50);

    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(2);
    const beforeIDs = await items.evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('data-node-id')),
    );
    expect(beforeIDs.every(Boolean)).toBe(true);

    // Delete exactly the selected first two layers, retaining the third.
    const deleteBtn = page.locator('.layers-bulk-bar__btn[aria-label="Delete all"]');
    await expect(deleteBtn).toBeVisible();
    await expect(deleteBtn).toBeEnabled();
    await deleteBtn.click();
    await expect(items).toHaveCount(1);
    await expect(items.first()).toHaveAttribute('data-node-id', beforeIDs[2]!);

    // The bulk operation is one undo entry and restores the same three layers.
    await page.getByRole('tree', { name: /layers/i }).focus();
    await page.keyboard.press('Control+z');
    await expect(items).toHaveCount(3);
    expect(
      await items.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-node-id'))),
    ).toEqual(beforeIDs);
  });
});
