/**
 * Eyedropper tool — real pointer flow through the canvas.
 *
 * Chromium exposes the EyeDropper API, which the tool prefers. That prompt is
 * not automatable, so these tests delete the API before app scripts load to
 * exercise the canvas-pixel fallback path — the same path every WebKitGTK /
 * Firefox / Safari session takes.
 */
import { expect, type Page, test } from '@playwright/test';
import { canvasLocator, navigateToEditor, seedLayers } from '../shared';

test.use({ viewport: { width: 1440, height: 900 } });

/** Force the canvas-pixel fallback path (the EyeDropper prompt is not automatable). */
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    // EyeDropper lives on Window.prototype (non-own), so `delete` misses it.
    // An own undefined property shadows the prototype and makes
    // `typeof EyeDropper` resolve to 'undefined' in the app.
    (window as unknown as Record<string, unknown>).EyeDropper = undefined;
  });
});

function activateEyedropper(page: Page) {
  return page.locator('[data-tool="eyedropper"]').first();
}

/** Read one canvas pixel in CSS coordinates relative to the viewport. */
async function readPixel(page: Page, sx: number, sy: number): Promise<number[]> {
  return page.evaluate(
    ([sx, sy]: number[]) => {
      if (sx === undefined || sy === undefined) throw new Error('missing pixel coordinates');
      const canvas = document.querySelector(
        'canvas.editor-canvas__content-layer',
      ) as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context on content canvas');
      const d = ctx.getImageData(
        Math.round((sx - rect.left) * scaleX),
        Math.round((sy - rect.top) * scaleY),
        1,
        1,
      ).data;
      return [d[0]!, d[1]!, d[2]!, d[3]!];
    },
    [sx, sy],
  );
}

test('eyedropper applies a canvas sample to the selected layer fill', async ({ page }) => {
  await navigateToEditor(page);
  await seedLayers(page, 1);

  const canvas = canvasLocator(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');

  // The seeded rect covers +100..+180 in canvas CSS space; its center is a
  // solid sample of the current fill. The sample source must be a point that
  // (a) is outside the rect and (b) actually hits the canvas — the top-left
  // corner is covered by the selection breadcrumb, so offset well into the
  // canvas (verified via elementFromPoint in the initial probe run).
  const rectCenter = { x: box.x + 140, y: box.y + 140 };
  const samplePoint = { x: box.x + 300, y: box.y + 60 };

  const before = await readPixel(page, rectCenter.x, rectCenter.y);
  const source = await readPixel(page, samplePoint.x, samplePoint.y);
  expect(before).not.toEqual(source);

  await activateEyedropper(page).click();
  await page.mouse.click(samplePoint.x, samplePoint.y);

  await expect
    .poll(async () => readPixel(page, rectCenter.x, rectCenter.y), { timeout: 10_000 })
    .toEqual(source);
});

test('eyedropper without a selection explains what to do instead of failing silently', async ({
  page,
}) => {
  await navigateToEditor(page);
  await seedLayers(page, 1);

  const canvas = canvasLocator(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');

  // Deselect everything.
  await page.keyboard.press('Escape');
  const rectCenter = { x: box.x + 140, y: box.y + 140 };
  const before = await readPixel(page, rectCenter.x, rectCenter.y);

  await activateEyedropper(page).click();
  await page.mouse.click(box.x + 300, box.y + 60);

  await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
    'Select a layer to apply the sampled color',
    { timeout: 5000 },
  );

  // Nothing changed on the canvas.
  expect(await readPixel(page, rectCenter.x, rectCenter.y)).toEqual(before);
});
