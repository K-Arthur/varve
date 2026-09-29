import { expect, test } from '@playwright/test';
import { createAdjustmentLayer, navigateToEditorWithRetry } from '../helpers/gradient-map-helpers';
import { dragOnCanvas } from '../shared';

const DITHER_ADJUSTMENT = {
  id: 'source-preview-e2e',
  kind: 'dither',
  visible: true,
  opacity: 1,
  blendMode: 'normal',
  algorithm: 'bayer',
  paletteMode: 'levels',
  levels: 4,
  colors: [],
  metric: 'rgb',
  serpentine: false,
  strength: 1,
  bayerSize: 4,
  cellSize: 6,
  alphaCutoff: 0,
  seed: 23,
};

test.describe('upstream-source live-effect worker preview', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test('previews selected artwork in the worker while keeping the canvas authoritative', async ({
    page,
  }, testInfo) => {
    await navigateToEditorWithRetry(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 410, 330);
    await expect(page.getByRole('treeitem')).toHaveCount(1);
    expect(await createAdjustmentLayer(page, [DITHER_ADJUSTMENT])).toBe(true);

    const adjustmentsTab = page.getByRole('tab', { name: /Adjustments/i });
    await expect(adjustmentsTab).toBeVisible({ timeout: 5000 });
    await adjustmentsTab.click();
    const ditherRow = page.locator('.adj-panel__item-select').filter({ hasText: 'Dither' });
    await expect(ditherRow).toBeVisible({ timeout: 10000 });
    await ditherRow.click();

    const preview = page.locator('.live-effect-kernel-preview');
    await expect(preview).toBeVisible({ timeout: 10000 });
    await preview.scrollIntoViewIfNeeded();
    await expect(preview).toHaveAttribute('aria-label', /preview of upstream adjustment input/);
    await expect(preview.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Reduced worker preview for dither on the selected adjustment input; canvas output remains authoritative',
    );
    await expect(preview.getByRole('status')).toHaveText(
      'Source preview ready; canvas rendering is unchanged.',
      { timeout: 15000 },
    );
    const dimensions = await preview.locator('canvas').evaluate((canvas) => ({
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
    }));
    expect(dimensions.width).toBeGreaterThan(0);
    expect(dimensions.height).toBeGreaterThan(0);
    expect(dimensions.width).toBeLessThanOrEqual(256);
    expect(dimensions.height).toBeLessThanOrEqual(256);

    for (const theme of ['light', 'dark', 'high-contrast'] as const) {
      await page.evaluate(
        (value) => document.documentElement.setAttribute('data-theme', value),
        theme,
      );
      await preview.screenshot({ path: testInfo.outputPath(`upstream-source-${theme}.png`) });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const showInspector = page.getByRole('button', { name: /show inspector panel/i });
    if (await showInspector.count()) await showInspector.click();
    await preview.scrollIntoViewIfNeeded();
    await expect(preview).toBeVisible();
    await preview.screenshot({ path: testInfo.outputPath('upstream-source-portrait.png') });
    const box = await preview.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(390);
  });
});
