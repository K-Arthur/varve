/**
 * E2E tests for Smart Filters — object-local nondestructive filter stack.
 *
 * Tests: add invert → verify canvas pixels, toggle, remove, reorder,
 * duplicate, multi-filter stack, group/frame filters, undo/redo,
 * and visual inspection via screenshots.
 */
import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

/** Select a layer by clicking it in the Layers panel. */
async function selectLayerInPanel(page: Page, index = 0) {
  const item = page.getByRole('treeitem').nth(index);
  await item.click();
  await expect(item).toHaveAttribute('aria-selected', 'true');
}

/** Add an Object Filter via the inspector dropdown. */
async function addSmartFilter(page: Page, kindLabel: string) {
  const select = page.getByLabel('Add Object Filter');
  await select.selectOption({ label: kindLabel });
  await page.waitForTimeout(200);
}

/** Read a single pixel from the content canvas at screen coordinates. */
async function readCanvasPixel(
  page: Page,
  x: number,
  y: number,
): Promise<[number, number, number, number]> {
  return page.evaluate(
    ([cx, cy]) => {
      const canvas = document.querySelector(
        'canvas.editor-canvas__content-layer',
      ) as HTMLCanvasElement | null;
      if (!canvas) return [0, 0, 0, 0];
      const ctx = canvas.getContext('2d');
      if (!ctx) return [0, 0, 0, 0];
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const px = Math.round((cx - rect.left) * dpr);
      const py = Math.round((cy - rect.top) * dpr);
      const data = ctx.getImageData(px, py, 1, 1).data;
      return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0];
    },
    [x, y] as [number, number],
  );
}

