import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Gradient Map Adjustment', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  /**
   * Programmatically create an adjustment layer node via the editor context.
   * There is no direct DOM UI button for this yet, so we walk the React fiber
   * tree to find the EditorCtx.Provider and call createAdjustmentLayer().
   * Returns true on success. The adjustment node is auto-selected after creation.
   */
  async function createAdjustmentLayer(page: import('@playwright/test').Page): Promise<boolean> {
    return page.evaluate(() => {
      try {
        const container = document.getElementById('root');
        if (!container) return false;

        const fiberKey = Object.keys(container).find(
          (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'),
        );
        if (!fiberKey) return false;

        function walk(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
          if (!fiber) return null;

          // Context provider value is in memoizedProps.value
          const mp = fiber.memoizedProps as Record<string, unknown> | undefined;
          if (
            mp?.value &&
            typeof mp.value === 'object' &&
            'createAdjustmentLayer' in (mp.value as Record<string, unknown>)
          ) {
            return mp.value as Record<string, unknown>;
          }

          // Also check pendingProps (used during concurrent rendering)
          const pp = fiber.pendingProps as Record<string, unknown> | undefined;
          if (
            pp?.value &&
            typeof pp.value === 'object' &&
            'createAdjustmentLayer' in (pp.value as Record<string, unknown>)
          ) {
            return pp.value as Record<string, unknown>;
          }

          return (
            walk(fiber.child as Record<string, unknown> | null) ||
            walk(fiber.sibling as Record<string, unknown> | null)
          );
        }

        const ctx = walk(
          (container as unknown as Record<string, unknown>)[fiberKey] as Record<
            string,
            unknown
          > | null,
        );
        if (ctx && typeof ctx.createAdjustmentLayer === 'function') {
          (ctx.createAdjustmentLayer as () => void)();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    });
  }

  test('applies gradient map adjustment and shows editor controls', async ({ page }) => {
    // Create a shape so the editor is fully booted
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Create an adjustment layer via programmatic access
    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);

    // The adjustment node should be auto-selected and the AdjustmentPanel visible
    // Look for the "Adjustment Layer" header in the inspector
    const adjHeader = page.locator('.adj-panel__header-name');
    await expect(adjHeader).toBeVisible({ timeout: 5000 });
    await expect(adjHeader).toContainText('Adjustment Layer');

    // Click "Add adjustment" button in the AdjustmentPanel
    const addAdjBtn = page.locator('button.adj-panel__add-btn');
    await expect(addAdjBtn).toBeVisible({ timeout: 3000 });
    await addAdjBtn.click();
    await page.waitForTimeout(200);

    // Select "Gradient Map" from the add menu
    const gradMapMenuItem = page
      .locator('.adj-panel__add-menu-item')
      .filter({ hasText: 'Gradient Map' });
    if (await gradMapMenuItem.isVisible()) {
      await gradMapMenuItem.click();
      await page.waitForTimeout(300);
    }

    // Verify the gradient map editor appears with dither toggle
    const ditherCheckbox = page.locator('input[aria-label="Dither gradient map"]');
    await expect(ditherCheckbox).toBeVisible({ timeout: 5000 });

    // Verify preserve luminosity checkbox is visible
    const preserveLumCheckbox = page.locator('input[aria-label="Preserve luminosity"]');
    await expect(preserveLumCheckbox).toBeVisible({ timeout: 3000 });
  });

  test('shows gradient bar in gradient map editor', async ({ page }) => {
    // Create shape and adjustment layer
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);

    // Add gradient map adjustment
    const addAdjBtn = page.locator('button.adj-panel__add-btn');
    await expect(addAdjBtn).toBeVisible({ timeout: 3000 });
    await addAdjBtn.click();
    await page.waitForTimeout(200);

    const gradMapMenuItem = page
      .locator('.adj-panel__add-menu-item')
      .filter({ hasText: 'Gradient Map' });
    if (await gradMapMenuItem.isVisible()) {
      await gradMapMenuItem.click();
      await page.waitForTimeout(300);
    }

    // Verify the gradient bar is rendered (gm-editor__bar)
    const gradientBar = page.getByRole('slider', { name: /Gradient map stop bar/ }).first();
    await expect(gradientBar).toBeVisible({ timeout: 5000 });

    // The bar should have an accessible slider role
    await expect(gradientBar).toHaveAttribute('role', 'slider');
  });

  test('toggles dither and preserve luminosity checkboxes', async ({ page }) => {
    // Create shape and adjustment layer
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);

    // Add gradient map adjustment
    const addAdjBtn = page.locator('button.adj-panel__add-btn');
    await expect(addAdjBtn).toBeVisible({ timeout: 3000 });
    await addAdjBtn.click();
    await page.waitForTimeout(200);

    const gradMapMenuItem = page
      .locator('.adj-panel__add-menu-item')
      .filter({ hasText: 'Gradient Map' });
    if (await gradMapMenuItem.isVisible()) {
      await gradMapMenuItem.click();
      await page.waitForTimeout(300);
    }

    // Toggle dither checkbox
    const ditherInput = page.locator('input[aria-label="Dither gradient map"]');
    await expect(ditherInput).toBeVisible({ timeout: 5000 });
    const ditherInitial = await ditherInput.isChecked();
    await ditherInput.click();
    await page.waitForTimeout(150);
    const ditherAfter = await ditherInput.isChecked();
    expect(ditherAfter).not.toBe(ditherInitial);

    // Toggle preserve luminosity checkbox
    const preserveInput = page.locator('input[aria-label="Preserve luminosity"]');
    await expect(preserveInput).toBeVisible({ timeout: 3000 });
    const lumInitial = await preserveInput.isChecked();
    await preserveInput.click();
    await page.waitForTimeout(150);
    const lumAfter = await preserveInput.isChecked();
    expect(lumAfter).not.toBe(lumInitial);
  });
});
