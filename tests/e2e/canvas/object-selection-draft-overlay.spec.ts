import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { selectInspectorTab } from '../helpers/inspector-tabs';
import { navigateToEditor } from '../shared';

const requireFromEngine = createRequire(path.resolve('packages/engine/package.json'));
const { PNG } = requireFromEngine('pngjs') as {
  PNG: {
    sync: {
      read(input: Buffer): { width: number; height: number; data: Buffer };
    };
  };
};

interface DrawnBounds {
  count: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Measure the pixels the draft prompt overlay actually drew: how many
 * changed inside a canvas-relative rectangle, and the bounds of those
 * changes. Reading the drawn bounds (rather than the mouse coordinates)
 * is what makes "the rectangle follows the gesture in both axes" a fact
 * about the screen instead of arithmetic on the test's own inputs.
 */
function measureDrawnBounds(
  before: Buffer,
  after: Buffer,
  region: { x: number; y: number; width: number; height: number },
  tolerance = 16,
): DrawnBounds {
  const a = PNG.sync.read(before);
  const b = PNG.sync.read(after);
  if (a.width !== b.width || a.height !== b.height) {
    return { count: Number.POSITIVE_INFINITY, minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(a.width, Math.ceil(region.x + region.width));
  const y1 = Math.min(a.height, Math.ceil(region.y + region.height));
  const result: DrawnBounds = {
    count: 0,
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: -1,
    maxY: -1,
  };
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = (y * a.width + x) * 4;
      const dr = Math.abs(a.data[index]! - b.data[index]!);
      const dg = Math.abs(a.data[index + 1]! - b.data[index + 1]!);
      const db = Math.abs(a.data[index + 2]! - b.data[index + 2]!);
      if (dr > tolerance || dg > tolerance || db > tolerance) {
        result.count += 1;
        if (x < result.minX) result.minX = x;
        if (y < result.minY) result.minY = y;
        if (x > result.maxX) result.maxX = x;
        if (y > result.maxY) result.maxY = y;
      }
    }
  }
  return result;
}

test.describe('Object Selection draft overlay', () => {
  test('draws the draft point and drag rectangle immediately, before any model', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await navigateToEditor(page);
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/test-image.png'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });

    const inspector = page.locator('.editor__inspector-panel');
    await selectInspectorTab(page, 'Adjustments');
    await inspector.getByRole('button', { name: 'Object Selection' }).click();
    await inspector.getByRole('button', { name: 'Select Object' }).click();
    await expect(
      page.getByTestId('toolbar').getByRole('button', { name: 'Object Selection' }),
    ).toHaveAttribute('aria-pressed', 'true');

    const canvas = page.getByTestId('editor-canvas');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();

    // --- Drag rectangle: captured while the pointer is still down, so the
    // model cannot have answered yet. A missing draft rectangle fails here.
    // The gesture is deliberately five times wider than it is tall: a box
    // forced square (the original defect class) cannot match it whatever the
    // viewport aspect happens to be.
    const startX = bounds!.x + bounds!.width * 0.25;
    const startY = bounds!.y + bounds!.height * 0.45;
    const endX = bounds!.x + bounds!.width * 0.75;
    const endY = bounds!.y + bounds!.height * 0.55;
    const gestureAspect = (endX - startX) / (endY - startY);

    const beforeDrag = await canvas.screenshot();
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 4 });
    await page.mouse.move(endX, endY, { steps: 4 });

    const midDrag = await canvas.screenshot({
      path: testInfo.outputPath('draft-box-mid-drag.png'),
    });
    const pad = 16;
    const boxRegion = {
      x: startX - bounds!.x - pad,
      y: startY - bounds!.y - pad,
      width: endX - startX + pad * 2,
      height: endY - startY + pad * 2,
    };
    const drawn = measureDrawnBounds(beforeDrag, midDrag, boxRegion);
    await testInfo.attach('draft-box-mid-drag', {
      body: midDrag,
      contentType: 'image/png',
    });
    await testInfo.attach('draft-box-drawn-bounds', {
      body: JSON.stringify({ drawn, gestureAspect }),
      contentType: 'application/json',
    });
    // The rectangle is a dashed stroke over the artwork: hundreds of pixels
    // must differ inside the dragged region while the gesture is live.
    expect(drawn.count).toBeGreaterThan(50);

    // The drawn box spans both axes at the gesture's own proportions — not a
    // square, not a point. Bounds come from the pixels, not the mouse.
    expect(drawn.maxX).toBeGreaterThan(drawn.minX);
    expect(drawn.maxY).toBeGreaterThan(drawn.minY);
    const drawnAspect = (drawn.maxX - drawn.minX) / (drawn.maxY - drawn.minY);
    expect(drawnAspect).toBeGreaterThan(gestureAspect * 0.65);
    expect(drawnAspect).toBeLessThan(gestureAspect * 1.35);

    await page.mouse.up();
    await expect(inspector.getByRole('button', { name: 'Clear prompts' })).toBeVisible({
      timeout: 5000,
    });
    await testInfo.attach('draft-box-released', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });

    // --- Point marker: click and capture before inference can respond.
    const beforePoint = await canvas.screenshot();
    const pointX = bounds!.x + bounds!.width * 0.5;
    const pointY = bounds!.y + bounds!.height * 0.5;
    await page.mouse.click(pointX, pointY);
    const afterPoint = await canvas.screenshot({ path: testInfo.outputPath('point-marker.png') });
    const pointPixels = measureDrawnBounds(
      beforePoint,
      afterPoint,
      { x: pointX - bounds!.x - 24, y: pointY - bounds!.y - 24, width: 48, height: 48 },
      24,
    ).count;
    await testInfo.attach('point-marker', {
      body: afterPoint,
      contentType: 'image/png',
    });
    expect(pointPixels).toBeGreaterThan(10);

    // --- Escape cancels the session and removes the staged prompts.
    await page.keyboard.press('Escape');
    await expect(inspector.getByRole('button', { name: 'Clear prompts' })).toHaveCount(0, {
      timeout: 5000,
    });
    await testInfo.attach('after-escape', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
  });
});
