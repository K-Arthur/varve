import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function readContentPixel(
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
    return { r: pixel[0]!, g: pixel[1]!, b: pixel[2]!, a: pixel[3]! };
  }, point);
}

test('editable vector contour and clipped raster texture survive SVG and PDF export', async ({
  page,
}, testInfo) => {
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await navigateToEditor(page);

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('content canvas not found');

  // Create an editable vector silhouette with the real Rectangle tool.
  await page.keyboard.press('r');
  await page.mouse.move(canvasBox.x + 120, canvasBox.y + 130);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 390, canvasBox.y + 360, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press('v');
  const contourRow = page.getByRole('treeitem', {
    name: /^Rectangle 1, Vector rectangle$/,
  });
  await expect(contourRow).toBeVisible();
  await contourRow.click();

  const paint = page.locator('[data-testid="toolbar"] [data-tool="paint"]');
  if (await paint.isVisible().catch(() => false)) {
    await paint.click();
  } else {
    await page.getByRole('button', { name: /More tools|Overflow/i }).click();
    const paintChoice = page.getByRole('menuitemradio', { name: /^Paint$/i });
    if (await paintChoice.isVisible().catch(() => false)) await paintChoice.click();
    else {
      await page.getByRole('menuitem', { name: 'Raster', exact: true }).click();
      await page.getByRole('menuitemradio', { name: /^Paint$/i }).click();
    }
  }

  const optionsTrigger = page.getByRole('button', { name: 'Tool options' });
  await expect(optionsTrigger).toBeVisible();
  if ((await optionsTrigger.getAttribute('aria-expanded')) !== 'true') {
    await optionsTrigger.click();
  }
  const options = page.locator('.tool-options__popover');
  await options.getByRole('button', { name: 'Create clipped paint layer' }).click();
  await expect(
    page.getByRole('treeitem').filter({ hasText: /Rectangle 1 clipped paint/ }),
  ).toBeVisible();
  await expect(page.getByRole('treeitem').filter({ hasText: 'Shading' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  const foreground = options.getByLabel('Foreground color');
  await foreground.fill('#f02c20');
  await foreground.press('Enter');
  const size = options.getByLabel('Size');
  await size.fill('72');
  await size.press('Enter');
  await page.screenshot({ path: testInfo.outputPath('vector-contour-before-texture.png') });
  await optionsTrigger.click();

  // The gesture crosses the contour edge: the raster child may retain paint
  // only where the separate vector source supplies alpha coverage.
  const outside = { x: canvasBox.x + 440, y: canvasBox.y + 245 };
  const outsideBefore = await readContentPixel(page, outside);
  await page.mouse.move(canvasBox.x + 250, canvasBox.y + 245);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 510, canvasBox.y + 245, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole('treeitem').filter({ hasText: 'Shading' })).toBeVisible();
  const inside = { x: canvasBox.x + 300, y: canvasBox.y + 245 };
  await expect
    .poll(async () => (await readContentPixel(page, inside)).r, { timeout: 15_000 })
    .toBeGreaterThan(180);
  const redInside = await readContentPixel(page, inside);
  const outsideAfter = await readContentPixel(page, outside);
  expect(redInside.g).toBeLessThan(redInside.r);
  expect(outsideAfter).toEqual(outsideBefore);
  await page.screenshot({ path: testInfo.outputPath('vector-contour-clipped-texture.png') });
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => (await readContentPixel(page, inside)).g, { timeout: 15_000 })
    .toBeGreaterThan(100);
  await page.keyboard.press('Control+Shift+z');
  await expect
    .poll(async () => (await readContentPixel(page, inside)).r, { timeout: 15_000 })
    .toBeGreaterThan(180);

  // Put both peer nodes under one ordinary group so one export contains the
  // editable contour and the clipped raster island.
  await contourRow.click();
  const clippedGroup = page.getByRole('treeitem', {
    name: /^Rectangle 1 clipped paint, Group, live alpha mask$/,
  });
  await clippedGroup.click({ modifiers: ['Control'] });
  const layers = page.getByRole('tree', { name: /layers/i });
  await layers.press('Control+g');
  await expect(page.getByRole('treeitem', { name: /^Group, Group/ }).first()).toBeVisible();

  await page.keyboard.press('Control+s');
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 60_000 });
  await page.reload({ timeout: 180_000, waitUntil: 'commit' });
  await page.locator('.varve-home').waitFor({ timeout: 60_000 });
  await page
    .getByRole('gridcell', { name: /Untitled 1/ })
    .last()
    .dblclick();
  await page.locator('.layers-panel').waitFor({ timeout: 60_000 });
  const artworkGroup = page.getByRole('treeitem', { name: /^Group, Group/ }).first();
  await artworkGroup.click();
  await page.getByRole('button', { name: 'Fit selection to viewport' }).click();
  await page.waitForTimeout(300);
  const reopenedCanvas = page.locator('canvas.editor-canvas__content-layer');
  const reopenedBox = await reopenedCanvas.boundingBox();
  if (!reopenedBox) throw new Error('reopened content canvas not found');
  const reopenedPixel = await readContentPixel(page, {
    x: reopenedBox.x + reopenedBox.width * 0.45,
    y: reopenedBox.y + reopenedBox.height * 0.5,
  });
  expect(reopenedPixel.r).toBeGreaterThan(reopenedPixel.g);

  const exportTab = page.getByRole('tab', { name: 'Export', exact: true });
  if (await exportTab.isVisible().catch(() => false)) await exportTab.click();
  else {
    await page.getByRole('button', { name: /^More inspector tabs/ }).click();
    await page
      .getByRole('menu', { name: 'More inspector tabs' })
      .getByRole('menuitem', { name: 'Export', exact: true })
      .click();
  }

  await page.getByRole('radio', { name: 'SVG', exact: true }).click();
  const svgDownloadPromise = page.waitForEvent('download', { timeout: 180_000 });
  await page.getByRole('button', { name: /Download.*SVG/i }).click();
  const svgDownload = await svgDownloadPromise;
  const svgPath = testInfo.outputPath('vector-contour-clipped-texture.svg');
  await svgDownload.saveAs(svgPath);
  const svg = await readFile(svgPath, 'utf8');
  expect(svg).toContain('<svg');
  expect(svg).toMatch(/<(?:path|rect|polygon)\b/);
  expect(svg).toContain('data:image/png;base64,');
  const svgCenter = await page.evaluate(async (markup) => {
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('could not create SVG inspection canvas');
    context.drawImage(image, 0, 0);
    const pixel = context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
    return { r: pixel[0]!, g: pixel[1]!, b: pixel[2]! };
  }, svg);
  expect(svgCenter.r).toBeGreaterThan(svgCenter.g + 35);
  await page.screenshot({ path: testInfo.outputPath('vector-clipped-texture-export.png') });

  const pdfRadio = page.getByRole('radio', { name: 'PDF', exact: true });
  await expect(pdfRadio).toBeEnabled();
  await pdfRadio.click();
  const pdfDownloadPromise = page.waitForEvent('download', { timeout: 180_000 });
  await page.getByRole('button', { name: /Download.*PDF/i }).click();
  const pdfDownload = await pdfDownloadPromise;
  const pdfPath = testInfo.outputPath('vector-contour-clipped-texture.pdf');
  await pdfDownload.saveAs(pdfPath);
  const pdf = await readFile(pdfPath);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.toString('latin1')).toContain('/Subtype /Image');
});
