import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function readCanvasPixel(
  page: import('@playwright/test').Page,
  point: { x: number; y: number },
) {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element, screenPoint) => {
    const canvas = element as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(
        canvas.width - 1,
        Math.floor(((screenPoint.x - rect.left) * canvas.width) / rect.width),
      ),
    );
    const y = Math.max(
      0,
      Math.min(
        canvas.height - 1,
        Math.floor(((screenPoint.y - rect.top) * canvas.height) / rect.height),
      ),
    );
    const pixel = canvas.getContext('2d')?.getImageData(x, y, 1, 1).data;
    if (!pixel) throw new Error('content canvas pixel unavailable');
    return [...pixel];
  }, point);
}

test('an unselected brush fallback does not paint outside a bounded raster layer', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await navigateToEditor(page);

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('content canvas has no bounds');

  // Create a small vector object, then use the real clipped-paint workflow to
  // make a bounded raster layer with a live-alpha parent mask.
  await page.keyboard.press('r');
  await page.mouse.move(canvasBox.x + 120, canvasBox.y + 120);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 300, canvasBox.y + 250, { steps: 6 });
  await page.mouse.up();

  const contour = page.getByRole('treeitem', { name: /^Rectangle 1, Vector rectangle$/ });
  await expect(contour).toBeVisible();
  await contour.click();
  const paintTool = page.locator('[data-testid="toolbar"] [data-tool="paint"]');
  if (await paintTool.isVisible().catch(() => false)) {
    await paintTool.click();
  } else {
    await page.getByRole('button', { name: /More tools|Overflow/i }).click();
    await page.getByRole('menuitemradio', { name: /^Paint$/i }).click();
  }

  const optionsButton = page.getByRole('button', { name: 'Tool options' });
  if ((await optionsButton.getAttribute('aria-expanded')) !== 'true') await optionsButton.click();
  const options = page.locator('.tool-options__popover');
  await options.getByRole('button', { name: 'Create clipped paint layer' }).click();
  await expect(page.getByRole('treeitem').filter({ hasText: 'Shading' })).toBeVisible();

  // Clear the explicit selection. The next brush stroke should resolve by its
  // actual pointer location, not silently reuse this small raster elsewhere.
  const selectTool = page.locator('[data-testid="toolbar"] [data-tool="select"]');
  await selectTool.click();
  await expect(selectTool).toHaveAttribute('aria-pressed', 'true');
  await canvas.focus();
  await page.keyboard.press('Control+Shift+A');
  await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(0);
  await paintTool.click();
  // Brush options reopen on tool changes in a React effect. Wait for that
  // state transition before closing; an immediate attribute read can observe
  // the pre-effect closed state and let the dialog cover the pointer target.
  await expect(optionsButton).toHaveAttribute('aria-expanded', 'true');
  await optionsButton.click();
  await expect(options).toBeHidden();

  const outside = { x: canvasBox.x + 475, y: canvasBox.y + 210 };
  const before = await readCanvasPixel(page, outside);
  const layerCountBefore = await page.getByRole('treeitem').count();
  await page.mouse.move(outside.x - 30, outside.y);
  await page.mouse.down();
  await page.mouse.move(outside.x + 30, outside.y, { steps: 5 });
  await page.mouse.up();

  await expect(page.getByRole('treeitem')).toHaveCount(layerCountBefore + 1, { timeout: 10_000 });
  await expect.poll(() => readCanvasPixel(page, outside), { timeout: 10_000 }).not.toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('brush-painted-outside-bounded-layer.png') });
});
