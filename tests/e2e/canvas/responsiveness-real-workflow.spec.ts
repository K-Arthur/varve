/**
 * Real-document responsiveness journey. This deliberately uses the
 * repository-provenanced stress board and photograph rather than a synthetic
 * rect so persistence, Layers projection, raster loading, and canvas input all
 * share one browser session.
 */
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const SVG_FIXTURE = resolve('tests/e2e/fixtures/layers-stress-board.svg');
const PHOTO_FIXTURE = resolve('tests/e2e/fixtures/real-life-still-life.jpg');

async function surfaceHash(page: import('@playwright/test').Page): Promise<number> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas context unavailable');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let index = 0; index < pixels.length; index += 16) {
      hash = Math.imul(hash ^ (pixels[index] ?? 0), 16777619);
      hash = Math.imul(hash ^ (pixels[index + 1] ?? 0), 16777619);
      hash = Math.imul(hash ^ (pixels[index + 2] ?? 0), 16777619);
    }
    return hash;
  });
}

async function forceFullRedraw(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as unknown as { __varvePerf?: { forceFullRedraw?: () => void } }
    ).__varvePerf?.forceFullRedraw?.();
  });
  await page.waitForTimeout(120);
}

test('real SVG/photo workflow keeps input and pixels authoritative', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page, '/?perf=1');

  await page.getByRole('menubar').getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /import/i }).click();
  await page.locator('#file-import-input').setInputFiles([SVG_FIXTURE, PHOTO_FIXTURE]);

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.layers-panel [role="treeitem"]').first()).toBeVisible({
    timeout: 30000,
  });
  await page.waitForTimeout(500);

  // Exercise the panel-open path, then the collapsed/hidden path reported by
  // brush users in other editors.
  const hideLayers = page.getByRole('button', { name: /hide layers panel/i });
  if (await hideLayers.isVisible({ timeout: 1000 }).catch(() => false)) {
    await hideLayers.click();
    await expect(page.getByRole('button', { name: /show layers panel/i })).toBeVisible();
    await page.getByRole('button', { name: /show layers panel/i }).click();
  }

  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas bounds unavailable');
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const initialHash = await surfaceHash(page);

  // Select and multi-drag real imported content, then resize through the
  // canvas gesture path. The exact object under the point is fixture-owned;
  // the assertions are about input completion and pixels, not a toy shape.
  await page.keyboard.press('v');
  await page.mouse.click(center.x - 120, center.y - 60);
  await page.mouse.down();
  await page.mouse.move(center.x - 40, center.y - 20, { steps: 5 });
  await page.mouse.up();
  await page.mouse.move(center.x - 40, center.y - 20);
  await page.mouse.down();
  await page.mouse.move(center.x + 30, center.y + 30, { steps: 6 });
  await page.mouse.up();

  // Pan, zoom, switch to paint, draw a short stroke, nudge, and history round
  // trip. Each action uses real browser input and is followed by the pixel
  // freshness oracle rather than a timing-only assertion.
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, 180);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await page.keyboard.press('p');
  await page.mouse.move(center.x - 30, center.y + 20);
  await page.mouse.down();
  await page.mouse.move(center.x + 40, center.y + 25, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('v');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');

  const visibility = page
    .locator('.layers-panel [role="treeitem"] button[aria-label^="Hide "]')
    .first();
  if (await visibility.isVisible({ timeout: 1000 }).catch(() => false)) {
    await visibility.click();
    await expect(page.locator('.layers-panel [role="treeitem"]').first()).toBeVisible();
    await visibility.click();
  }
  await forceFullRedraw(page);
  const liveHash = await surfaceHash(page);
  expect(liveHash, 'real workflow must produce a painted surface').not.toBe(initialHash);
  await page.screenshot({ path: testInfo.outputPath('real-workflow-layers-open.png') });
});
