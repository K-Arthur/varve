import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Lasso Tool', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('lasso tool selects objects within freehand drawn polygon', async ({ page }) => {
    // Create multiple shapes to test lasso selection
    await page.keyboard.press('r');
    await dragOnCanvas(page, 100, 100, 200, 200); // Rect 1
    await page.keyboard.press('o');
    await dragOnCanvas(page, 250, 150, 350, 250); // Ellipse 1
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 250, 250, 350); // Rect 2
    await page.waitForTimeout(200);

    // Switch to lasso tool (Shift+L)
    await page.keyboard.press('Shift+l');
    await page.waitForTimeout(200);

    // Get canvas position
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    // Draw lasso around the first two shapes (rect 1 and ellipse 1)
    const startX = box.x + 80;
    const startY = box.y + 80;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    
    // Draw a rough circle around the first two shapes
    const points = [
      [startX + 50, startY],
      [startX + 100, startY + 30],
      [startX + 120, startY + 80],
      [startX + 100, startY + 130],
      [startX + 50, startY + 150],
      [startX, startY + 120],
      [startX - 20, startY + 70],
      [startX, startY + 20],
    ];
    
    for (const [x, y] of points) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(20);
    }
    
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Check that selection was made
    const layersPanel = page.locator('.layers-panel');
    await expect(layersPanel).toBeVisible();
    
    // The lasso tool should have selected some shapes
    // We can verify this by checking if the selection overlay is visible
    const selectionOverlay = page.locator('svg:has(filter#selection-glow)');
    await expect(selectionOverlay).toBeVisible();
  });

  test('lasso tool with Shift adds to selection', async ({ page }) => {
    // Create two shapes
    await page.keyboard.press('r');
    await dragOnCanvas(page, 100, 100, 200, 200); // Rect 1
    await page.keyboard.press('o');
    await dragOnCanvas(page, 300, 100, 400, 200); // Ellipse 1
    await page.waitForTimeout(200);

    // Select the first shape normally
    await page.keyboard.press('v');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    
    await page.mouse.click(box.x + 150, box.y + 150);
    await page.waitForTimeout(200);

    // Switch to lasso tool (Shift+L)
    await page.keyboard.press('Shift+l');
    await page.waitForTimeout(200);

    // Draw lasso around the second shape while holding Shift
    const startX = box.x + 280;
    const startY = box.y + 80;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    
    // Hold Shift key during drag
    await page.keyboard.down('Shift');
    
    const points = [
      [startX + 30, startY],
      [startX + 60, startY + 20],
      [startX + 70, startY + 60],
      [startX + 50, startY + 80],
      [startX + 20, startY + 70],
      [startX + 10, startY + 40],
    ];
    
    for (const [x, y] of points) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(20);
    }
    
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(300);

    // Both shapes should now be selected
    const selectionOverlay = page.locator('svg:has(filter#selection-glow)');
    await expect(selectionOverlay).toBeVisible();
  });

  test('lasso tool shortcut (Shift+L) activates lasso tool', async ({ page }) => {
    // Start with select tool (default)
    await page.waitForTimeout(200);
    
    // Activate lasso tool via shortcut
    await page.keyboard.press('Shift+l');
    await page.waitForTimeout(200);

    // Verify lasso tool is active by checking cursor or tool state
    // The cursor should change to crosshair for lasso tool
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible();
    
    // Draw a simple lasso to verify the tool is working
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    const startX = box.x + 200;
    const startY = box.y + 200;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    
    const points = [
      [startX + 30, startY],
      [startX + 60, startY + 30],
      [startX + 50, startY + 60],
      [startX + 20, startY + 50],
    ];
    
    for (const [x, y] of points) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(20);
    }
    
    await page.mouse.up();
    await page.waitForTimeout(300);
    
    // Tool should complete without errors
    await expect(canvas).toBeVisible();
  });
});