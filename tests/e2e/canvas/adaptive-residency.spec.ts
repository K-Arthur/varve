import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function sampleCanvas(
  page: import('@playwright/test').Page,
  box: { x: number; y: number; w: number; h: number },
): Promise<number[]> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  return canvas.evaluate((element, area) => {
    const surface = element as HTMLCanvasElement;
    const context = surface.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    const scaleX = surface.width / surface.clientWidth;
    const scaleY = surface.height / surface.clientHeight;
    const points = [0.25, 0.5, 0.75].map((fraction) => ({
      x: area.x + area.w * fraction,
      y: area.y + area.h * 0.5,
    }));
    return points.map((point) => {
      const pixel = context.getImageData(
        Math.max(0, Math.min(surface.width - 1, Math.round(point.x * scaleX))),
        Math.max(0, Math.min(surface.height - 1, Math.round(point.y * scaleY))),
        1,
        1,
      ).data;
      return (
        Math.max(...Array.from(pixel).slice(0, 3)) - Math.min(...Array.from(pixel).slice(0, 3))
      );
    });
  }, box);
}

async function canvasHash(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let i = 0; i < pixels.length; i += 97) {
      hash ^= pixels[i] ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  });
}

test('selected-frame image import remains nested, clipped, and pixel-stable', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await navigateToEditor(page);

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await page.keyboard.press('f');
  await page.mouse.move(300, 250);
  await page.mouse.down();
  await page.mouse.move(700, 550, { steps: 4 });
  await page.mouse.up();

  const frameRow = page.getByRole('treeitem').filter({ hasText: /frame/i }).first();
  await expect(frameRow).toBeVisible();
  await frameRow.click();
  await expect(frameRow).toHaveAttribute('aria-selected', 'true');
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/photo-fixture.jpg'));

  const imageRow = page
    .getByRole('treeitem')
    .filter({ hasText: /photo-fixture|jpg/i })
    .first();
  await expect(imageRow).toHaveAttribute('aria-level', '2');
  await expect(page.getByRole('treeitem')).toHaveCount(2);

  await page.getByRole('button', { name: 'Fit all to viewport' }).click();
  await page.waitForTimeout(600);
  await frameRow.click();

  const layout = page.getByRole('button', { name: /^layout$/i });
  if ((await layout.getAttribute('aria-expanded')) !== 'true') await layout.click();
  await expect(page.getByRole('checkbox', { name: /^clip content$/i })).toBeChecked();

  const selection = page.locator('svg:has(filter#selection-glow) > rect').first();
  await expect(selection).toBeVisible();
  const bounds = await selection.evaluate((element) => {
    const rect = element as SVGRectElement;
    return {
      x: rect.x.baseVal.value + rect.width.baseVal.value * 0.1,
      y: rect.y.baseVal.value + rect.height.baseVal.value * 0.1,
      w: rect.width.baseVal.value * 0.8,
      h: rect.height.baseVal.value * 0.8,
    };
  });
  const samples = await sampleCanvas(page, bounds);
  expect(Math.max(...samples), 'nested image interior should contain image pixels').toBeGreaterThan(
    12,
  );
  expect(new Set(samples).size).toBeGreaterThan(1);
  await page.screenshot({ path: testInfo.outputPath('nested-image-clipped.png') });

  const beforeFullRedraw = await canvasHash(page);
  await page.evaluate(async () => {
    const perf = (window as Window & { __strataPerf?: { forceFullRedraw?: () => boolean } })
      .__strataPerf;
    perf?.forceFullRedraw?.();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  expect(await canvasHash(page), 'full redraw oracle should match the incremental frame').toBe(
    beforeFullRedraw,
  );

  await canvas.focus();
});