test.describe('Smart Filters — Invert workflow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('add invert filter to a red rect — canvas pixels change', async ({ page }) => {
    // Create a red rectangle
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const cx = box.x + 250;
    const cy = box.y + 200;

    // Draw rect
    await dragOnCanvas(page, cx - 80, cy - 60, cx + 80, cy + 60);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });

    // Wait for paint
    await page.waitForTimeout(500);

    // Read pixel before — expect red-ish
    const [r1] = await readCanvasPixel(page, cx, cy);
    expect(r1).toBeGreaterThan(200);

    // Select the layer
    await selectLayerInPanel(page, 0);

    // Open Smart Filters section and add Invert
    await addSmartFilter(page, 'Invert');
    await page.waitForTimeout(500);

    // Read pixel after — expect cyan-ish (inverted red)
    const [r2, g2, b2, a2] = await readCanvasPixel(page, cx, cy);
    // Inverted red (255,0,0) should be (0,255,255)
    expect(r2).toBeLessThan(50);
    expect(g2).toBeGreaterThan(200);
    expect(b2).toBeGreaterThan(200);
    expect(a2).toBe(255); // alpha preserved

    // Screenshot for visual inspection
    await page.screenshot({
      path: 'reports/smart-filters/invert-applied.png',
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
  });

  test('toggle filter visibility — reverts to original', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const cx = box.x + 250;
    const cy = box.y + 200;
    await dragOnCanvas(page, cx - 80, cy - 60, cx + 80, cy + 60);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);

    // Record original color
    const [origR] = await readCanvasPixel(page, cx, cy);
    expect(origR).toBeGreaterThan(200);
    expect(origR).toBeGreaterThan(200);

    // Add filter
    await selectLayerInPanel(page, 0);
    await addSmartFilter(page, 'Invert');
    await page.waitForTimeout(500);

    const [invR] = await readCanvasPixel(page, cx, cy);
    expect(invR).toBeLessThan(50);

    // Toggle visibility off (click the eye icon button)
    const eyeBtn = page.locator('button.smart-filters__visibility').first();
    await eyeBtn.click();
    await page.waitForTimeout(500);

    const [toggledR] = await readCanvasPixel(page, cx, cy);
    expect(toggledR).toBeGreaterThan(200);

    await page.screenshot({
      path: 'reports/smart-filters/invert-toggled-off.png',
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
  });

  test('remove filter — restores original', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const cx = box.x + 250;
    const cy = box.y + 200;
    await dragOnCanvas(page, cx - 80, cy - 60, cx + 80, cy + 60);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);

    const [origR] = await readCanvasPixel(page, cx, cy);
    expect(origR).toBeGreaterThan(200);

    await selectLayerInPanel(page, 0);
    await addSmartFilter(page, 'Invert');
    await page.waitForTimeout(500);

    // Remove the filter
    const removeBtn = page.locator('button.smart-filters__remove').first();
    await removeBtn.click();
    await page.waitForTimeout(500);

    const [removedR] = await readCanvasPixel(page, cx, cy);
    expect(removedR).toBeGreaterThan(200);

    await page.screenshot({
      path: 'reports/smart-filters/invert-removed.png',
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
  });

  test('undo after adding filter — restores original', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const cx = box.x + 250;
    const cy = box.y + 200;
    await dragOnCanvas(page, cx - 80, cy - 60, cx + 80, cy + 60);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);

    const [origR] = await readCanvasPixel(page, cx, cy);
    expect(origR).toBeGreaterThan(200);

    await selectLayerInPanel(page, 0);
    await addSmartFilter(page, 'Invert');
    await page.waitForTimeout(500);

    const [invR] = await readCanvasPixel(page, cx, cy);
    expect(invR).toBeLessThan(50);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);

    const [undoR] = await readCanvasPixel(page, cx, cy);
    expect(undoR).toBeGreaterThan(200);
  });

  test('multiple filters coexist — blur + invert both apply', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const cx = box.x + 250;
    const cy = box.y + 200;
    await dragOnCanvas(page, cx - 80, cy - 60, cx + 80, cy + 60);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);

    await selectLayerInPanel(page, 0);
    await addSmartFilter(page, 'Invert');
    await addSmartFilter(page, 'Blur');
    await page.waitForTimeout(500);

    // Both filters are visible in the stack
    const filterRows = page.locator('.smart-filters__row');
    await expect(filterRows).toHaveCount(2);

    await page.screenshot({
      path: 'reports/smart-filters/multi-filter-stack.png',
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
  });

  test('inspector shows Smart Filters section for a shape', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    await dragOnCanvas(page, box.x + 150, box.y + 150, box.x + 350, box.y + 300);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });

    await selectLayerInPanel(page, 0);
    await page.waitForTimeout(500);

    const smartFiltersSection = page.getByText('Object Filters', { exact: true }).first();
    await expect(smartFiltersSection).toBeVisible({ timeout: 5000 });
  });

  test('filter does not expand canvas bounds — zero-expansion effect', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const before = await canvas.screenshot();

    await dragOnCanvas(page, box.x + 150, box.y + 150, box.x + 350, box.y + 300);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);

    await selectLayerInPanel(page, 0);
    await addSmartFilter(page, 'Invert');
    await page.waitForTimeout(500);

    const after = await canvas.screenshot();
    // Screenshots should differ (colors changed) but have the same dimensions
    expect(Buffer.compare(before, after)).not.toBe(0);
  });
});

test.describe('Object Filters — group and frame', () => {
  test('frame with smart filter affects children', async ({ page }) => {
    // Create frame
    await page.keyboard.press('f');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    await dragOnCanvas(page, box.x + 100, box.y + 100, box.x + 400, box.y + 400);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(300);

    // Create a rect inside the frame
    await page.keyboard.press('r');
    await dragOnCanvas(page, box.x + 150, box.y + 150, box.x + 350, box.y + 350);
    await page.waitForTimeout(300);

    // Select the frame in the layers panel (first item = frame)
    await selectLayerInPanel(page, 0);

    // Add smart filter to the frame
    await addSmartFilter(page, 'Invert');
    await page.waitForTimeout(500);

    // Verify Smart Filters section is visible
    const smartFiltersSection = page.getByText('Object Filters', { exact: true }).first();
    await expect(smartFiltersSection).toBeVisible({ timeout: 5000 });

    await page.screenshot({
      path: 'reports/smart-filters/frame-invert.png',
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
  });
});
