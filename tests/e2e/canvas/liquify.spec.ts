/**
 * Liquify E2E — real pointer drag on the real canvas.
 *
 * Verifies that the deformation visibly changes the artwork, that it is
 * non-destructive (undo returns the exact source frame), and that the tool
 * exposes its overlay and real controls while active. Pixel comparison reads
 * the canvas buffer in-page (`getImageData`), which is immune to screenshot
 * timing artifacts under load.
 *
 * Run with:
 *   npx playwright test tests/e2e/canvas/liquify.spec.ts --project=chromium --reporter=list
 */

import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(420_000);

declare global {
  interface Window {
    __varvePerf?: {
      fixtures: {
        apply: (id: string) => Promise<{ ok: boolean }>;
      };
      forceFullRedraw: () => void;
    };
    __retouchProbe?: {
      capture: () => { width: number; height: number; data: number[] } | null;
      diff: (
        a: { data: number[] },
        b: { data: number[] },
      ) => { mean: number; max: number; changed: number };
    };
  }
}

async function installPixelProbe(page: Page) {
  await page.evaluate(() => {
    const canvas = (): HTMLCanvasElement | null =>
      document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]');
    window.__retouchProbe = {
      capture: () => {
        const el = canvas();
        const ctx = el?.getContext('2d');
        if (!el || !ctx) return null;
        const image = ctx.getImageData(0, 0, el.width, el.height);
        return { width: image.width, height: image.height, data: Array.from(image.data) };
      },
      diff: (a, b) => {
        let sum = 0;
        let max = 0;
        let changed = 0;
        let count = 0;
        const len = Math.min(a.data.length, b.data.length);
        for (let i = 0; i < len; i += 4) {
          for (let c = 0; c < 3; c++) {
            const d = Math.abs(a.data[i + c]! - b.data[i + c]!);
            sum += d;
            if (d > max) max = d;
            if (d > 2) changed++;
            count++;
          }
        }
        return { mean: count ? sum / count : 0, max, changed: count ? changed / count : 0 };
      },
    };
  });
}

async function capture(page: Page) {
  // Wait for a painted frame: the first paint after navigation can lag under
  // load, and a blank buffer would poison every later comparison.
  for (let attempt = 0; attempt < 40; attempt++) {
    const shot = await page.evaluate(() => window.__retouchProbe!.capture());
    if (shot) {
      let alphaSum = 0;
      for (let i = 3; i < shot.data.length; i += 4 * 97) alphaSum += shot.data[i]!;
      if (alphaSum > 0) return shot;
    }
    await page.waitForTimeout(250);
  }
  throw new Error('canvas never painted');
}

async function diff(page: Page, a: { data: number[] }, b: { data: number[] }) {
  return page.evaluate(([first, second]) => window.__retouchProbe!.diff(first!, second!), [
    a,
    b,
  ] as const);
}

async function forceAuthoritativeRedraw(page: Page): Promise<void> {
  const result = await page.evaluate(async () => {
    const perf = (
      window as unknown as {
        __varvePerf?: { forceFullRedraw: () => Promise<{ authoritative: boolean }> };
      }
    ).__varvePerf;
    if (!perf) throw new Error('Full-redraw oracle is unavailable');
    return perf.forceFullRedraw();
  });
  expect(result.authoritative).toBe(true);
}

async function openEditorWithRetouchFixture(page: Page): Promise<void> {
  await navigateToEditor(page, '/?perf=1', { startupTimeout: 300_000 });
  const applied = await page.evaluate(() => window.__varvePerf?.fixtures.apply('retouch-raster'));
  expect(applied?.ok).toBe(true);
  await page
    .locator('.layers-panel')
    .getByText(/raster layer/i)
    .first()
    .waitFor({ timeout: 15_000 });
}

