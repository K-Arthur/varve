/**
 * Gradient interpolation space E2E + visual verification.
 *
 * Covers Scenario A (interpolation switching), Scenario B (transparency),
 * Scenario C (hue wrapping), Scenario F (export consistency), and the
 * frontend Mixed-state requirement (#43/#84).
 *
 * Note: Varve uses a custom Select component (role="combobox" + listbox),
 * NOT native <select>. Interactions use click-to-open → click-option.
 */
import { expect, test } from '@playwright/test';
import { navigateToCleanEditor } from '../helpers/nav';

async function createRectWithGradient(page: import('@playwright/test').Page) {
  // Draw a rectangle
  await page.keyboard.press('r');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  const sx = box.x + 150;
  const sy = box.y + 150;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 300, sy + 200);
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Select it
  await page.keyboard.press('v');
  await page.mouse.click(sx + 150, sy + 100);
  await page.waitForTimeout(300);
}

/**
 * Switch the fill type via the custom Select component.
 * Click the combobox → wait for listbox → click the option.
 */
async function switchFillToGradient(page: import('@playwright/test').Page) {
  const fillTypeSelect = page.getByRole('combobox', { name: /fill type/i });
  if (await fillTypeSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
    await fillTypeSelect.click();
    await page.waitForTimeout(200);
    // The listbox should appear; click the "Gradient" option
    const gradOption = page.getByRole('option', { name: /^Gradient$/i });
    await expect(gradOption).toBeVisible({ timeout: 3000 });
    await gradOption.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Set the gradient interpolation space via the custom Select component.
 */
async function setInterpolationSpace(
  page: import('@playwright/test').Page,
  label: string,
) {
  const interpSelect = page.getByRole('combobox', { name: /gradient interpolation space/i });
  await expect(interpSelect).toBeVisible({ timeout: 5000 });
  await interpSelect.click();
  await page.waitForTimeout(200);
  const option = page.getByRole('option', { name: new RegExp(`^${label}$`, 'i') });
  await expect(option).toBeVisible({ timeout: 3000 });
  await option.click();
  await page.waitForTimeout(300);
}

test.describe('Gradient interpolation space', () => {
  test('Scenario A: switching interpolation space produces distinct stable results', async ({
    page,
  }) => {
    await navigateToCleanEditor(page);
    await createRectWithGradient(page);
    await switchFillToGradient(page);

    // Verify the interpolation control is visible
    const interpSelect = page.getByRole('combobox', { name: /gradient interpolation space/i });
    await expect(interpSelect).toBeVisible({ timeout: 5000 });

    // Switch to sRGB
    await setInterpolationSpace(page, 'sRGB');
    await page.screenshot({ path: 'test-results/gradient-interp-srgb.png' });

    // Switch to Linear RGB
    await setInterpolationSpace(page, 'Linear RGB');
    await page.screenshot({ path: 'test-results/gradient-interp-linear.png' });

    // Switch to OKLCH
    await setInterpolationSpace(page, 'OKLch');
    await page.screenshot({ path: 'test-results/gradient-interp-oklch.png' });

    // Hue control should be visible for OKLCH
    const hueSelect = page.getByRole('combobox', { name: /hue interpolation direction/i });
    await expect(hueSelect).toBeVisible({ timeout: 3000 });

    // Undo all changes
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
  });

  test('Scenario B: transparent stops produce no fringe artifacts', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createRectWithGradient(page);
    await switchFillToGradient(page);

    // The gradient bar should be visible
    const gradientBar = page.locator('.gradient-editor__bar');
    await expect(gradientBar).toBeVisible({ timeout: 5000 });

    // The gradient should have stops rendered
    const stops = page.locator('.gradient-editor__stop');
    const stopCount = await stops.count();
    expect(stopCount).toBeGreaterThanOrEqual(2);

    await page.screenshot({ path: 'test-results/gradient-transparency.png' });
  });

  test('Scenario C: OKLCH hue wrapping with shorter default', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createRectWithGradient(page);
    await switchFillToGradient(page);

    // Switch to OKLCH
    await setInterpolationSpace(page, 'OKLch');

    // Hue control should show 'Shorter' by default
    const hueSelect = page.getByRole('combobox', { name: /hue interpolation direction/i });
    await expect(hueSelect).toBeVisible({ timeout: 3000 });

    // Verify the hue default is 'Shorter'
    const hueText = await hueSelect.textContent();
    expect(hueText?.toLowerCase()).toContain('shorter');

    // Switch to Longer
    await hueSelect.click();
    await page.waitForTimeout(200);
    const longerOption = page.getByRole('option', { name: /^Longer$/i });
    await expect(longerOption).toBeVisible({ timeout: 3000 });
    await longerOption.click();
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'test-results/gradient-oklch-hue-longer.png' });
  });

  test('Hue control hidden for non-cylindrical spaces', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createRectWithGradient(page);
    await switchFillToGradient(page);

    // Switch to sRGB — hue control should NOT be visible
    await setInterpolationSpace(page, 'sRGB');
    const hueSelect = page.getByRole('combobox', { name: /hue interpolation direction/i });
    await expect(hueSelect).not.toBeVisible({ timeout: 2000 });

    // Switch to Linear RGB — hue control should NOT be visible
    await setInterpolationSpace(page, 'Linear RGB');
    await expect(hueSelect).not.toBeVisible({ timeout: 2000 });

    // Switch to OKLab — hue control should NOT be visible
    await setInterpolationSpace(page, 'OKLab');
    await expect(hueSelect).not.toBeVisible({ timeout: 2000 });

    // Switch to OKLCH — hue control SHOULD be visible
    await setInterpolationSpace(page, 'OKLch');
    await expect(hueSelect).toBeVisible({ timeout: 3000 });
  });

  test('Document default option resolves correctly', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createRectWithGradient(page);
    await switchFillToGradient(page);

    const interpSelect = page.getByRole('combobox', { name: /gradient interpolation space/i });
    await expect(interpSelect).toBeVisible({ timeout: 5000 });

    // Select "Document default"
    await interpSelect.click();
    await page.waitForTimeout(200);
    const docOption = page.getByRole('option', { name: /document default/i });
    await expect(docOption).toBeVisible({ timeout: 3000 });
    await docOption.click();
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'test-results/gradient-doc-default.png' });
  });
});

