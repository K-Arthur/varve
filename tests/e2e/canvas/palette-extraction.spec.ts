import { expect, test } from '@playwright/test';
import { importImageFile, selectImageNode } from '../helpers/editor-helpers';
import { navigateToEditor } from '../shared';

test.describe('image palette extraction', () => {
  test('extracts, explains, and saves a palette in the Inspector', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await importImageFile(page);
    await selectImageNode(page);

    await page.getByRole('tab', { name: /^Adjustments$/i }).click();

    const paletteSection = page.locator('.insp-disclosure').filter({ hasText: /^Palette/ });
    await expect(paletteSection).toBeVisible({ timeout: 15000 });
    const paletteTrigger = paletteSection.getByRole('button', { name: /^Palette$/ });
    if ((await paletteTrigger.getAttribute('aria-expanded')) === 'false') {
      await paletteTrigger.click();
    }

    await expect(paletteSection.getByRole('heading', { name: 'Extracted colors' })).toBeVisible({
      timeout: 15000,
    });
    await expect(paletteSection.getByText('Generated, not sampled')).toBeVisible();
    await expect(paletteSection.getByText('WCAG 2.1')).toBeVisible();
    await expect(paletteSection.getByRole('button', { name: /Copy .*#/ }).first()).toBeVisible();

    await testInfo.attach('palette-inspector-light', {
      body: await paletteSection.screenshot(),
      contentType: 'image/png',
    });

    await paletteSection.getByRole('button', { name: 'Save extracted swatches' }).click();
    await expect(paletteSection.getByRole('status')).toContainText('saved as new document colors');

    await page.setViewportSize({ width: 640, height: 900 });
    await expect(paletteSection).toBeVisible();
    const overflow = await paletteSection.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });
});
