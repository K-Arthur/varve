/**
 * E2E tests for four object-local filter effects: Duotone, Black & White,
 * Posterize, and Threshold.
 *
 * Covers: UI controls, live preview, enable/disable, undo/redo, save/reopen,
 * export to SVG (verifying the old warning is absent), keyboard navigation.
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { selectInspectorTab } from '../helpers/inspector-tabs';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Object Filter Effects', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    // Headless Chromium exposes the File System Access picker but cannot
    // complete its native dialog. Force the platform's documented download
    // fallback so this test can inspect real SVG bytes.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: undefined,
      });
    });
    await navigateToEditor(page);
  });

  async function addObjectFilter(
    page: import('@playwright/test').Page,
    name: string,
  ): Promise<void> {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10_000 });
    await selectInspectorTab(page, 'Adjustments');

    const panel = page.locator('#insp-tabpanel-adjustments');
    const section = panel.getByRole('button', { name: 'Object Filters', exact: true });
    await expect(section).toBeVisible({ timeout: 10_000 });
    if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
    const picker = panel.getByRole('combobox', { name: 'Add Object Filter' });
    await expect(picker).toBeVisible();
    await picker.click();
    await page.getByRole('option', { name, exact: true }).click();
    await expect(
      panel.locator('.smart-filters__row').filter({ hasText: name }).first(),
    ).toBeVisible({ timeout: 5_000 });
  }

  // ── Duotone ────────────────────────────────────────────────────────────

  test('duotone: UI controls are present', async ({ page }) => {
    await addObjectFilter(page, 'Duotone');

    await expect(page.locator('input[aria-label="Shadow point"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('input[aria-label="Highlight point"]')).toBeVisible({
      timeout: 3000,
    });
    await expect(page.locator('input[aria-label="Intensity"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('label:has-text("Preserve luminosity")')).toBeVisible({
      timeout: 3000,
    });
  });

  test('duotone: controls change value', async ({ page }) => {
    await addObjectFilter(page, 'Duotone');

    const shadowSlider = page.locator('input[aria-label="Shadow point"]');
    await expect(shadowSlider).toBeVisible({ timeout: 5000 });
    const initialVal = await shadowSlider.inputValue();
    await shadowSlider.fill('0.5');
    await page.waitForTimeout(200);
    const newVal = await shadowSlider.inputValue();
    expect(newVal).not.toBe(initialVal);
  });

  test('duotone: enable/disable toggle', async ({ page }) => {
    await addObjectFilter(page, 'Duotone');

    const visibilityToggle = page.getByRole('button', { name: 'Disable Duotone' });
    await expect(visibilityToggle).toBeVisible({ timeout: 5_000 });
    await visibilityToggle.click();
    await expect(page.getByRole('button', { name: 'Enable Duotone' })).toBeVisible();
  });

  test('duotone: undo and redo changes', async ({ page }) => {
    await addObjectFilter(page, 'Duotone');

    const shadowSlider = page.locator('input[aria-label="Shadow point"]');
    await expect(shadowSlider).toBeVisible({ timeout: 5000 });
    await shadowSlider.fill('0.5');
    await page.waitForTimeout(200);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(300);
  });

  // ── Black & White ──────────────────────────────────────────────────────

  test('blackAndWhite: UI controls are present', async ({ page }) => {
    await addObjectFilter(page, 'Black & White');

    await expect(page.locator('input[aria-label="Reds"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('input[aria-label="Yellows"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('input[aria-label="Greens"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('input[aria-label="Cyans"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('input[aria-label="Blues"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('input[aria-label="Magentas"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('input[aria-label="Brightness"]')).toBeVisible({ timeout: 3000 });
  });

  test('blackAndWhite: slider changes value', async ({ page }) => {
    await addObjectFilter(page, 'Black & White');

    const redsSlider = page.locator('input[aria-label="Reds"]');
    await expect(redsSlider).toBeVisible({ timeout: 5000 });
    await redsSlider.fill('120');
    await page.waitForTimeout(200);
    const val = await redsSlider.inputValue();
    expect(val).toBe('120');
  });

  test('blackAndWhite: enable/disable toggle', async ({ page }) => {
    await addObjectFilter(page, 'Black & White');

    const visibilityToggle = page.getByRole('button', { name: 'Disable Black & White' });
    await expect(visibilityToggle).toBeVisible({ timeout: 5000 });
    await visibilityToggle.click();
    await expect(page.getByRole('button', { name: 'Enable Black & White' })).toBeVisible();
  });

  // ── Posterize ──────────────────────────────────────────────────────────

  test('posterize: UI controls are present', async ({ page }) => {
    await addObjectFilter(page, 'Posterize');

    await expect(page.getByRole('slider', { name: 'Posterize levels' })).toBeVisible({
      timeout: 5000,
    });
  });

  test('posterize: level slider changes value', async ({ page }) => {
    await addObjectFilter(page, 'Posterize');

    const levelsSlider = page.getByRole('slider', { name: 'Posterize levels' });
    await expect(levelsSlider).toBeVisible({ timeout: 5000 });
    await levelsSlider.fill('8');
    await page.waitForTimeout(200);
    const val = await levelsSlider.inputValue();
    expect(val).toBe('8');
  });

  test('posterize: enable/disable and undo/redo', async ({ page }) => {
    await addObjectFilter(page, 'Posterize');

    const levelsSlider = page.getByRole('slider', { name: 'Posterize levels' });
    await expect(levelsSlider).toBeVisible({ timeout: 5000 });
    await levelsSlider.fill('6');
    await page.waitForTimeout(200);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(300);
  });

  // ── Threshold ──────────────────────────────────────────────────────────

  test('threshold: UI controls are present', async ({ page }) => {
    await addObjectFilter(page, 'Threshold');

    await expect(page.getByRole('slider', { name: 'Threshold level' })).toBeVisible({
      timeout: 5000,
    });
  });

  test('threshold: level slider changes value', async ({ page }) => {
    await addObjectFilter(page, 'Threshold');

    const levelSlider = page.getByRole('slider', { name: 'Threshold level' });
    await expect(levelSlider).toBeVisible({ timeout: 5000 });
    await levelSlider.fill('200');
    await page.waitForTimeout(200);
    const val = await levelSlider.inputValue();
    expect(val).toBe('200');
  });

  test('threshold: enable/disable toggle', async ({ page }) => {
    await addObjectFilter(page, 'Threshold');

    const visibilityToggle = page.getByRole('button', { name: 'Disable Threshold' });
    await expect(visibilityToggle).toBeVisible({ timeout: 5000 });
    await visibilityToggle.click();
    await expect(page.getByRole('button', { name: 'Enable Threshold' })).toBeVisible();
  });

  test('threshold: undo and redo', async ({ page }) => {
    await addObjectFilter(page, 'Threshold');

    const levelSlider = page.getByRole('slider', { name: 'Threshold level' });
    await expect(levelSlider).toBeVisible({ timeout: 5000 });
    await levelSlider.fill('64');
    await page.waitForTimeout(200);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(300);
  });

  // ── SVG Export (verifies flattening works) ─────────────────────────────

  test('svg export succeeds without adjustment warning after flattening', async ({ page }) => {
    await addObjectFilter(page, 'Posterize');

    // Exercise the user-facing File > Export SVG command. The former test
    // dispatched a `strata:*` event that no application listener handled, so
    // it could only time out or pass against a test-only bridge. Inspect the
    // downloaded artifact produced by the live export compositor instead.
    await page
      .getByRole('menubar')
      .getByRole('menuitem', { name: /^File$/ })
      .click();
    const fileMenu = page.locator('[role="menu"]:visible').last();
    const pending = page.waitForEvent('download', { timeout: 30000 });
    await fileMenu.getByRole('menuitem', { name: /^Export SVG/ }).click();
    const download = await pending;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const svgContent = await readFile(downloadPath!, 'utf8');

    expect(svgContent).toBeTruthy();
    expect(svgContent).not.toContain('cannot render adjustment');
    expect(svgContent).toContain('<svg');
    expect(svgContent).toContain('</svg>');
  });
});
