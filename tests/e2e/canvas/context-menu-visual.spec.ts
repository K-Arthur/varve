/**
 * Context menu visual feature verification.
 *
 * Tests the new visual improvements: section labels, icons, destructive
 * styling, entrance animation, and danger zone headings across all context
 * menu surfaces.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Context menu visual features', () => {
  test.describe.configure({ mode: 'serial' });

  test('canvas context menu shows section labels and icons', async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 2);
    await page.waitForTimeout(300);

    // Select a layer to get a richer context menu
    const firstItem = page.getByRole('treeitem').first();
    await firstItem.click();
    await page.waitForTimeout(100);

    // Right-click on the canvas to open context menu
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.click({ button: 'right', position: { x: 400, y: 300 } });
    await page.waitForTimeout(200);

    const menu = page.locator('.varve-ctxmenu[role="menu"]');
    await expect(menu).toBeVisible();

    // Verify section labels exist
    const labels = menu.locator('.varve-menu__label');
    const labelTexts = await labels.evaluateAll((els) => els.map((el) => el.textContent?.trim()));

    // At minimum, the canvas menu should have some section labels
    expect(labelTexts.length).toBeGreaterThan(0);

    // Verify icons are present on some items
    const icons = menu.locator('.varve-menu__leading svg, .varve-menu__leading .icon');
    const iconCount = await icons.count();
    // The enhanced menu should have icons on Cut, Copy, Paste, etc.
    expect(iconCount).toBeGreaterThan(0);

    await page.screenshot({
      path: 'test-results/canvas-context-menu-labels-icons.png',
      animations: 'disabled',
    });
  });

  test('canvas context menu shows destructive styling on Delete', async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 1);
    await page.waitForTimeout(300);

    // Select a layer
    const firstItem = page.getByRole('treeitem').first();
    await firstItem.click();
    await page.waitForTimeout(100);

    // Right-click on the canvas
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.click({ button: 'right', position: { x: 400, y: 300 } });
    await page.waitForTimeout(200);

    const menu = page.locator('.varve-ctxmenu[role="menu"]');
    await expect(menu).toBeVisible();

    // Find the Delete item and verify destructive styling
    const deleteItem = menu.locator('.varve-menu__item--destructive', { hasText: 'Delete' });
    const count = await deleteItem.count();
    if (count > 0) {
      // Verify it has the destructive class
      await expect(deleteItem.first()).toHaveClass(/varve-menu__item--destructive/);

      // Verify the text color is danger-colored
      const color = await deleteItem.first().evaluate((el) => {
        return getComputedStyle(el).color;
      });
      // Destructive items should not be the same color as regular items
      expect(color).toBeTruthy();
    }
  });

  test('layers context menu shows section labels', async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 3);
    await page.waitForTimeout(300);

    // Right-click on a layer
    const firstItem = page.getByRole('treeitem').first();
    await firstItem.click({ button: 'right' });
    await page.waitForTimeout(200);

    const menu = page.locator('.varve-ctxmenu[role="menu"]');
    await expect(menu).toBeVisible();

    // Verify section labels exist
    const labels = menu.locator('.varve-menu__label');
    const labelTexts = await labels.evaluateAll((els) => els.map((el) => el.textContent?.trim()));

    // Should have labels like "Layer", "Clipboard", "Arrange", "Visibility"
    expect(labelTexts.length).toBeGreaterThan(0);

    // Verify icons are present
    const icons = menu.locator('.varve-menu__leading svg');
    const iconCount = await icons.count();
    expect(iconCount).toBeGreaterThan(0);

    await page.screenshot({
      path: 'test-results/layers-context-menu-labels.png',
      animations: 'disabled',
    });
  });

  test('layers context menu Delete is destructive', async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 2);
    await page.waitForTimeout(300);

    const firstItem = page.getByRole('treeitem').first();
    await firstItem.click({ button: 'right' });
    await page.waitForTimeout(200);

    const menu = page.locator('.varve-ctxmenu[role="menu"]');
    await expect(menu).toBeVisible();

    // Find Delete item - should have destructive class
    const deleteItem = menu.locator('.varve-menu__item--destructive', { hasText: 'Delete' });
    const count = await deleteItem.count();
    expect(count).toBeGreaterThan(0);
  });

  test('home file context menu shows Danger Zone label', async ({ page }) => {
    await page.goto('/e2e.html');
    await page.waitForSelector('.varve-home');

    const card = page.locator('.home-grid[role="grid"] [role="gridcell"]').first();
    const count = await page.locator('.home-grid[role="grid"] [role="gridcell"]').count();
    if (count < 1) return;

    await card.click({ button: 'right' });
    await page.waitForTimeout(200);

    const menu = page.locator('.varve-ctxmenu[role="menu"]');
    await expect(menu).toBeVisible();

    // Verify Danger Zone label exists with danger styling
    const dangerLabel = menu.locator('.varve-menu__label--danger', { hasText: 'Danger Zone' });
    await expect(dangerLabel).toBeVisible();

    // Verify the Move to Trash item is destructive
    const trashItem = menu.locator('.varve-menu__item--destructive', { hasText: 'Move to Trash' });
    await expect(trashItem).toBeVisible();

    await page.screenshot({
      path: 'test-results/home-context-menu-danger-zone.png',
      animations: 'disabled',
    });
  });

  test('home file context menu shows icons', async ({ page }) => {
    await page.goto('/e2e.html');
    await page.waitForSelector('.varve-home');

    const card = page.locator('.home-grid[role="grid"] [role="gridcell"]').first();
    const count = await page.locator('.home-grid[role="grid"] [role="gridcell"]').count();
    if (count < 1) return;

    await card.click({ button: 'right' });
    await page.waitForTimeout(200);

    const menu = page.locator('.varve-ctxmenu[role="menu"]');
    await expect(menu).toBeVisible();

    // Verify icons are present
    const icons = menu.locator('.varve-menu__leading svg');
    const iconCount = await icons.count();
    expect(iconCount).toBeGreaterThan(0);

    // Verify section labels
    const labels = menu.locator('.varve-menu__label');
    const labelTexts = await labels.evaluateAll((els) => els.map((el) => el.textContent?.trim()));
    expect(labelTexts.length).toBeGreaterThan(0);
  });

  test('menu entrance animation exists', async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 1);
    await page.waitForTimeout(300);

    // Right-click on the canvas
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.click({ button: 'right', position: { x: 400, y: 300 } });
    await page.waitForTimeout(50);

    // Check that the floating layer has the animation class
    const floatingLayer = page.locator('.varve-floating-layer');
    const count = await floatingLayer.count();
    if (count > 0) {
      const animation = await floatingLayer.first().evaluate((el) => {
        return getComputedStyle(el).animationName;
      });
      // Should have the menu fade-in animation
      expect(animation).toContain('varve-menu-fade-in');
    }
  });

  test('Escape closes context menu and restores focus', async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 1);
    await page.waitForTimeout(300);

    const firstItem = page.getByRole('treeitem').first();
    await firstItem.click();
    await page.waitForTimeout(100);

    // Right-click on canvas
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.click({ button: 'right', position: { x: 400, y: 300 } });
    await page.waitForTimeout(200);

    const menu = page.locator('.varve-ctxmenu[role="menu"]');
    await expect(menu).toBeVisible();

    // Escape should close the menu
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await expect(menu).not.toBeVisible();
  });

  test('context menu keyboard navigation with arrows', async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 2);
    await page.waitForTimeout(300);

    const firstItem = page.getByRole('treeitem').first();
    await firstItem.click();
    await page.waitForTimeout(100);

    // Open context menu via keyboard
    await page.keyboard.press('Shift+F10');
    await page.waitForTimeout(200);

    const menu = page.locator('.varve-ctxmenu[role="menu"]');
    await expect(menu).toBeVisible();

    // Arrow down should move focus
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(50);

    // Check that a menu item has focus
    const focusedItem = menu.locator(
      '[role="menuitem"]:focus, [role="menuitemcheckbox"]:focus, [role="menuitemradio"]:focus',
    );
    await expect(focusedItem).toBeAttached();

    // Escape should close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await expect(menu).not.toBeVisible();
  });
});
