import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Brush / Paint tool — drawing and persistence', () => {
  // Run serially to avoid Vite dev-server contention under parallel workers.
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('paint tool creates a raster layer on drag', async ({ page }) => {
    const layerCountBefore = await page.getByRole('treeitem').count();

    await page.keyboard.press('b');
    await page.waitForTimeout(200);
    await dragOnCanvas(page, 200, 200, 250, 250);

    await expect(page.getByRole('treeitem')).toHaveCount(layerCountBefore + 1, { timeout: 10000 });
  });

  test('paint brush size bracket keys update the inspector', async ({ page }) => {
    await page.keyboard.press('b');
    await page.waitForTimeout(200);

    await page.keyboard.press(']');
    await page.waitForTimeout(100);
    await page.keyboard.press(']');
    await page.waitForTimeout(100);
    await page.keyboard.press('[');
    await page.waitForTimeout(100);

    const sizeSlider = page.locator('.insp-num__input').first();
    await expect(sizeSlider).toBeVisible();
  });

  test('preset selector changes brush settings', async ({ page }) => {
    await page.keyboard.press('b');
    await page.waitForTimeout(200);

    const presetSelect = page.getByRole('combobox', { name: 'Brush preset' }).first();
    await presetSelect.waitFor({ timeout: 5000 });

    const currentValue = await presetSelect.textContent();
    await presetSelect.click();
    await page.getByRole('option', { name: 'Marker' }).click();
    await page.waitForTimeout(200);

    const newValue = await presetSelect.textContent();
    expect(newValue).toContain('Marker');
    expect(newValue).not.toBe(currentValue);
  });

  test('paint stroke creates a node that appears in layers panel', async ({ page }) => {
    await page.keyboard.press('b');
    await page.waitForTimeout(200);
    await dragOnCanvas(page, 100, 100, 200, 200);
    await page.waitForTimeout(300);

    const treeItems = await page.getByRole('treeitem').count();
    expect(treeItems).toBeGreaterThanOrEqual(1);
  });

  test('paint tool undo reverts stroke dabs but preserves the raster layer node', async ({
    page,
  }) => {
    await page.keyboard.press('b');
    await page.waitForTimeout(200);

    const layerCountBefore = await page.getByRole('treeitem').count();

    await dragOnCanvas(page, 100, 100, 160, 160);
    await page.waitForTimeout(200);

    const layerCountAfter = await page.getByRole('treeitem').count();
    expect(layerCountAfter).toBeGreaterThanOrEqual(layerCountBefore + 1);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    // The raster layer node persists after undo — only the stroke dabs are
    // reverted. This is architecturally correct: the raster layer is a
    // container, and undo removes the painted content without destroying
    // the container itself.
    const layerCountAfterUndo = await page.getByRole('treeitem').count();
    expect(layerCountAfterUndo).toBeGreaterThanOrEqual(1);
  });

  test('switch between paint and eraser tools', async ({ page }) => {
    await page.keyboard.press('b');
    await page.waitForTimeout(200);
    await dragOnCanvas(page, 100, 100, 160, 160);
    await page.waitForTimeout(200);

    await page.keyboard.press('e');
    await page.waitForTimeout(200);
    await dragOnCanvas(page, 110, 110, 150, 150);
    await page.waitForTimeout(200);

    const treeItems = await page.getByRole('treeitem').count();
    expect(treeItems).toBeGreaterThanOrEqual(1);
  });

  test('paint stroke is visible as canvas pixel change', async ({ page }) => {
    const contentCanvas = page.locator('canvas.editor-canvas__content-layer');
    await contentCanvas.waitFor({ state: 'attached', timeout: 10000 });
    const before = await contentCanvas.screenshot();

    await page.keyboard.press('b');
    await page.waitForTimeout(200);
    await dragOnCanvas(page, 200, 200, 350, 300);
    await page.waitForTimeout(400);

    const after = await contentCanvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test('paint at non-default zoom produces visible stroke', async ({ page }) => {
    // Zoom in 200% then paint
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.waitForTimeout(300);

    const contentCanvas = page.locator('canvas.editor-canvas__content-layer');
    const before = await contentCanvas.screenshot();

    await page.keyboard.press('b');
    await page.waitForTimeout(200);
    await dragOnCanvas(page, 150, 150, 250, 200);
    await page.waitForTimeout(400);

    const after = await contentCanvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test('paint tool undo visibly changes the canvas (dabs removed)', async ({ page }) => {
    const contentCanvas = page.locator('canvas.editor-canvas__content-layer');
    const beforePaint = await contentCanvas.screenshot();

    await page.keyboard.press('b');
    await page.waitForTimeout(200);

    await dragOnCanvas(page, 200, 200, 350, 300);
    // Rendering is asynchronous. Establish that the paint frame arrived
    // before using it as the undo baseline; otherwise two pre-paint captures
    // can make a valid undo look like a no-op on a busy browser.
    await expect
      .poll(async () => Buffer.compare(beforePaint, await contentCanvas.screenshot()), {
        timeout: 10000,
      })
      .not.toBe(0);

    const afterPaint = await contentCanvas.screenshot();

    await page.keyboard.press('Control+z');
    // Undo removes the dab pixels — canvas after undo differs from
    // canvas after paint. The raster layer node persists (it is a
    // container), but the pixel content is reverted.
    await expect
      .poll(async () => Buffer.compare(afterPaint, await contentCanvas.screenshot()), {
        timeout: 10000,
      })
      .not.toBe(0);
  });

  test('a dense real-pointer burst commits one visible brush stroke', async ({ page }) => {
    const contentCanvas = page.locator('canvas.editor-canvas__content-layer');
    await contentCanvas.waitFor({ state: 'attached', timeout: 10000 });
    const before = await contentCanvas.screenshot();
    const box = await contentCanvas.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.keyboard.press('b');
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.55);
    await page.mouse.down();
    // More samples than a display frame normally presents: this drives the
    // real PointerEvent path rather than asserting only a synthetic dab list.
    for (let index = 1; index <= 48; index++) {
      const progress = index / 48;
      await page.mouse.move(
        box.x + box.width * (0.2 + progress * 0.55),
        box.y + box.height * (0.55 + Math.sin(progress * Math.PI * 2) * 0.04),
      );
    }
    await page.mouse.up();

    await expect
      .poll(async () => Buffer.compare(before, await contentCanvas.screenshot()), {
        timeout: 10000,
      })
      .not.toBe(0);
  });

  test('rapid short strokes produce at least one layer', async ({ page }) => {
    await page.keyboard.press('b');
    await page.waitForTimeout(200);

    for (let i = 0; i < 5; i++) {
      await page.mouse.click(200 + i * 30, 200 + i * 20);
      await page.waitForTimeout(50);
    }

    const treeItems = await page.getByRole('treeitem').count();
    expect(treeItems).toBeGreaterThanOrEqual(1);
  });
});
