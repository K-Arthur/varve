import path from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const PHOTO_FIXTURE = path.resolve('tests/e2e/fixtures/photo-fixture.jpg');
const REVIEW_DIR = path.resolve('reports/ui-review/image-tuning');

async function openImageTuning(page: Page): Promise<Locator> {
  await page.locator('#file-import-input').setInputFiles(PHOTO_FIXTURE);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 30000 });
  await page.getByRole('button', { name: 'Fit selection to viewport' }).click();
  await page.waitForTimeout(250);

  const inspector = page.locator('.editor__inspector-panel');
  await inspector.getByRole('tab', { name: 'Adjustments', exact: true }).click();

  const trigger = inspector.getByRole('button', { name: 'Image Tuning', exact: true });
  await expect(trigger).toBeVisible();
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }

  const section = inspector.locator('.image-tuning');
  await expect(section).toBeVisible();
  return section;
}

async function forceFullRedraw(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as unknown as {
        __varvePerf?: { forceFullRedraw?: () => void };
      }
    ).__varvePerf?.forceFullRedraw?.();
  });
  await page.waitForTimeout(500);
}

async function canvasPixelFingerprint(page: Page): Promise<string> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('Content canvas is not an HTMLCanvasElement');
    }
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Content canvas does not expose a 2D context');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;

    // Two independent 32-bit hashes make this a lightweight comparison of
    // the actual Canvas2D pixels, without depending on PNG encoder bytes.
    let first = 2166136261;
    let second = 0x9e3779b9;
    for (const pixel of pixels) {
      first = Math.imul(first ^ pixel, 16777619);
      second = Math.imul(second ^ pixel, 2246822519);
    }
    return `${canvas.width}x${canvas.height}:${first >>> 0}:${second >>> 0}`;
  });
}

async function expectCanvasToDifferFrom(page: Page, baseline: string): Promise<void> {
  await expect
    .poll(() => canvasPixelFingerprint(page), {
      timeout: 15000,
      message: 'the treatment should change the rendered image pixels',
    })
    .not.toBe(baseline);
}

async function expectCanvasToMatch(page: Page, expected: string): Promise<void> {
  await expect
    .poll(() => canvasPixelFingerprint(page), {
      timeout: 15000,
      message: 'bypassing the treatment should restore the untreated image pixels',
    })
    .toBe(expected);
}

