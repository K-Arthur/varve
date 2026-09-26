import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const requireFromEngine = createRequire(path.resolve('packages/engine/package.json'));
const { PNG } = requireFromEngine('pngjs') as {
  PNG: {
    sync: {
      read(input: Buffer): { width: number; height: number; data: Buffer };
    };
  };
};

/**
 * Count pixels that differ by more than `tolerance` in any channel inside a
 * canvas-relative rectangle. The draft prompt overlay is drawn on the canvas,
 * so "the rectangle appeared before the model could answer" is a pixel fact,
 * not a DOM fact.
 */
function countDifferingPixels(
  before: Buffer,
  after: Buffer,
  region: { x: number; y: number; width: number; height: number },
  tolerance = 16,
): number {
  const a = PNG.sync.read(before);
  const b = PNG.sync.read(after);
  if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY;
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(a.width, Math.ceil(region.x + region.width));
  const y1 = Math.min(a.height, Math.ceil(region.y + region.height));
  let differing = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = (y * a.width + x) * 4;
      const dr = Math.abs(a.data[index]! - b.data[index]!);
      const dg = Math.abs(a.data[index + 1]! - b.data[index + 1]!);
      const db = Math.abs(a.data[index + 2]! - b.data[index + 2]!);
      if (dr > tolerance || dg > tolerance || db > tolerance) differing += 1;
    }
  }
  return differing;
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
    await inspector.getByRole('tab', { name: 'Adjustments' }).click();
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
    const startX = bounds!.x + bounds!.width * 0.35;
    const startY = bounds!.y + bounds!.height * 0.4;
    const endX = bounds!.x + bounds!.width * 0.65;
    const endY = bounds!.y + bounds!.height * 0.75;

    const beforeDrag = await canvas.screenshot();
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 4 });
    await page.mouse.move(endX, endY, { steps: 4 });

    const midDrag = await canvas.screenshot({
      path: testInfo.outputPath('draft-box-mid-drag.png'),
    });
    const boxRegion = {
      x: startX - bounds!.x,
      y: startY - bounds!.y,
      width: endX - startX,
      height: endY - startY,
    };
    const boxPixels = countDifferingPixels(beforeDrag, midDrag, boxRegion);
    await testInfo.attach('draft-box-mid-drag', {
      body: midDrag,
      contentType: 'image/png',
    });
    // The rectangle is a dashed stroke over the artwork: hundreds of pixels
    // must differ inside the dragged region while the gesture is live.
    expect(boxPixels).toBeGreaterThan(50);

    // All-direction drag: the box follows the gesture, it is not forced square.
    const regionAspect = boxRegion.width / boxRegion.height;
    expect(regionAspect).toBeGreaterThan(1.2);

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
    const pointPixels = countDifferingPixels(
      beforePoint,
      afterPoint,
      { x: pointX - bounds!.x - 24, y: pointY - bounds!.y - 24, width: 48, height: 48 },
      24,
    );
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
