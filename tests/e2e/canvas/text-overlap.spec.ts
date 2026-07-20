import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

/**
 * Sample a canvas region and return opaque text pixels vs semi-transparent
 * ghost candidates.  Used in multiple test scenarios below.
 */
async function sampleTextRegion(page: any, sx: number, sy: number, sw: number, sh: number) {
  return page.evaluate(
    ({ sx, sy, sw, sh }: { sx: number; sy: number; sw: number; sh: number }) => {
      const canvas = document.querySelector(
        'canvas.editor-canvas__content-layer',
      ) as HTMLCanvasElement | null;
      if (!canvas) return { error: 'content canvas not found' };

      const ctx = canvas.getContext('2d');
      if (!ctx) return { error: 'could not get 2d context' };

      const w = Math.min(sw, canvas.width - sx);
      const h = Math.min(sh, canvas.height - sy);
      if (w <= 0 || h <= 0) return { error: 'sample region out of bounds' };

      const imageData = ctx.getImageData(sx, sy, w, h);
      const data = imageData.data;

      let textPixels = 0;
      let ghostPixels = 0;
      const threshold = 100;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          const r = data[idx]!;
          const g = data[idx + 1]!;
          const b = data[idx + 2]!;
          const a = data[idx + 3]!;

          const isDark = r < threshold && g < threshold && b < threshold;

          if (isDark && a > 200) {
            textPixels++;
          } else if (isDark && a > 10 && a < 200) {
            ghostPixels++;
          }
        }
      }

      return { textPixels, ghostPixels, w, h };
    },
    { sx, sy, sw, sh },
  );
}

test.describe('Text rendering — overlap / ghosting detection', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('fresh text node on blank canvas has zero ghost pixels', async ({ page }) => {
    const contentCanvas = page.locator('canvas.editor-canvas__content-layer');
    await contentCanvas.waitFor({ state: 'visible', timeout: 15000 });

    await page.keyboard.press('t');
    await dragOnCanvas(page, 200, 200, 400, 250);

    const textarea = page.getByRole('textbox', { name: /editing text/i });
    await textarea.waitFor({ state: 'attached', timeout: 10000 });
    await textarea.fill('Hello World');
    await textarea.press('Escape');

    await page.waitForTimeout(800);

    const ghostInfo = await sampleTextRegion(page, 180, 180, 240, 80);

    console.log(
      `\n  [fresh text] textPixels=${ghostInfo.textPixels} ghostPixels=${ghostInfo.ghostPixels}` +
        ` region=${ghostInfo.w}×${ghostInfo.h}`,
    );

    if (ghostInfo.error) {
      test.fail(true, ghostInfo.error);
      return;
    }

    expect(ghostInfo.textPixels).toBeGreaterThan(0);
    expect(ghostInfo.ghostPixels).toBe(0);
  });

  test('text inside a frame has zero ghost pixels', async ({ page }) => {
    const contentCanvas = page.locator('canvas.editor-canvas__content-layer');
    await contentCanvas.waitFor({ state: 'visible', timeout: 15000 });

    // Create a frame first
    await page.keyboard.press('f');
    await dragOnCanvas(page, 100, 100, 500, 400);

    // Create text inside the frame
    await page.keyboard.press('t');
    await dragOnCanvas(page, 150, 150, 400, 250);

    const textarea = page.getByRole('textbox', { name: /editing text/i });
    await textarea.waitFor({ state: 'attached', timeout: 10000 });
    await textarea.fill('Frame Text');
    await textarea.press('Escape');

    await page.waitForTimeout(800);

    const ghostInfo = await sampleTextRegion(page, 130, 130, 280, 80);

    console.log(
      `\n  [text in frame] textPixels=${ghostInfo.textPixels} ghostPixels=${ghostInfo.ghostPixels}` +
        ` region=${ghostInfo.w}×${ghostInfo.h}`,
    );

    if (ghostInfo.error) {
      test.fail(true, ghostInfo.error);
      return;
    }

    expect(ghostInfo.textPixels).toBeGreaterThan(0);
    expect(ghostInfo.ghostPixels).toBe(0);
  });
});
