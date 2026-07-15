import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

/**
 * Regression coverage for a stacking-order bug where the selection overlay
 * SVG (and sibling interactive overlays) had no explicit z-index, so it
 * painted in the same stacking batch as `z-index: 0` — below the canvas
 * paint layers (`.editor-canvas__content-layer` z-index 2,
 * `.editor-canvas__overlay-layer` z-index 3), which draw an opaque page
 * background across their full bounds. The result: the selection outline,
 * resize handles, rotation handle, and dimension label were constructed
 * correctly in the DOM (right position, right color) but were completely
 * invisible on screen — not just where a shape happened to be drawn, but
 * everywhere within the canvas bounds.
 *
 * jsdom-based component tests cannot catch this class of bug because jsdom
 * does not perform real paint/compositing — only a real browser render does.
 * These tests read pixels from an actual composited screenshot.
 */
test.describe('Selection overlay visibility', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('selection outline and handles are actually painted above the canvas, not just present in the DOM', async ({
    page,
  }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 300, 300, 500, 420);
    await page.keyboard.press('v');
    await page.waitForTimeout(300);

    const overlaySvg = page.locator('svg:has(filter#selection-glow)');
    await expect(overlaySvg).toBeVisible();

    // DOM/CSSOM invariant: the overlay must out-rank the opaque canvas paint
    // layers in the stacking order, or every pixel check below is moot no
    // matter how correct the SVG's own geometry and colors are.
    const stacking = await page.evaluate(() => {
      const overlay = Array.from(document.querySelectorAll('svg')).find((s) =>
        s.querySelector('filter#selection-glow'),
      );
      const contentLayer = document.querySelector('.editor-canvas__content-layer');
      const overlayLayer = document.querySelector('.editor-canvas__overlay-layer');
      const z = (el: Element | null) => {
        const value = el ? getComputedStyle(el).zIndex : 'auto';
        return value === 'auto' ? 0 : Number.parseInt(value, 10);
      };
      return {
        overlayZ: z(overlay ?? null),
        contentLayerZ: z(contentLayer),
        overlayLayerZ: z(overlayLayer),
      };
    });
    expect(stacking.overlayZ).toBeGreaterThan(stacking.contentLayerZ);
    expect(stacking.overlayZ).toBeGreaterThan(stacking.overlayLayerZ);

    // Real pixel check: crop a screenshot of the canvas section (which
    // contains both the paint canvases and the SVG overlay as composited
    // siblings) and decode it back in-page to sample actual rendered pixels
    // — proving the overlay isn't just logically present but visually painted.
    const section = page.locator('section.editor-canvas');
    const shot = await section.screenshot();
    const dataUrl = `data:image/png;base64,${shot.toString('base64')}`;

    // The drawn rect is at local (300,300)-(500,420); the outline stroke
    // sits exactly on that boundary, and the dimension label ("200 x 120")
    // sits below the shape entirely on the empty background.
    const samples = await page.evaluate(async (src) => {
      const img = new Image();
      const loaded = new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('image failed to decode'));
      });
      img.src = src;
      await loaded;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
      return {
        // Top edge of the outline stroke (should differ from both the plain
        // background and the shape's flat teal fill if the stroke paints).
        topEdge: at(400, 300),
        justAboveTopEdge: at(400, 296),
        // The dimension-label pill, entirely outside the shape, over empty
        // background — only visible at all if the overlay paints above the
        // canvas layers everywhere, not merely over the shape.
        labelArea: at(400, 434),
        emptyBackgroundFarAway: at(50, 50),
      };
    }, dataUrl);

    // The stroke pixel must differ from the plain empty background color —
    // if the overlay were hidden, every one of these would equal the flat
    // background color sampled far from the shape.
    const differs = (a: number[], b: number[]) =>
      Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!) > 12;

    expect(
      differs(samples.justAboveTopEdge, samples.emptyBackgroundFarAway),
      `pixel just above the selection outline (${samples.justAboveTopEdge}) should differ from empty background (${samples.emptyBackgroundFarAway}) — the outline stroke must be painted there`,
    ).toBe(true);
    expect(
      differs(samples.labelArea, samples.emptyBackgroundFarAway),
      `pixel inside the dimension-label pill (${samples.labelArea}) should differ from empty background (${samples.emptyBackgroundFarAway}) — the label sits entirely outside the shape and only paints if the overlay is above the canvas layers`,
    ).toBe(true);
  });
});
