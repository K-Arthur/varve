import { expect, test } from '@playwright/test';
import { enterCropMode, importImageFile, selectImageNode } from '../helpers/editor-helpers';
import { navigateToEditor } from '../shared';

test.describe('image palette extraction', () => {
  test('extracts, explains, and saves a palette in the Inspector', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await importImageFile(page);
    await selectImageNode(page);

    await page.getByRole('tab', { name: /^Appearance/i }).click();

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

    const controlSizes = await paletteSection.evaluate((element) => {
      const countInput = element.querySelector<HTMLInputElement>('.palette-section__count-input');
      const analyzeButton = element.querySelector<HTMLButtonElement>(
        '.palette-section__toolbar .intelligence-action-btn',
      );
      const harmonySwatch = element.querySelector<HTMLButtonElement>(
        '.palette-section__harmony-swatch',
      );
      return {
        countInputHeight: countInput?.getBoundingClientRect().height ?? 0,
        analyzeButtonHeight: analyzeButton?.getBoundingClientRect().height ?? 0,
        harmonySwatchWidth: harmonySwatch?.getBoundingClientRect().width ?? 0,
        harmonySwatchHeight: harmonySwatch?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(controlSizes.countInputHeight).toBeGreaterThanOrEqual(40);
    expect(controlSizes.analyzeButtonHeight).toBeGreaterThanOrEqual(40);
    expect(controlSizes.harmonySwatchWidth).toBeGreaterThanOrEqual(40);
    expect(controlSizes.harmonySwatchHeight).toBeGreaterThanOrEqual(40);

    const countInput = paletteSection.locator('.palette-section__count-input');
    await countInput.fill('20');
    await countInput.press('Tab');
    await expect(countInput).toHaveValue('20');
    await expect(paletteSection.getByRole('heading', { name: 'Extracted colors' })).toBeVisible({
      timeout: 15000,
    });
    const extractedCount = await paletteSection
      .getByRole('list', { name: 'Extracted colors' })
      .getByRole('listitem')
      .count();
    expect(extractedCount).toBeGreaterThan(0);
    expect(extractedCount).toBeLessThanOrEqual(20);

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

  test('palette source follows the visible crop or full image choice', async ({ page }) => {
    await navigateToEditor(page);
    await importImageFile(page);
    await selectImageNode(page);

    // Give the image a visible crop so the source toggle appears.
    await enterCropMode(page);
    await expect(page.locator('[data-testid="crop-overlay"]')).toBeVisible({ timeout: 10000 });
    const eastHandle = page.getByRole('button', { name: 'Resize crop e', exact: true });
    const box = await eastHandle.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2);
      await page.mouse.up();
    }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    await page.getByRole('tab', { name: /^Appearance/i }).click();
    const paletteSection = page.locator('.insp-disclosure').filter({ hasText: /^Palette/ });
    await expect(paletteSection).toBeVisible({ timeout: 15000 });
    const paletteTrigger = paletteSection.getByRole('button', { name: /^Palette$/ });
    if ((await paletteTrigger.getAttribute('aria-expanded')) === 'false') {
      await paletteTrigger.click();
    }

    const sourceGroup = paletteSection.getByRole('radiogroup', {
      name: /palette analysis source/i,
    });
    await expect(sourceGroup).toBeVisible({ timeout: 15000 });
    const cropRadio = sourceGroup.getByRole('radio', { name: 'Visible crop' });
    const fullRadio = sourceGroup.getByRole('radio', { name: 'Full image' });
    await expect(cropRadio).toBeChecked();

    await fullRadio.check();
    await expect(paletteSection.getByRole('heading', { name: 'Extracted colors' })).toBeVisible({
      timeout: 15000,
    });

    await cropRadio.check();
    await expect(paletteSection.getByRole('heading', { name: 'Extracted colors' })).toBeVisible({
      timeout: 15000,
    });
  });
});
