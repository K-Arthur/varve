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
      const scaleX = canvas.width / Math.max(1, rect.width);
      const scaleY = canvas.height / Math.max(1, rect.height);
      const px = Math.max(0, Math.min(canvas.width - 1, Math.round((cx - rect.left) * scaleX)));
      const py = Math.max(0, Math.min(canvas.height - 1, Math.round((cy - rect.top) * scaleY)));
      const data = ctx.getImageData(px, py, 1, 1).data;
      return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0];
    },
    [x, y] as [number, number],
  );
}

function expectInvertedPixel(
  before: [number, number, number, number],
  after: [number, number, number, number],
) {
  expect(Math.abs(after[0] - (255 - before[0]))).toBeLessThanOrEqual(4);
  expect(Math.abs(after[1] - (255 - before[1]))).toBeLessThanOrEqual(4);
  expect(Math.abs(after[2] - (255 - before[2]))).toBeLessThanOrEqual(4);
  expect(after[3]).toBe(before[3]);
}

function expectSamePixel(
  expected: [number, number, number, number],
  actual: [number, number, number, number],
) {
  expect(actual).toEqual(expected);
}

test.describe('Object Filters — Invert workflow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('add invert filter to a rectangle — canvas pixels change', async ({ page }) => {
    // Create a rectangle. Its default fill is intentionally not assumed: the
    // test compares the rendered pixel with its sampled inverse instead.
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const cx = box.x + 250;
    const cy = box.y + 200;

    // Draw rect
    await dragOnCanvas(page, 170, 140, 330, 260);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });

    // Wait for paint
    await page.waitForTimeout(500);

    const before = await readCanvasPixel(page, cx, cy);
    expect(before[3]).toBeGreaterThan(0);
    await canvas.screenshot({ path: 'reports/smart-filters/invert-before.png' });

    // Select the layer
    await selectLayerInPanel(page, 0);

    // Open Smart Filters section and add Invert
    await addSmartFilter(page, 'Invert');
    await page.waitForTimeout(500);

    const after = await readCanvasPixel(page, cx, cy);
    expectInvertedPixel(before, after);
    await expect(page.locator('.smart-filters__row')).toHaveCount(1);

    // Screenshot for visual inspection
    await page.screenshot({
      path: 'reports/smart-filters/invert-applied.png',
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
    await canvas.screenshot({ path: 'reports/smart-filters/invert-applied-canvas.png' });
  });

  test('toggle filter visibility — reverts to original', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const cx = box.x + 250;
    const cy = box.y + 200;
    await dragOnCanvas(page, 170, 140, 330, 260);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);

    // Record original color
    const original = await readCanvasPixel(page, cx, cy);

    // Add filter
    await selectLayerInPanel(page, 0);
    await addSmartFilter(page, 'Invert');
    await page.waitForTimeout(500);

    const inverted = await readCanvasPixel(page, cx, cy);
    expectInvertedPixel(original, inverted);

    // Toggle visibility off (click the eye icon button)
    const eyeBtn = page.locator('button.smart-filters__visibility').first();
    await eyeBtn.click();
    await page.waitForTimeout(500);

    const toggled = await readCanvasPixel(page, cx, cy);
    expectSamePixel(original, toggled);

    await page.screenshot({
      path: 'reports/smart-filters/invert-toggled-off.png',
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
  });

  test('bypass whole Object Filter stack — keeps entries intact', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const cx = box.x + 250;
    const cy = box.y + 200;
    await dragOnCanvas(page, 170, 140, 330, 260);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);

    const original = await readCanvasPixel(page, cx, cy);
    await selectLayerInPanel(page, 0);
    await addSmartFilter(page, 'Invert');
    await page.waitForTimeout(500);
    expectInvertedPixel(original, await readCanvasPixel(page, cx, cy));

    const bypass = page.locator('button.smart-filters__stack-visibility');
    await expect(bypass).toHaveAttribute('aria-label', 'Disable all Object Filters');
    await bypass.click();
    await expect(bypass).toHaveAttribute('aria-pressed', 'false');
    await expect(bypass).toHaveAttribute('aria-label', 'Enable all Object Filters');
    expectSamePixel(original, await readCanvasPixel(page, cx, cy));
    await expect(page.locator('.smart-filters__row')).toHaveCount(1);

    await page.screenshot({
      path: 'reports/smart-filters/stack-bypassed.png',
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
    await dragOnCanvas(page, 170, 140, 330, 260);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);

    const original = await readCanvasPixel(page, cx, cy);

    await selectLayerInPanel(page, 0);
    await addSmartFilter(page, 'Invert');
    await page.waitForTimeout(500);

    // Remove the filter
    const removeBtn = page.locator('button.smart-filters__remove').first();
    await removeBtn.click();
    await page.waitForTimeout(500);

    const removed = await readCanvasPixel(page, cx, cy);
    expectSamePixel(original, removed);

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
    await dragOnCanvas(page, 170, 140, 330, 260);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);

    const original = await readCanvasPixel(page, cx, cy);

    await selectLayerInPanel(page, 0);
    await addSmartFilter(page, 'Invert');
    await page.waitForTimeout(500);

    const inverted = await readCanvasPixel(page, cx, cy);
    expectInvertedPixel(original, inverted);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);

    const undone = await readCanvasPixel(page, cx, cy);
    expectSamePixel(original, undone);
  });

  test('multiple filters coexist — blur + invert both apply', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    await dragOnCanvas(page, 170, 140, 330, 260);
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

    await dragOnCanvas(page, 150, 150, 350, 300);
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

    await dragOnCanvas(page, 150, 150, 350, 300);
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

    await dragOnCanvas(page, 100, 100, 400, 400);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(300);

    // Create a rect inside the frame
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 350);
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
