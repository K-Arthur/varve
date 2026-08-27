import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Human-reviewed application-level text smoke test.
 *
 * The engine visual harness exercises replayIr in isolation. This test also
 * drives the real text tool, editor state, canvas compositor, selection overlay,
 * and fit-selection camera path so a text regression cannot hide behind a
 * passing primitive-level screenshot.
 */
test('renders multilingual text in the editor canvas', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await navigateToEditor(page);

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('editor canvas has no bounds');

  await page.keyboard.press('t');
  await page.mouse.click(box.x + 180, box.y + 180);
  await page.keyboard.insertText(
    'Latin office — ﬁ ﬂ · العربية بالعربية · עברית RTL · हिन्दी नमस्ते · 日本語 · \u{1F469}\u{1F3FD}\u200D\u{1F4BB}',
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

  await page.getByRole('button', { name: 'Fit sel' }).click();
  await page.waitForTimeout(500);

  const outputDir = process.env.VARVE_VISUAL_QA_DIR ?? testInfo.outputDir;
  await expect(canvas).toBeVisible();
  const inkPixels = await page.evaluate(() => {
    const element = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement | null;
    if (!element) return 0;
    const pixels = element.getContext('2d')?.getImageData(0, 0, element.width, element.height).data;
    if (!pixels) return 0;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i]! < 180 && pixels[i + 1]! < 180 && pixels[i + 2]! < 180 && pixels[i + 3]! > 0) {
        count += 1;
      }
    }
    return count;
  });
  expect(inkPixels).toBeGreaterThan(100);
  await canvas.screenshot({ path: `${outputDir}/editor-multilingual-text.png` });
});
