import { expect, type Page } from '@playwright/test';

/** Hold the drawable viewport fixed while testing glyph/history pixels.
 * Responsive breadcrumb geometry is covered by selection-path.spec.ts;
 * these pixel oracles must compare the same backing store and camera.
 */
export async function reserveSelectionPathRow(page: Page): Promise<void> {
  await expect(page.locator('.selection-breadcrumb')).toBeVisible();
  await page.evaluate(() => {
    const dock = document.querySelector<HTMLElement>('.editor-shell__canvas-dock');
    const path = document.querySelector<HTMLElement>('.selection-breadcrumb');
    if (!dock || !path) throw new Error('selected canvas dock geometry unavailable');
    const height = path.getBoundingClientRect().height;
    if (!(height > 0)) throw new Error('selection path has no measurable height');
    dock.style.gridTemplateRows = `${height}px minmax(0, 1fr)`;
  });
}

export async function currentCanvasBox(page: Page) {
  const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
  if (!box) throw new Error('drawable canvas has no current bounds');
  return box;
}

export async function clearCanvasSelection(page: Page): Promise<void> {
  const box = await currentCanvasBox(page);
  // The ruler is 20px tall. This point belongs to the drawable canvas and is
  // outside the text/image fixture, rather than the former breadcrumb row.
  await page.mouse.click(box.x + 30, box.y + 30);
  await expect(page.locator('.layers-panel [role="treeitem"][aria-selected="true"]')).toHaveCount(
    0,
  );
}

export async function selectPaintedText(page: Page): Promise<void> {
  const box = await currentCanvasBox(page);
  const glyph = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.editor-canvas__content-layer');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) throw new Error('text canvas unavailable');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    // Both readiness fixtures use dark text on the empty light canvas.
    for (let y = 30; y < canvas.height; y++)
      for (let x = 30; x < canvas.width; x++) {
        const offset = (y * canvas.width + x) * 4;
        if (
          data[offset + 3]! > 128 &&
          data[offset]! < 100 &&
          data[offset + 1]! < 100 &&
          data[offset + 2]! < 100
        )
          return {
            x: ((x + 0.5) * canvas.clientWidth) / canvas.width,
            y: ((y + 0.5) * canvas.clientHeight) / canvas.height,
          };
      }
    throw new Error('no painted text glyph found');
  });
  await page.mouse.click(box.x + glyph.x, box.y + glyph.y);
  await expect(page.locator('.layers-panel [role="treeitem"][aria-selected="true"]')).toHaveCount(
    1,
  );
}

export async function canvasOracleGeometry(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.editor-canvas__content-layer');
    const perf = (
      window as unknown as {
        __varvePerf?: {
          getLast(): {
            camera?: { zoom: number; panX: number; panY: number; rotation: number };
          } | null;
        };
      }
    ).__varvePerf;
    if (!canvas || !perf) throw new Error('canvas oracle requires ?perf=1 and a mounted canvas');
    const frame = perf.getLast();
    if (!frame?.camera) throw new Error('canvas oracle camera has not committed');
    return {
      width: canvas.width,
      height: canvas.height,
      dpr: devicePixelRatio,
      camera: frame.camera,
    };
  });
}
