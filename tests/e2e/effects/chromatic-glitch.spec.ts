import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

async function openEffectsSection(page: import('@playwright/test').Page) {
  await page.getByRole('tab', { name: 'Appearance' }).click();
  const effectsSection = page.locator('section.insp-disclosure').filter({ hasText: 'Effects' });
  await expect(effectsSection).toBeVisible({ timeout: 5000 });
  return effectsSection;
}

test.describe('Chromatic Aberration & Glitch Effects', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('applies chromatic aberration to a rectangle and verifies controls', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const effectsSection = await openEffectsSection(page);

    const effectTypeSelect = effectsSection.locator(
      '.varve-select__trigger[aria-label="New effect type"]',
    );
    await effectTypeSelect.click();
    await page.waitForTimeout(200);

    const caOption = page
      .locator('.varve-select__option')
      .filter({ hasText: 'Chromatic Aberration' });
    if (await caOption.isVisible()) {
      await caOption.click();
      await page.waitForTimeout(100);
    }

    const addBtn = effectsSection.locator('button.insp-add-btn');
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await page.waitForTimeout(300);
    }

    const caLabel = page.locator('text=chromaticAberration').first();
    await expect(caLabel).toBeVisible({ timeout: 5000 });

    const intensityField = page.locator('.insp-field').filter({ hasText: 'Intensity' }).first();
    await expect(intensityField).toBeVisible({ timeout: 3000 });

    const opacityField = page.locator('.insp-field').filter({ hasText: 'Opacity' }).first();
    await expect(opacityField).toBeVisible({ timeout: 3000 });
  });

  test('applies glitch effect to a rectangle and verifies controls', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const effectsSection = await openEffectsSection(page);

    const effectTypeSelect = effectsSection.locator(
      '.varve-select__trigger[aria-label="New effect type"]',
    );
    await effectTypeSelect.click();
    await page.waitForTimeout(200);

    const glitchOption = page.locator('.varve-select__option').filter({ hasText: 'Glitch' });
    if (await glitchOption.isVisible()) {
      await glitchOption.click();
      await page.waitForTimeout(100);
    }

    const addBtn = effectsSection.locator('button.insp-add-btn');
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await page.waitForTimeout(300);
    }

    const glitchLabel = page.locator('text=glitch').first();
    await expect(glitchLabel).toBeVisible({ timeout: 5000 });

    const strengthField = page.locator('.insp-field').filter({ hasText: 'Strength' }).first();
    await expect(strengthField).toBeVisible({ timeout: 3000 });

    const densityField = page.locator('.insp-field').filter({ hasText: 'Density' }).first();
    await expect(densityField).toBeVisible({ timeout: 3000 });
  });

  test('glitch advanced controls open and close', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const effectsSection = await openEffectsSection(page);

    const effectTypeSelect = effectsSection.locator(
      '.varve-select__trigger[aria-label="New effect type"]',
    );
    await effectTypeSelect.click();
    await page.waitForTimeout(200);

    const glitchOption = page.locator('.varve-select__option').filter({ hasText: 'Glitch' });
    if (await glitchOption.isVisible()) {
      await glitchOption.click();
      await page.waitForTimeout(100);
    }

    const addBtn = effectsSection.locator('button.insp-add-btn');
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await page.waitForTimeout(300);
    }

    const advancedBtn = page.getByText('Advanced...');
    if (await advancedBtn.isVisible()) {
      await advancedBtn.click();
      await page.waitForTimeout(200);

      const sliceHeightField = page.locator('text=Slice Height').first();
      await expect(sliceHeightField).toBeVisible({ timeout: 3000 });
      await expect(page.getByLabel('Block Strength')).toBeVisible();
      await expect(page.getByLabel('Channel shift mode')).toBeVisible();
      await expect(page.getByLabel('Red X')).toBeVisible();
      await expect(page.getByLabel('Green Y')).toBeVisible();
      await expect(page.getByLabel('Blue X')).toBeVisible();

      const hideAdvancedBtn = page.getByText('Hide advanced');
      await expect(hideAdvancedBtn).toBeVisible({ timeout: 2000 });
      await hideAdvancedBtn.click();
      await page.waitForTimeout(200);

      const advancedBtnAgain = page.getByText('Advanced...');
      await expect(advancedBtnAgain).toBeVisible({ timeout: 2000 });
    }
  });

  test('chromatic aberration color swatch is not shown (no color field)', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const effectsSection = await openEffectsSection(page);

    const effectTypeSelect = effectsSection.locator(
      '.varve-select__trigger[aria-label="New effect type"]',
    );
    await effectTypeSelect.click();
    await page.waitForTimeout(200);

    const caOption = page
      .locator('.varve-select__option')
      .filter({ hasText: 'Chromatic Aberration' });
    if (await caOption.isVisible()) {
      await caOption.click();
      await page.waitForTimeout(100);
    }

    const addBtn = effectsSection.locator('button.insp-add-btn');
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await page.waitForTimeout(300);
    }

    const colorSwatches = effectsSection.locator('button.insp-swatch');
    const count = await colorSwatches.count();
    expect(count).toBe(0);
  });

  test('drop shadow shows effect color swatch', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const effectsSection = await openEffectsSection(page);

    const effectTypeSelect = effectsSection.locator(
      '.varve-select__trigger[aria-label="New effect type"]',
    );
    await effectTypeSelect.click();
    await page.waitForTimeout(200);

    const shadowOption = page.locator('.varve-select__option').filter({ hasText: 'Drop Shadow' });
    if (await shadowOption.isVisible()) {
      await shadowOption.click();
      await page.waitForTimeout(100);
    }

    const addBtn = effectsSection.locator('button.insp-add-btn');
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await page.waitForTimeout(300);
    }

    const colorSwatches = effectsSection.locator('button.insp-swatch');
    await expect(colorSwatches.first()).toBeVisible({ timeout: 3000 });
  });
});
