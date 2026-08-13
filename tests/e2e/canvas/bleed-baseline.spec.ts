/**
 * Bleed canvas behavior spec (Phase 2 baseline + post-change verification):
 * - no bleed configured => no print overlay beyond the trim outline
 * - content beyond trim stays visible (pages are not content-clipped)
 * - per-page bleed set via the Page tool inspector renders a bleed guide
 * - guide geometry is deterministic at fit zoom; stroke stays legible zoomed
 */
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

interface Cam {
  zoom: number;
  pan: { x: number; y: number };
}

function fitCamera(
  bounds: { x: number; y: number; w: number; h: number },
  vp: { width: number; height: number },
  padding = 40,
): Cam {
  const availW = Math.max(1, vp.width - 2 * padding);
  const availH = Math.max(1, vp.height - 2 * padding);
  const zoom = Math.min(availW / Math.max(1e-6, bounds.w), availH / Math.max(1e-6, bounds.h));
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  return { zoom, pan: { x: vp.width / 2 - cx * zoom, y: vp.height / 2 - cy * zoom } };
}

function toScreen(wx: number, wy: number, cam: Cam): { x: number; y: number } {
  return { x: wx * cam.zoom + cam.pan.x, y: wy * cam.zoom + cam.pan.y };
}

async function canvasSize(
  page: import('@playwright/test').Page,
): Promise<{ width: number; height: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas.editor-canvas__content-layer') as
      | HTMLCanvasElement
      | undefined;
    if (!canvas) return { width: 800, height: 600 };
    return { width: canvas.clientWidth, height: canvas.clientHeight };
  });
}

async function pixelAtCanvasRel(
  page: import('@playwright/test').Page,
  relX: number,
  relY: number,
): Promise<{ r: number; g: number; b: number } | null> {
  return page.evaluate(
    ([x, y]) => {
      const canvas = document.querySelector('canvas.editor-canvas__content-layer') as
        | HTMLCanvasElement
        | undefined;
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const scaleX = canvas.width / canvas.clientWidth;
      const scaleY = canvas.height / canvas.clientHeight;
      const px = Math.round(x * scaleX);
      const py = Math.round(y * scaleY);
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
      const data = ctx.getImageData(px, py, 1, 1).data;
      return { r: data[0]!, g: data[1]!, b: data[2]! };
    },
    [relX, relY] as const,
  );
}

test.describe('Bleed canvas behavior', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(420000);

  test('no bleed config, content beyond trim, and inspector bleed guides', async ({ page }) => {
    await navigateToEditor(page);

    // A new document starts page-less (flat pasteboard); bleed is a page
    // concept, so create the print surface first.
    await page.getByRole('button', { name: 'Add page' }).click();
    await page.waitForTimeout(400);
    await page
      .locator('canvas.editor-canvas__content-layer')
      .waitFor({ state: 'attached', timeout: 20000 });

    // Rectangle crossing right and bottom trim (trim is 1920x1080 at origin).
    await page.keyboard.press('r');
    await dragOnCanvas(page, 300, 300, 2300, 1400);
    await page.keyboard.press('Escape');

    // Print workspace enables bleed guides by default.
    await page.keyboard.press('Control+Shift+2');
    await page.waitForTimeout(400);

    await page.keyboard.press('Shift+3');
    await page.waitForTimeout(500);

    const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
    if (!box) throw new Error('no canvas');
    await page.screenshot({
      path: 'reports/bleed-baseline/01-print-workspace-no-bleed-configured.png',
      clip: box,
    });

    // Unconfigured documents resolve to zero bleed — nothing beyond the trim.
    const guideCount = await page.locator('.print-bleed-guide').count();
    const trimMarkCount = await page.locator('.print-trim-mark').count();
    expect(guideCount).toBe(0);
    expect(trimMarkCount).toBe(0);

    // Content beyond trim must be visible (page content is not clipped).
    const vp = await canvasSize(page);
    const cam = fitCamera({ x: 0, y: 0, w: 1920, h: 1080 }, vp);
    const beyondTrim = toScreen(2010, 900, cam); // right of trim x=1920
    const pixel = await pixelAtCanvasRel(page, beyondTrim.x, beyondTrim.y);
    expect(
      pixel && !(pixel.r < 200 && pixel.g < 200 && pixel.b < 200),
      `content beyond trim must be visible (pixel ${JSON.stringify(beyondTrim)}: ${JSON.stringify(pixel)})`,
    ).toBeTruthy();

    // Activate Page tool, click the page centre (clear of nothing — the
    // page tool activates the page regardless of what is under the cursor),
    // then set per-page bleed via the inspector.
    await page.keyboard.press('Escape');
    await page.keyboard.press('q');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);

    await page.getByText('Page Print').first().waitFor({ timeout: 5000 });

    const bleedTop = page.getByLabel(/bleed top/i);
    await bleedTop.fill('20');
    await page.getByLabel(/bleed right/i).fill('20');
    await page.getByLabel(/bleed bottom/i).fill('20');
    await page.getByLabel(/bleed left/i).fill('20');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+3');
    await page.waitForTimeout(500);

    // One dashed bleed guide rect per page, offset 20px beyond trim.
    await expect(page.locator('.print-bleed-guide')).toHaveCount(1);
    const guideBox = await page.locator('.print-bleed-guide').boundingBox();
    expect(guideBox).not.toBeNull();

    await page.screenshot({
      path: 'reports/bleed-baseline/02-bleed-20px-guides.png',
      clip: (await page.locator('canvas.editor-canvas__content-layer').boundingBox())!,
    });

    // Zoom in (4x): physical offset scales with zoom, stroke stays 1px.
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.waitForTimeout(400);
    await page.screenshot({
      path: 'reports/bleed-baseline/03-bleed-20px-zoom-in.png',
      clip: (await page.locator('canvas.editor-canvas__content-layer').boundingBox())!,
    });

    // Bleed fields carry the resolved config's unit.
    const unitLabel = await bleedTop.getAttribute('aria-valuetext');
    expect(unitLabel ?? '').toContain('px');
  });
});