test.describe('liquify', () => {
  test('a push drag deforms, undo restores, and redo re-applies', async ({ page }, testInfo) => {
    await openEditorWithRetouchFixture(page);
    await installPixelProbe(page);
    const rasterLayer = page
      .getByRole('treeitem')
      .filter({ hasText: /Raster Layer/i })
      .first();
    await rasterLayer.click();
    await expect(rasterLayer).toHaveAttribute('aria-selected', 'true');
    // A freshly seeded origin layer can be clipped behind the dock. Fit the
    // selected artwork before capturing or dragging; the canvas midpoint is
    // otherwise blank and can produce a valid but invisible deformation.
    await page.getByRole('button', { name: 'Fit selection to viewport', exact: true }).click();
    await page.waitForTimeout(500);
    // Activate Liquify (Y) and confirm the real tool + overlay are live.
    await page.keyboard.press('y');
    const options = page.getByRole('dialog', { name: /Liquify tool options/i });
    await expect(options).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.liquify-overlay')).toBeAttached({ timeout: 10_000 });
    // The panel exposes the real controls, not placeholders.
    await expect(page.getByTestId('liquify-options')).toBeVisible();
    await expect(options.getByRole('button', { name: /Reset deformation/i })).toBeEnabled();

    // Capture with this tool and selection's contextual bar geometry. History
    // restores the revision's selection, which can differ from the later click.
    await forceAuthoritativeRedraw(page);
    const before = await capture(page);
    await testInfo.attach('liquify-before', {
      body: await page.getByTestId('editor-canvas').screenshot(),
      contentType: 'image/png',
    });

    // Drag horizontally across the fixture's textured area.
    const canvas = page.getByTestId('editor-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + box!.width * 0.5;
    const startY = box!.y + box!.height * 0.5;
    const sourceAlpha = await canvas.evaluate((element) => {
      const surface = element as HTMLCanvasElement;
      const context = surface.getContext('2d');
      if (!context) throw new Error('Missing artwork canvas context');
      return context.getImageData(
        Math.floor(surface.width / 2),
        Math.floor(surface.height / 2),
        1,
        1,
      ).data[3];
    });
    expect(sourceAlpha, 'The real drag must begin on opaque fixture texture').toBeGreaterThan(200);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let step = 1; step <= 10; step++) {
      await page.mouse.move(startX + step * 14, startY + Math.sin(step / 2) * 10, { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(900);
    await forceAuthoritativeRedraw(page);
    const deformed = await capture(page);
    const deformation = await diff(page, before, deformed);
    await testInfo.attach('liquify-deformed', {
      body: await page.getByTestId('editor-canvas').screenshot(),
      contentType: 'image/png',
    });
    // The artwork must visibly change where the brush moved.
    expect(deformation.mean).toBeGreaterThan(0.2);
    expect(deformation.max).toBeGreaterThan(50);

    // One undo restores the exact source frame.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(900);
    // The fixture revision predates its selection. Reselect the same existing
    // layer without changing the artwork or camera, keeping the viewport fixed.
    await rasterLayer.click();
    await expect(rasterLayer).toHaveAttribute('aria-selected', 'true');
    await forceAuthoritativeRedraw(page);
    const undone = await capture(page);
    expect({ width: undone.width, height: undone.height }).toEqual({
      width: before.width,
      height: before.height,
    });
    await testInfo.attach('liquify-undone', {
      body: await page.getByTestId('editor-canvas').screenshot(),
      contentType: 'image/png',
    });
    const undoMetrics = await diff(page, before, undone);
    expect(undoMetrics.mean).toBeLessThan(0.1);

    // Redo re-applies the same deformation.
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(900);
    await rasterLayer.click();
    await expect(rasterLayer).toHaveAttribute('aria-selected', 'true');
    await forceAuthoritativeRedraw(page);
    const redone = await capture(page);
    expect({ width: redone.width, height: redone.height }).toEqual({
      width: deformed.width,
      height: deformed.height,
    });
    const redoMetrics = await diff(page, deformed, redone);
    expect(redoMetrics.mean).toBeLessThan(0.1);
  });
});
