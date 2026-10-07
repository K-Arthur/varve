/**
 * Liquify E2E — real pointer drag on the real canvas.
 *
 * Verifies that the deformation visibly changes the artwork, that it is
 * non-destructive (undo returns the exact source frame), and that the tool
 * exposes its overlay and real controls while active. Pixel comparison reads
 * the canvas buffer in-page (`getImageData`) after the original comparison
 * view is painted. Pixels stay in the browser instead of bloating the trace
 * with millions of serialized channel values.
 *
 * Run with:
 *   npx playwright test tests/e2e/canvas/liquify.spec.ts --project=chromium --reporter=list
 */

import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(420_000);

interface PixelView {
  width: number;
  height: number;
  camera: { zoom: number; panX: number; panY: number; rotation: number };
}

interface PixelProbe {
  capture: (key: string) => PixelView | null;
  diff: (first: string, second: string) => { mean: number; max: number; changed: number };
}

async function installPixelProbe(page: Page) {
  await page.evaluate(() => {
    const saved = new Map<string, ImageData>();
    const probe: PixelProbe = {
      capture: (key) => {
        const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]');
        const context = canvas?.getContext('2d');
        const perf = (
          window as unknown as {
            __varvePerf?: { getLast: () => { camera?: PixelView['camera'] } | null };
          }
        ).__varvePerf;
        const camera = perf?.getLast()?.camera;
        if (!canvas || !context || !camera) return null;
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        let alphaSum = 0;
        for (let i = 3; i < image.data.length; i += 4 * 97) alphaSum += image.data[i]!;
        if (alphaSum === 0) return null;
        saved.set(key, image);
        return { width: image.width, height: image.height, camera: { ...camera } };
      },
      diff: (first, second) => {
        const a = saved.get(first);
        const b = saved.get(second);
        if (!a || !b) throw new Error('Both pixel captures are required');
        if (a.width !== b.width || a.height !== b.height) {
          throw new Error('Pixel comparison requires identical backing-store dimensions');
        }
        let sum = 0;
        let max = 0;
        let changed = 0;
        let count = 0;
        for (let i = 0; i < a.data.length; i += 4) {
          for (let c = 0; c < 3; c++) {
            const delta = Math.abs(a.data[i + c]! - b.data[i + c]!);
            sum += delta;
            if (delta > max) max = delta;
            if (delta > 2) changed++;
            count++;
          }
        }
        return { mean: count ? sum / count : 0, max, changed: count ? changed / count : 0 };
      },
    };
    (window as unknown as { __liquifyPixelProbe: PixelProbe }).__liquifyPixelProbe = probe;
  });
}

async function capture(page: Page, key: string, expected?: PixelView): Promise<PixelView> {
  let shot: PixelView | null = null;
  // Undo temporarily changes the contextual bar's geometry. Compare only
  // after the original camera is painted again, rather than after a fixed
  // delay. Keep the actual pixels in the browser: transferring millions of
  // numbers both slows the test and bloats its retained trace.
  await expect
    .poll(
      async () => {
        await forceAuthoritativeRedraw(page);
        shot = await page.evaluate((name) => {
          const probe = (window as unknown as { __liquifyPixelProbe: PixelProbe })
            .__liquifyPixelProbe;
          return probe.capture(name);
        }, key);
        return expected ? shot : shot !== null;
      },
      { timeout: 15_000, message: 'Wait for a painted frame at the comparison view' },
    )
    .toEqual(expected ?? true);
  return shot!;
}

async function diff(page: Page, first: string, second: string) {
  return page.evaluate(
    ([a, b]) => {
      const probe = (window as unknown as { __liquifyPixelProbe: PixelProbe }).__liquifyPixelProbe;
      return probe.diff(a!, b!);
    },
    [first, second],
  );
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
  const applied = await page.evaluate(() =>
    (
      window as unknown as {
        __varvePerf?: { fixtures: { apply: (id: string) => Promise<{ ok: boolean }> } };
      }
    ).__varvePerf?.fixtures.apply('retouch-raster'),
  );
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
    const before = await capture(page, 'before');
    await testInfo.attach('liquify-before', {
      body: await page.getByTestId('editor-canvas').screenshot(),
      contentType: 'image/png',
    });

    // The floating options dialog covers the canvas center at this viewport.
    // Read the actual canvas hit target and opaque pixels before choosing the
    // stroke location; sampling only the backing canvas can succeed even when
    // the dialog is intercepting the real pointer drag.
    const canvas = page.getByTestId('editor-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const dragTarget = await page.evaluate(() => {
      const surface = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]');
      const options = document
        .querySelector('[data-testid="liquify-options"]')
        ?.closest<HTMLElement>('[role="dialog"]');
      const context = surface?.getContext('2d');
      if (!surface || !options || !context) return null;

      const canvasRect = surface.getBoundingClientRect();
      const optionsRect = options.getBoundingClientRect();
      const x = canvasRect.left + canvasRect.width * 0.5;
      // Keep the complete ±10px brush path above the floating options panel.
      const highestSafeY = Math.min(canvasRect.bottom - 24, optionsRect.top - 32);
      for (let y = highestSafeY; y >= canvasRect.top + 24; y -= 3) {
        if (document.elementFromPoint(x, y) !== surface) continue;
        const pixelX = Math.floor(((x - canvasRect.left) / canvasRect.width) * surface.width);
        const pixelY = Math.floor(((y - canvasRect.top) / canvasRect.height) * surface.height);
        const alpha = context.getImageData(pixelX, pixelY, 1, 1).data[3] ?? 0;
        if (alpha > 200) return { x, y, alpha };
      }
      return null;
    });
    expect(dragTarget, 'Find opaque artwork exposed above the options dialog').not.toBeNull();
    const { x: startX, y: startY, alpha: sourceAlpha } = dragTarget!;
    expect(sourceAlpha, 'The real drag must begin on opaque fixture texture').toBeGreaterThan(200);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let step = 1; step <= 10; step++) {
      await page.mouse.move(startX + step * 14, startY + Math.sin(step / 2) * 10, { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(900);
    const deformed = await capture(page, 'deformed', before);
    const deformation = await diff(page, 'before', 'deformed');
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
    const undone = await capture(page, 'undone', before);
    expect({ width: undone.width, height: undone.height }).toEqual({
      width: before.width,
      height: before.height,
    });
    await testInfo.attach('liquify-undone', {
      body: await page.getByTestId('editor-canvas').screenshot(),
      contentType: 'image/png',
    });
    const undoMetrics = await diff(page, 'before', 'undone');
    expect(undoMetrics.mean).toBeLessThan(0.1);

    // Redo re-applies the same deformation.
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(900);
    await rasterLayer.click();
    await expect(rasterLayer).toHaveAttribute('aria-selected', 'true');
    const redone = await capture(page, 'redone', deformed);
    expect({ width: redone.width, height: redone.height }).toEqual({
      width: deformed.width,
      height: deformed.height,
    });
    const redoMetrics = await diff(page, 'deformed', 'redone');
    expect(redoMetrics.mean).toBeLessThan(0.1);
  });
});