test.describe('Image Tuning', () => {
  test('applies Edge Falloff to an imported image and bypasses it without removing the value', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    await navigateToEditor(page);
    const section = await openImageTuning(page);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible();

    const edgeFalloff = section.locator('[data-image-treatment="edgeFalloff-strength"]');
    const slider = edgeFalloff.getByRole('slider', { name: 'Edge Falloff' });
    await expect(slider).toHaveValue('0');
    await expect(edgeFalloff.getByRole('button', { name: 'Disable Edge Falloff' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await forceFullRedraw(page);
    const before = await canvas.screenshot();
    const beforePixels = await canvasPixelFingerprint(page);
    await testInfo.attach('edge-falloff-before', { body: before, contentType: 'image/png' });
    await canvas.screenshot({
      path: path.join(REVIEW_DIR, `edge-falloff-before-${testInfo.project.name}.png`),
    });

    // This changes the actual range control, rather than patching document
    // state, so it crosses the inspector -> smart-filter -> canvas path.
    await slider.fill('-80');
    await expect(slider).toHaveValue('-80');
    await expect(edgeFalloff.getByRole('button', { name: 'Disable Edge Falloff' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await forceFullRedraw(page);
    await expectCanvasToDifferFrom(page, beforePixels);
    const applied = await canvas.screenshot();
    await testInfo.attach('edge-falloff-applied', { body: applied, contentType: 'image/png' });
    await canvas.screenshot({
      path: path.join(REVIEW_DIR, `edge-falloff-applied-${testInfo.project.name}.png`),
    });
    await page.screenshot({
      path: path.join(REVIEW_DIR, `image-tuning-panel-${testInfo.project.name}.png`),
      fullPage: false,
    });

    // Bypass must preserve the entry and its parameter rather than reset or
    // destructively bake it into the imported bitmap.
    const disable = edgeFalloff.getByRole('button', { name: 'Disable Edge Falloff' });
    await disable.click();
    await expect(edgeFalloff.getByRole('button', { name: 'Enable Edge Falloff' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(slider).toHaveValue('-80');

    await forceFullRedraw(page);
    await expectCanvasToMatch(page, beforePixels);
    const bypassed = await canvas.screenshot();
    await testInfo.attach('edge-falloff-bypassed', { body: bypassed, contentType: 'image/png' });
    await canvas.screenshot({
      path: path.join(REVIEW_DIR, `edge-falloff-bypassed-${testInfo.project.name}.png`),
    });
  });

  test('records a tuning edit in undo history', async ({ page }) => {
    test.setTimeout(120000);
    await navigateToEditor(page);
    const section = await openImageTuning(page);
    const microDetail = section.locator('[data-image-treatment="microDetail-amount"]');
    const slider = microDetail.getByRole('slider', { name: 'Micro Detail' });

    await expect(slider).toHaveValue('0');
    await slider.fill('40');
    await expect(slider).toHaveValue('40');
    await expect(microDetail.getByRole('button', { name: 'Disable Micro Detail' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Re-selecting the image proves the inspector reads the persisted filter
    // entry, not an uncontrolled local slider value.
    await page.getByRole('treeitem').first().click();
    await expect(slider).toHaveValue('40');

    await page.keyboard.press('Control+z');
    await expect(slider).toHaveValue('0');
    await expect(microDetail.getByRole('button', { name: 'Disable Micro Detail' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('renders Definition, Atmosphere, Grain, and Soft Bloom non-destructively', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    await navigateToEditor(page);
    const section = await openImageTuning(page);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible();

    await forceFullRedraw(page);
    const untreated = await canvas.screenshot();
    const untreatedPixels = await canvasPixelFingerprint(page);
    await testInfo.attach('image-tuning-untreated', { body: untreated, contentType: 'image/png' });

    // Each slider is driven through the inspector rather than by patching
    // document state. The canvas capture is intentionally re-taken after a
    // full redraw, which covers the async render path used by the editor.
    const treatments = [
      { id: 'definition-amount', label: 'Definition', sliderLabel: 'Definition', value: '80' },
      { id: 'atmosphere-amount', label: 'Atmosphere', sliderLabel: 'Atmosphere', value: '80' },
      { id: 'grain-strength', label: 'Grain', sliderLabel: 'Strength', value: '80' },
      { id: 'softBloom-strength', label: 'Soft Bloom', sliderLabel: 'Soft Bloom', value: '90' },
    ] as const;

    for (const treatment of treatments) {
      const control = section.locator(`[data-image-treatment="${treatment.id}"]`);
      const slider = control.getByRole('slider', { name: treatment.sliderLabel });
      await expect(slider).toHaveValue('0');

      await slider.fill(treatment.value);
      await expect(slider).toHaveValue(treatment.value);
      await forceFullRedraw(page);
      await expectCanvasToDifferFrom(page, untreatedPixels);
      const applied = await canvas.screenshot();

      await testInfo.attach(`image-tuning-${treatment.id}-applied`, {
        body: applied,
        contentType: 'image/png',
      });
      await canvas.screenshot({
        path: path.join(REVIEW_DIR, `${treatment.id}-applied-${testInfo.project.name}.png`),
      });

      // Treatment visibility is the non-destructive compare path: it keeps
      // the serialized value while bypassing just that stack entry.
      const bypass = control.getByRole('button', { name: `Disable ${treatment.sliderLabel}` });
      await bypass.click();
      await expect(
        control.getByRole('button', { name: `Enable ${treatment.sliderLabel}` }),
      ).toHaveAttribute('aria-pressed', 'false');
      await expect(slider).toHaveValue(treatment.value);

      await forceFullRedraw(page);
      await expectCanvasToMatch(page, untreatedPixels);
    }
  });
});
