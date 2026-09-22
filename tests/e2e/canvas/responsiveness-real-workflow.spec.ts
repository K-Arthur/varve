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

async function surfaceHash(page: import('@playwright/test').Page): Promise<string> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas context unavailable');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return crypto.subtle
      .digest('SHA-256', pixels)
      .then((digest) =>
        Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
      );
  });
}

async function forceFullRedraw(page: import('@playwright/test').Page): Promise<void> {
  const result = (await page.evaluate(async () => {
    (
      window as unknown as {
        __varvePerf?: {
          forceFullRedraw?: () => Promise<{
            authoritative: boolean;
            renderPath: string;
            frameIndex: number;
          }>;
        };
      }
    ).__varvePerf?.forceFullRedraw?.();
  })) as { authoritative: boolean; renderPath: string; frameIndex: number } | undefined;
  expect(result, 'full-redraw oracle must be installed').toBeTruthy();
  expect(result?.authoritative).toBe(true);
  expect(['compositor', 'structural']).toContain(result?.renderPath);
}

async function assertFreshSurface(
  page: import('@playwright/test').Page,
  label: string,
): Promise<string> {
  const liveHash = await surfaceHash(page);
  await forceFullRedraw(page);
  const authoritativeHash = await surfaceHash(page);
  expect(liveHash, `${label}: live surface must match an authoritative full redraw`).toBe(
    authoritativeHash,
  );
  return liveHash;
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
  await assertFreshSurface(page, 'first drag');
  await page.mouse.move(center.x - 40, center.y - 20);
  await page.mouse.down();
  await page.mouse.move(center.x + 30, center.y + 30, { steps: 6 });
  await page.mouse.up();
  await assertFreshSurface(page, 'second drag');

  const resizeHandle = page.getByLabel('Bottom-right resize handle');
  await expect(resizeHandle, 'imported content must expose a real resize handle').toBeVisible();
  const beforeResize = await resizeHandle.boundingBox();
  if (!beforeResize) throw new Error('resize handle bounds unavailable');
  await page.mouse.move(
    beforeResize.x + beforeResize.width / 2,
    beforeResize.y + beforeResize.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    beforeResize.x + beforeResize.width / 2 + 32,
    beforeResize.y + beforeResize.height / 2 + 24,
    { steps: 4 },
  );
  await page.mouse.up();
  const afterResize = await resizeHandle.boundingBox();
  if (!afterResize) throw new Error('resized handle bounds unavailable');
  expect(afterResize.x).toBeGreaterThan(beforeResize.x);
  expect(afterResize.y).toBeGreaterThan(beforeResize.y);
  await assertFreshSurface(page, 'handle resize');

  // Pan, zoom, switch to paint, draw a short stroke, nudge, and history round
  // trip. Each action uses real browser input; the settled sequence is checked
  // by the pixel-freshness oracle below rather than a timing-only assertion.
  await page.mouse.move(center.x, center.y);
  // Pixel-mode input exercises the trackpad path without introducing a
  // synthetic mouse-inertia tail that would keep the camera moving while the
  // oracle samples it.
  await page.mouse.wheel(0, 40);
  await assertFreshSurface(page, 'pan');
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await assertFreshSurface(page, 'zoom');
  await page.keyboard.press('p');
  await page.mouse.move(center.x - 30, center.y + 20);
  await page.mouse.down();
  await page.mouse.move(center.x + 40, center.y + 25, { steps: 8 });
  await page.mouse.up();
  await assertFreshSurface(page, 'paint');
  await page.keyboard.press('v');
  await page.keyboard.press('ArrowRight');
  await assertFreshSurface(page, 'nudge');
  await page.keyboard.press('Control+z');
  await assertFreshSurface(page, 'undo');
  await page.keyboard.press('Control+Shift+z');
  await assertFreshSurface(page, 'redo');

  const visibility = page
    .locator('.layers-panel [role="treeitem"] button[aria-label^="Hide "]')
    .first();
  if (await visibility.isVisible({ timeout: 1000 }).catch(() => false)) {
    await visibility.click();
    await assertFreshSurface(page, 'hide layer');
    await expect(page.locator('.layers-panel [role="treeitem"]').first()).toBeVisible();
    await visibility.click();
    await assertFreshSurface(page, 'show layer');
  }
  const liveHash = await assertFreshSurface(page, 'final workflow');
  expect(liveHash, 'real workflow must produce a painted surface').not.toBe(initialHash);
  await page.screenshot({ path: testInfo.outputPath('real-workflow-layers-open.png') });

  const collapse = page.getByRole('button', { name: /hide layers panel/i });
  if (await collapse.isVisible({ timeout: 1000 }).catch(() => false)) {
    await collapse.click();
    await expect(page.getByRole('button', { name: /show layers panel/i })).toBeVisible();
    await assertFreshSurface(page, 'layers collapsed');
    await page.screenshot({ path: testInfo.outputPath('real-workflow-layers-collapsed.png') });
    await page.getByRole('button', { name: /show layers panel/i }).click();
    await assertFreshSurface(page, 'layers reopened');
  }
});
