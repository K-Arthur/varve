/**
 * Shared multipage canvas (M5, ADR-0144): multiple placed pages render
 * simultaneously on one pasteboard, content renders at its page's placed
 * position, and content is hit-testable on any page.
 *
 * Camera determinism: every test presses Shift+3 (fit active page), which
 * reproduces `fitBoundsCamera` from @varve/shared exactly; the test
 * re-derives the same world->screen mapping from the canvas size.
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

function isPaper(c: { r: number; g: number; b: number } | null): boolean {
  return !!c && c.r > 225 && c.g > 225 && c.b > 225;
}

function isBoard(c: { r: number; g: number; b: number } | null): boolean {
  // The board token is intentionally close to neutral 200 in the current
  // theme. Keep a margin for color-management/antialiasing differences while
  // remaining well below the paper fill tested above.
  return !!c && c.r < 220 && c.g < 225 && c.b < 230;
}

test.describe('Shared multipage canvas (M5)', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(420000);

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('renders all pages on one pasteboard, not only the active page', async ({ page }) => {
    const addPage = page.getByTestId('layers-panel').getByRole('button', { name: 'Add page' });
    for (let i = 0; i < 2; i++) {
      await addPage.click();
    }
    // Fit the active page (page 1) for a deterministic camera.
    await page.keyboard.press('Shift+3');
    await page.waitForTimeout(400);

    const vp = await canvasSize(page);
    // Single-page spreads stack vertically with SPREAD_GAP 144; page 1 trim
    // is 1920x1080 at world origin.
    const cam = fitCamera({ x: 0, y: 0, w: 1920, h: 1080 }, vp);

    const page1Mid = toScreen(960, 540, cam);
    const gapMid = toScreen(960, 1080 + 72, cam);
    const page2Band = toScreen(960, 1080 + 144 + 60, cam);

    const p1 = await pixelAtCanvasRel(page, page1Mid.x, page1Mid.y);
    expect(isPaper(p1), `page 1 fill at ${JSON.stringify(page1Mid)}`).toBe(true);

    const gap = await pixelAtCanvasRel(page, gapMid.x, gapMid.y);
    expect(isBoard(gap), `pasteboard gap at ${JSON.stringify(gapMid)}`).toBe(true);

    const p2 = await pixelAtCanvasRel(page, page2Band.x, page2Band.y);
    expect(isPaper(p2), `page 2 band at ${JSON.stringify(page2Band)}`).toBe(true);
  });

  test('paints content at its page placement and hit-tests across pages', async ({ page }) => {
    // Page 2 becomes the active page; content created there must render at
    // page 2's placed position (not at the pasteboard origin).
    const addPage = page.getByTestId('layers-panel').getByRole('button', { name: 'Add page' });
    // A new document starts without pages, so the first add creates Page 1;
    // create both pages needed for the cross-page placement assertion.
    await addPage.click();
    await addPage.click();
    const page2Tab = page.getByRole('tab', { name: 'Page: Page 2' });
    await page2Tab.waitFor({ state: 'visible', timeout: 10000 });
    // PageNav tabs are sortable and may be replaced in the same React commit
    // that adds a page; dispatch on the current node to avoid a stale DnD
    // actionability handle.
    await page2Tab.evaluate((element) => (element as HTMLElement).click());
    await expect(page2Tab).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
    await page.waitForTimeout(100);
    await page.keyboard.press('Shift+3');
    await page.waitForTimeout(300);

    const vp = await canvasSize(page);
    // Page 2 sits at world (0, 1224) (1080 + SPREAD_GAP 144).
    const cam = fitCamera({ x: 0, y: 1224, w: 1920, h: 1080 }, vp);

    // Draw a rect inside page 2's trim, in page-local world coordinates.
    await page.keyboard.press('r');
    await dragOnCanvas(page, toScreen(150, 100 + 1224, cam), toScreen(350, 260 + 1224, cam));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    // The page switch and first shape frame can cross a worker replay; wait
    // for the settled frame before sampling the backing canvas.
    await page.waitForTimeout(1200);

    // The rect's fill must appear at the placed position on screen…
    const center = toScreen(250, 180 + 1224, cam);
    const pixel = await pixelAtCanvasRel(page, center.x, center.y);
    expect(
      pixel && (pixel.r < 130 || pixel.g < 130 || pixel.b < 130),
      `page 2 fill at ${JSON.stringify(center)}: ${JSON.stringify(pixel)}`,
    ).toBe(true);

    // …and not at the unplaced origin (which with this camera is far off
    // screen — world (250,180) maps outside the canvas).
    const unplaced = toScreen(250, 180, cam);
    expect(
      unplaced.x < 0 || unplaced.y < 0 || unplaced.x > vp.width || unplaced.y > vp.height,
    ).toBe(true);

    // Cross-page hit testing: clicking the rect selects it. The click is in
    // viewport coordinates, so offset by the canvas element's position.
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + center.x, box!.y + center.y);
    await expect(page.locator('.selection-info-bar')).toContainText('Rect', {
      timeout: 10000,
    });
  });
});
