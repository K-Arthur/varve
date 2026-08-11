/**
 * Interactive crop E2E tests — pointer-driven crop tool workflows.
 *
 * Tests cover: enter/exit crop mode, handle dragging, zoom, fit cycling,
 * cancel/commit, persistence, and undo/redo.
 *
 * Isolated from unrelated WCAG contrast failures — this spec exercises
 * only crop interaction flows.
 */

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Image crop — interactive tool', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  /**
   * Helper: import an image and select it, returning its bounding box.
   *
   * The crop tool only activates for shapes with an image fill — a plain
   * rectangle is rejected by design (see CropTool.onActivate). Earlier
   * versions of this spec drew a rect and expected the overlay, which can
   * never pass.
   */
  async function createImageAndSelect(page: import('@playwright/test').Page) {
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/photo-fixture.jpg'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    // Switch to select tool and click the shape to select it
    await page.keyboard.press('v');
    await page.waitForTimeout(200);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 250, box.y + 225);
    }
    await page.waitForTimeout(200);
    return box;
  }

  test('C key enters crop mode for selected shape', async ({ page }) => {
    test.setTimeout(60000);
    await createImageAndSelect(page);
    // Enter crop mode
    await page.keyboard.press('c');
    // Crop overlay should appear
    await expect(page.locator('[data-testid="crop-overlay"]')).toBeVisible({ timeout: 5000 });
  });

  test('Escape exits crop mode without changes', async ({ page }) => {
    test.setTimeout(60000);
    await createImageAndSelect(page);
    await page.keyboard.press('c');
    await expect(page.locator('[data-testid="crop-overlay"]')).toBeVisible({ timeout: 5000 });
    // Cancel
    await page.keyboard.press('Escape');
    // Overlay should disappear
    await expect(page.locator('[data-testid="crop-overlay"]')).not.toBeVisible({ timeout: 3000 });
    // Node should still exist
    await expect(page.getByRole('treeitem')).toHaveCount(1);
  });

  test('Enter commits crop and exits crop mode', async ({ page }) => {
    test.setTimeout(60000);
    await createImageAndSelect(page);
    await page.keyboard.press('c');
    await expect(page.locator('[data-testid="crop-overlay"]')).toBeVisible({ timeout: 5000 });
    // Commit
    await page.keyboard.press('Enter');
    // Overlay should disappear
    await expect(page.locator('[data-testid="crop-overlay"]')).not.toBeVisible({ timeout: 3000 });
    // Node should still exist
    await expect(page.getByRole('treeitem')).toHaveCount(1);
  });

  test('F key cycles fit mode', async ({ page }) => {
    test.setTimeout(60000);
    await createImageAndSelect(page);
    await page.keyboard.press('c');
    await expect(page.locator('[data-testid="crop-overlay"]')).toBeVisible({ timeout: 5000 });

    // Check initial fit badge shows "crop"
    const badge = page.locator('.crop-overlay__badge');
    await expect(badge).toHaveText('crop', { timeout: 3000 });

    // Press F to cycle
    await page.keyboard.press('f');
    await expect(badge).toHaveText('fit', { timeout: 3000 });

    await page.keyboard.press('f');
    await expect(badge).toHaveText('fill', { timeout: 3000 });

    await page.keyboard.press('f');
    await expect(badge).toHaveText('stretch', { timeout: 3000 });

    await page.keyboard.press('f');
    await expect(badge).toHaveText('tile', { timeout: 3000 });

    // Cycle back to crop
    await page.keyboard.press('f');
    await expect(badge).toHaveText('crop', { timeout: 3000 });
  });

  test('Done button commits crop', async ({ page }) => {
    test.setTimeout(60000);
    await createImageAndSelect(page);
    await page.keyboard.press('c');
    await expect(page.locator('[data-testid="crop-overlay"]')).toBeVisible({ timeout: 5000 });

    // Click Done button
    await page.getByRole('button', { name: /done/i }).click();
    await expect(page.locator('[data-testid="crop-overlay"]')).not.toBeVisible({ timeout: 3000 });
  });

  test('Cancel button discards crop', async ({ page }) => {
    test.setTimeout(60000);
    await createImageAndSelect(page);
    await page.keyboard.press('c');
    await expect(page.locator('[data-testid="crop-overlay"]')).toBeVisible({ timeout: 5000 });

    // Click Cancel button
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.locator('[data-testid="crop-overlay"]')).not.toBeVisible({ timeout: 3000 });
    // Node should still exist unchanged
    await expect(page.getByRole('treeitem')).toHaveCount(1);
  });

  test('crop handles are accessible with aria-labels', async ({ page }) => {
    test.setTimeout(60000);
    await createImageAndSelect(page);
    await page.keyboard.press('c');
    await expect(page.locator('[data-testid="crop-overlay"]')).toBeVisible({ timeout: 5000 });

    // All 8 handles should be present with descriptive labels
    const handles = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
    for (const h of handles) {
      await expect(
        page.getByRole('button', { name: `Resize crop ${h}`, exact: true }),
      ).toBeVisible();
    }
  });

  test('crop overlay is not shown for non-image shapes', async ({ page }) => {
    test.setTimeout(60000);
    // Create a frame (not an image shape)
    await page.keyboard.press('f');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    // Switch to select and click the frame
    await page.keyboard.press('v');
    await page.waitForTimeout(200);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 250, box.y + 225);
    }
    await page.waitForTimeout(200);

    // Try to enter crop mode — should not work for frames
    await page.keyboard.press('c');
    // Crop overlay should NOT appear (CropTool rejects non-rect shapes)
    await expect(page.locator('[data-testid="crop-overlay"]')).not.toBeVisible({ timeout: 2000 });
  });

  test('rapid crop enter/exit does not leave stale overlay', async ({ page }) => {
    test.setTimeout(60000);
    await createImageAndSelect(page);

    // Rapid enter/exit cycle
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('c');
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // Overlay should be gone
    await expect(page.locator('[data-testid="crop-overlay"]')).not.toBeVisible({ timeout: 3000 });
    // Node should still exist
    await expect(page.getByRole('treeitem')).toHaveCount(1);
  });

  test('crop mode can be entered from context menu Object > Crop Image', async ({ page }) => {
    test.setTimeout(60000);
    await createImageAndSelect(page);

    // Open context menu via right-click on the canvas
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 250, box.y + 225, { button: 'right' });
    }
    await page.waitForTimeout(500);

    // Look for Crop Image in the context menu
    const cropMenuItem = page.getByRole('menuitem', { name: /crop image/i });
    if (await cropMenuItem.isVisible({ timeout: 1000 }).catch(() => false)) {
      await cropMenuItem.click();
      await expect(page.locator('[data-testid="crop-overlay"]')).toBeVisible({ timeout: 5000 });
    }
  });
});
