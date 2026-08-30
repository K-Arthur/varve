import path from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

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
  test('applies Vignette to an imported image and bypasses it without removing the value', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    await navigateToEditor(page);
    const section = await openImageTuning(page);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible();

    const vignette = section.getByRole('group', { name: 'Vignette', exact: true });
    const slider = vignette.getByRole('slider', { name: 'Vignette Amount', exact: true });
    await expect(slider).toHaveValue('0');
    await expect(vignette.getByRole('button', { name: 'Disable Vignette Amount' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await forceFullRedraw(page);
    const before = await canvas.screenshot();
    const beforePixels = await canvasPixelFingerprint(page);
    await testInfo.attach('vignette-before', { body: before, contentType: 'image/png' });
    await canvas.screenshot({
      path: path.join(REVIEW_DIR, `vignette-before-${testInfo.project.name}.png`),
    });

    // This changes the actual range control, rather than patching document
    // state, so it crosses the inspector -> smart-filter -> canvas path.
    await slider.fill('-80');
    await expect(slider).toHaveValue('-80');
    await expect(vignette.getByRole('button', { name: 'Disable Vignette Amount' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await forceFullRedraw(page);
    await expectCanvasToDifferFrom(page, beforePixels);
    const applied = await canvas.screenshot();
    await testInfo.attach('vignette-applied', { body: applied, contentType: 'image/png' });
    await canvas.screenshot({
      path: path.join(REVIEW_DIR, `vignette-applied-${testInfo.project.name}.png`),
    });
    await page.screenshot({
      path: path.join(REVIEW_DIR, `image-tuning-panel-${testInfo.project.name}.png`),
      fullPage: false,
    });

    // Bypass must preserve the entry and its parameter rather than reset or
    // destructively bake it into the imported bitmap.
    const disable = vignette.getByRole('button', { name: 'Disable Vignette Amount' });
    await disable.click();
    await expect(vignette.getByRole('button', { name: 'Enable Vignette Amount' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(slider).toHaveValue('-80');

    await forceFullRedraw(page);
    await expectCanvasToMatch(page, beforePixels);
    const bypassed = await canvas.screenshot();
    await testInfo.attach('vignette-bypassed', { body: bypassed, contentType: 'image/png' });
    await canvas.screenshot({
      path: path.join(REVIEW_DIR, `vignette-bypassed-${testInfo.project.name}.png`),
    });
  });

  test('records a tuning edit in undo history', async ({ page }) => {
    test.setTimeout(120000);
    await navigateToEditor(page);
    const section = await openImageTuning(page);
    const fineTexture = section.getByRole('group', { name: 'Fine Texture', exact: true });
    const slider = fineTexture.getByRole('slider', { name: 'Fine Texture', exact: true });

    await expect(slider).toHaveValue('0');
    await slider.fill('40');
    await expect(slider).toHaveValue('40');
    await expect(fineTexture.getByRole('button', { name: 'Disable Fine Texture' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Re-selecting the image proves the inspector reads the persisted filter
    // entry, not an uncontrolled local slider value.
    await page.getByRole('treeitem').first().click();
    await expect(slider).toHaveValue('40');

    await page.keyboard.press('Control+z');
    await expect(slider).toHaveValue('0');
    await expect(fineTexture.getByRole('button', { name: 'Disable Fine Texture' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('uses descriptive treatment cards and renders Local Contrast, Atmospheric Depth, Dehaze, Grain, and Highlight Glow non-destructively', async ({
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

    await expect(
      section.getByRole('region', { name: 'Local Contrast & Depth', exact: true }),
    ).toBeVisible();

    const semanticCards = [
      ['Fine Texture', 'Fine Texture'],
      ['Local Contrast', 'Local Contrast'],
      ['Atmospheric Depth', 'Atmospheric Depth'],
      ['Dehaze', 'Dehaze'],
      ['Vignette', 'Vignette Amount'],
      ['Grain', 'Grain Amount'],
      ['Highlight Glow', 'Glow Amount'],
    ] as const;
    for (const [treatmentName, controlName] of semanticCards) {
      const card = section.getByRole('group', { name: treatmentName, exact: true });
      await expect(card).toBeVisible();
      await expect(card.getByRole('slider', { name: controlName, exact: true })).toBeVisible();
      await expect(
        card.getByText(`Advanced ${treatmentName} settings`, { exact: true }),
      ).toBeVisible();
    }

    const grainCard = section.getByRole('group', { name: 'Grain', exact: true });
    await grainCard.getByText('Advanced Grain settings', { exact: true }).click();
    for (const name of ['Grain Amount', 'Grain Size', 'Grain Roughness', 'Pattern Variation']) {
      await expect(grainCard.getByRole('slider', { name, exact: true })).toBeVisible();
    }
    for (const ambiguousName of ['Strength', 'Scale', 'Character', 'Seed']) {
      await expect(grainCard.getByRole('slider', { name: ambiguousName, exact: true })).toHaveCount(
        0,
      );
    }
    const grainTerminology = await grainCard.screenshot();
    await testInfo.attach('grain-descriptive-controls', {
      body: grainTerminology,
      contentType: 'image/png',
    });
    await grainCard.screenshot({
      path: path.join(REVIEW_DIR, `grain-descriptive-controls-${testInfo.project.name}.png`),
    });

    // Each slider is driven through the inspector rather than by patching
    // document state. The canvas capture is intentionally re-taken after a
    // full redraw, which covers the async render path used by the editor.
    const treatments = [
      {
        id: 'definition-amount',
        label: 'Local Contrast',
        sliderLabel: 'Local Contrast',
        value: '80',
      },
      {
        id: 'atmosphere-amount',
        label: 'Atmospheric Depth',
        sliderLabel: 'Atmospheric Depth',
        value: '80',
      },
      { id: 'dehaze-amount', label: 'Dehaze', sliderLabel: 'Dehaze', value: '80' },
      { id: 'grain-strength', label: 'Grain', sliderLabel: 'Grain Amount', value: '80' },
      {
        id: 'softBloom-strength',
        label: 'Highlight Glow',
        sliderLabel: 'Glow Amount',
        value: '90',
      },
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

  test('keeps Object Finishing discoverable on a 50% vector rectangle without changing its source opacity', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    await navigateToEditor(page);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible();

    await page.keyboard.press('r');
    await dragOnCanvas(page, 160, 140, 500, 360);
    const rectangle = page.getByRole('treeitem').first();
    await expect(rectangle).toBeVisible();
    await rectangle.click();

    const inspector = page.locator('.editor__inspector-panel');
    await inspector.getByRole('tab', { name: 'Properties', exact: true }).click();
    const appearance = inspector.getByRole('button', { name: 'Appearance', exact: true });
    await expect(appearance).toBeVisible();
    if ((await appearance.getAttribute('aria-expanded')) !== 'true') await appearance.click();

    const opacity = inspector.getByRole('spinbutton', { name: 'Opacity', exact: true });
    await expect(opacity).toBeVisible();
    await opacity.fill('0.5');
    await opacity.press('Enter');
    await expect(opacity).toHaveValue('0.5');

    await inspector.getByRole('tab', { name: 'Appearance', exact: true }).click();
    const objectFilters = inspector.getByRole('button', { name: 'Object Filters', exact: true });
    await expect(objectFilters).toBeVisible();
    if ((await objectFilters.getAttribute('aria-expanded')) !== 'true') await objectFilters.click();

    const finishing = inspector.locator('.object-finishing');
    await expect(finishing).toBeVisible();
    await expect(
      finishing.getByRole('heading', { name: 'Object Finishing', exact: true }),
    ).toBeVisible();
    const actions = finishing.getByRole('group', { name: 'Add object finishing', exact: true });
    await expect(actions).toBeVisible();
    for (const label of ['Grain', 'Vignette', 'Highlight Glow']) {
      await expect(
        actions.getByRole('button', { name: `Add ${label} object filter`, exact: true }),
      ).toBeVisible();
    }

    await forceFullRedraw(page);
    const beforePixels = await canvasPixelFingerprint(page);
    await actions.getByRole('button', { name: 'Add Grain object filter', exact: true }).click();
    await expect(inspector.locator('.smart-filters__row')).toContainText('Grain');
    await inspector.getByRole('tab', { name: 'Properties', exact: true }).click();
    const propertiesAppearance = inspector.getByRole('button', { name: 'Appearance', exact: true });
    if ((await propertiesAppearance.getAttribute('aria-expanded')) !== 'true') {
      await propertiesAppearance.click();
    }
    await expect(inspector.getByRole('spinbutton', { name: 'Opacity', exact: true })).toHaveValue(
      '0.5',
    );

    await forceFullRedraw(page);
    await expectCanvasToDifferFrom(page, beforePixels);
    const finishingReview = await inspector.screenshot();
    await testInfo.attach('object-finishing-grain-at-50-percent-opacity', {
      body: finishingReview,
      contentType: 'image/png',
    });
    await inspector.screenshot({
      path: path.join(REVIEW_DIR, `object-finishing-grain-${testInfo.project.name}.png`),
    });
  });
});