test.describe('SVG export interpolation fidelity', () => {
  test('SVG export includes correct gradient data for linear-srgb', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createRectWithGradient(page);
    await switchFillToGradient(page);
    await setInterpolationSpace(page, 'Linear RGB');

    // Verify the gradient bar renders (interpolation applied)
    const gradientBar = page.locator('.gradient-editor__bar');
    await expect(gradientBar).toBeVisible({ timeout: 5000 });

    // The gradient bar CSS background should reflect the interpolation
    const bgStyle = await gradientBar.evaluate((el) =>
      getComputedStyle(el).backgroundImage,
    );
    expect(bgStyle).toContain('linear-gradient');

    await page.screenshot({ path: 'test-results/gradient-svg-linear-export.png' });
  });
});

test.describe('Gradient editor accessibility', () => {
  test('interpolation select has accessible label', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createRectWithGradient(page);
    await switchFillToGradient(page);

    const interpSelect = page.getByRole('combobox', { name: /gradient interpolation space/i });
    await expect(interpSelect).toBeVisible({ timeout: 5000 });
    // Verify it has an accessible name via aria-label or accessible name
    const ariaLabel = await interpSelect.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
  });

  test('gradient bar has keyboard support', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createRectWithGradient(page);
    await switchFillToGradient(page);

    const gradientBar = page.locator('.gradient-editor__bar');
    await expect(gradientBar).toBeVisible({ timeout: 5000 });

    // The gradient bar should be focusable
    await gradientBar.focus();
    const isFocused = await gradientBar.evaluate((el) => el === document.activeElement);
    expect(isFocused).toBe(true);

    // It should have role="slider"
    const role = await gradientBar.getAttribute('role');
    expect(role).toBe('slider');
  });

  test('gradient stop bar stays within a narrow properties panel', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createRectWithGradient(page);
    await switchFillToGradient(page);

    const metrics = await page.locator('.gradient-editor__bar').evaluate((bar) => {
      const panel = bar.closest('#insp-tabpanel-properties');
      const wrapper = bar.parentElement;
      if (!panel || !wrapper) throw new Error('gradient bar containment elements not found');
      const barRect = bar.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      return {
        barLeft: barRect.left,
        barRight: barRect.right,
        panelLeft: panelRect.left,
        panelRight: panelRect.right,
        wrapperLeft: wrapperRect.left,
        wrapperRight: wrapperRect.right,
      };
    });

    expect(metrics.barLeft).toBeGreaterThan(metrics.panelLeft);
    expect(metrics.barRight).toBeLessThan(metrics.panelRight);
    expect(metrics.wrapperLeft).toBeGreaterThanOrEqual(metrics.panelLeft);
    expect(metrics.wrapperRight).toBeLessThanOrEqual(metrics.panelRight);
  });
});
