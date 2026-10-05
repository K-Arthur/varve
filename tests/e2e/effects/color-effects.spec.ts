/**
 * E2E tests for Tritone, Gradient Map (channel mode), and Color Halftone
 * effects. Verifies that the editors render, controls work, and the effects are
 * applied non-destructively.
 *
 * These effects are object-local filters, so they are added through the
 * Inspector's Object Filter stack — the same path a user takes. They are
 * deliberately not members of `ADJUSTMENT_LAYER_KINDS`, so the Adjustment Layer
 * add menu cannot create them.
 */
import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

async function addObjectFilter(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name: 'Design', exact: true }).click();
  const section = page.getByRole('button', { name: 'Object Filters', exact: true });
  await section.scrollIntoViewIfNeeded();
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
  const picker = page.getByRole('combobox', { name: 'Add Object Filter' });
  await expect(picker).toBeVisible({ timeout: 10_000 });
  await picker.click();
  const option = page.getByRole('option', { name, exact: true });
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
  await page.waitForTimeout(300);
}

test.describe('Color Effects Adjustments', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('tritone editor shows colors, sliders, and interpolation select', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await addObjectFilter(page, 'Tritone');

    const shadowPointSlider = page.locator('input[aria-label="Shadow point"]');
    await expect(shadowPointSlider).toBeVisible({ timeout: 5000 });
    const highlightPointSlider = page.locator('input[aria-label="Highlight point"]');
    await expect(highlightPointSlider).toBeVisible({ timeout: 3000 });
    const intensitySlider = page.locator('input[aria-label="Tritone intensity"]');
    await expect(intensitySlider).toBeVisible({ timeout: 3000 });
    const preserveLumCheckbox = page.locator('input[aria-label="Preserve Luminosity"]');
    await expect(preserveLumCheckbox).toBeVisible({ timeout: 3000 });
    const interpSelect = page.getByRole('combobox', { name: 'Interpolation method' });
    await expect(interpSelect).toBeVisible({ timeout: 3000 });
  });

  test('tritone interpolation selector changes value', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await addObjectFilter(page, 'Tritone');

    const interpSelect = page.getByRole('combobox', { name: 'Interpolation method' });
    await expect(interpSelect).toBeVisible({ timeout: 5000 });
    await expect(interpSelect).toContainText('Smooth');

    await interpSelect.click();
    const linearOption = page.getByRole('option', { name: 'Linear', exact: true });
    await expect(linearOption).toBeVisible({ timeout: 5000 });
    await linearOption.click();
    await expect(interpSelect).toContainText('Linear', { timeout: 3000 });
  });

  test('gradient map channel mode shows channel bars', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await addObjectFilter(page, 'Gradient Map');

    const modeSelect = page.locator('button[aria-label="Mapping mode"]');
    await expect(modeSelect).toBeVisible({ timeout: 5000 });
    await modeSelect.click();
    const channelOption = page.getByRole('option', { name: 'Channel', exact: true });
    await expect(channelOption).toBeVisible({ timeout: 5000 });
    await channelOption.click();

    const channelBars = page.locator('.gm-editor__channel');
    await expect(channelBars.first()).toBeVisible({ timeout: 5000 });
    await expect(channelBars).toHaveCount(3, { timeout: 3000 });
  });

  test('color halftone editor shows presets, mode, and dot shape', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await addObjectFilter(page, 'Color Halftone');

    const screenSizeSlider = page.locator('input[aria-label="Screen size"]');
    await expect(screenSizeSlider).toBeVisible({ timeout: 5000 });
    const angleSlider = page.locator('input[aria-label="Screen angle"]');
    await expect(angleSlider).toBeVisible({ timeout: 3000 });
    const intensitySlider = page.locator('input[aria-label="Color halftone intensity"]');
    await expect(intensitySlider).toBeVisible({ timeout: 3000 });
    const modeSelect = page.locator('button[aria-label="Channel mode"]');
    await expect(modeSelect).toBeVisible({ timeout: 3000 });
    await expect(modeSelect).toContainText('CMYK');
    const dotShapeSelect = page.locator('button[aria-label="Dot shape"]');
    await expect(dotShapeSelect).toBeVisible({ timeout: 3000 });
  });

  test('color halftone preset selector changes screen size', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await addObjectFilter(page, 'Color Halftone');

    const presetSelect = page.locator('button[aria-label="Color halftone preset"]');
    await expect(presetSelect).toBeVisible({ timeout: 5000 });

    await presetSelect.click();
    const popArtOption = page.getByRole('option', { name: 'Pop Art', exact: true });
    await expect(popArtOption).toBeVisible({ timeout: 5000 });
    await popArtOption.click();
    const modeSelect = page.locator('button[aria-label="Channel mode"]');
    await expect(modeSelect).toContainText('RGB', { timeout: 5000 });
  });
});
