/**
 * Interaction latency E2E — verifies input responsiveness.
 *
 * Tests that key interactions (drag, wheel, selection) complete without
 * errors and produce visible results. Uses Playwright's native mouse API
 * for reliable event dispatch.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/** Create a rect via the r-tool drag, then return to the select tool. */
async function createRect(
  page: import('@playwright/test').Page,
  canvasBox: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
  w: number,
  h: number,
) {
  await page.keyboard.press('r');
  await page.mouse.move(canvasBox.x + x, canvasBox.y + y);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + x + w / 2, canvasBox.y + y + h / 2);
  await page.mouse.move(canvasBox.x + x + w, canvasBox.y + y + h);
  await page.mouse.up();
  await page.keyboard.press('v');
}

test.describe('interaction latency', () => {
  test('single-node drag produces a selection overlay', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await createRect(page, canvasBox, 200, 200, 80, 60);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Select the rect
    await page.mouse.click(canvasBox.x + 240, canvasBox.y + 230);
    await page.waitForTimeout(200);

    // Verify selection overlay is visible
    const overlay = page.locator('svg:has(filter#selection-glow)');
    const rect = overlay.locator('rect').first();
    await expect(rect).toBeVisible();

    // Drag the rect
    await page.mouse.move(canvasBox.x + 240, canvasBox.y + 230);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 300, canvasBox.y + 270, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Verify the overlay is still visible after drag
    await expect(rect).toBeVisible();

    // Verify the layers panel shows the node
    await expect(page.getByRole('treeitem')).toHaveCount(1);
  });

  test('wheel pan does not crash the editor', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    // Perform wheel pan
    const centerX = canvasBox.x + canvasBox.width / 2;
    const centerY = canvasBox.y + canvasBox.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(300);

    // Verify the editor is still functional (canvas is visible)
    await expect(canvas).toBeVisible();
  });

  test('selection overlay remains visible during drag', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await createRect(page, canvasBox, 200, 200, 100, 80);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Select the rect
    await page.mouse.click(canvasBox.x + 250, canvasBox.y + 240);
    await page.waitForTimeout(200);

    // Verify selection overlay is visible
    const overlay = page.locator('svg:has(filter#selection-glow)');
    const rect = overlay.locator('rect').first();
    await expect(rect).toBeVisible();

    // Start dragging and verify overlay updates
    const startX = canvasBox.x + 250;
    const startY = canvasBox.y + 240;
    await page.mouse.move(startX, startY);
    await page.mouse.down();

    // Move in steps and verify overlay is still visible at each step
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(startX + i * 10, startY + i * 10);
      await page.waitForTimeout(16); // ~1 frame
      await expect(rect).toBeVisible();
    }

    await page.mouse.up();
  });
});
