import { expect, test } from '@playwright/test';
import { createAdjustmentLayer, navigateToEditorWithRetry } from '../helpers/gradient-map-helpers';

const DITHER_ADJUSTMENT = {
  id: 'kernel-preview-e2e',
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
  cellSize: 1,
  alphaCutoff: 0,
  seed: 17,
};

test.describe('live-effect kernel sample', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test('runs the module worker and captures the sample in all three themes', async ({
    page,
  }, info) => {
    await navigateToEditorWithRetry(page);
    await page.setViewportSize({ width: 1280, height: 900 });
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
    await expect(preview.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Sample output for dither; not the selected artwork',
    );
    await expect(preview.getByRole('status')).toHaveText('Kernel sample ready', {
      timeout: 15000,
    });

    for (const theme of ['light', 'dark', 'high-contrast'] as const) {
      await page.evaluate(
        (value) => document.documentElement.setAttribute('data-theme', value),
        theme,
      );
      await preview.screenshot({ path: info.outputPath(`kernel-sample-${theme}.png`) });
    }
  });
});
