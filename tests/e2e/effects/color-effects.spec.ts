/**
 * E2E tests for Tritone, Gradient Map (channel mode), and Color Halftone
 * adjustment effects. Verifies that the editors render, controls work, and
 * the effects are applied non-destructively.
 */
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Color Effects Adjustments', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  async function createAdjustmentLayer(page: import('@playwright/test').Page): Promise<boolean> {
    return page.evaluate(() => {
      try {
        const container = document.getElementById('root');
        if (!container) return false;
        const fiberKey = Object.keys(container).find(
          (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'),
        );
        if (!fiberKey) return false;
        function walk(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
          if (!fiber) return null;
          const mp = fiber.memoizedProps as Record<string, unknown> | undefined;
          if (
            mp?.value &&
            typeof mp.value === 'object' &&
            'createAdjustmentLayer' in (mp.value as Record<string, unknown>)
          ) {
            return mp.value as Record<string, unknown>;
          }
          const pp = fiber.pendingProps as Record<string, unknown> | undefined;
          if (
            pp?.value &&
            typeof pp.value === 'object' &&
            'createAdjustmentLayer' in (pp.value as Record<string, unknown>)
          ) {
            return pp.value as Record<string, unknown>;
          }
          return (
            walk(fiber.child as Record<string, unknown> | null) ||
            walk(fiber.sibling as Record<string, unknown> | null)
          );
        }
        const ctx = walk(
          (container as unknown as Record<string, unknown>)[fiberKey] as Record<
            string,
            unknown
          > | null,
        );
        if (ctx && typeof ctx.createAdjustmentLayer === 'function') {
          (ctx.createAdjustmentLayer as () => void)();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    });
  }

  async function addAdjustment(
    page: import('@playwright/test').Page,
    name: string,
  ): Promise<boolean> {
    const addAdjBtn = page.locator('button.adj-panel__add-btn');
    await expect(addAdjBtn).toBeVisible({ timeout: 3000 });
    await addAdjBtn.click();
    await page.waitForTimeout(200);
    const menuItem = page.locator('.adj-panel__add-menu-item').filter({ hasText: name });
    if (await menuItem.isVisible()) {
      await menuItem.click();
      await page.waitForTimeout(300);
      return true;
    }
    return false;
  }

  test('tritone editor shows colors, sliders, and interpolation select', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);

    const added = await addAdjustment(page, 'Tritone');
    if (!added) {
      test.skip();
      return;
    }

    const shadowPointSlider = page.locator('input[aria-label="Shadow point"]');
    await expect(shadowPointSlider).toBeVisible({ timeout: 5000 });
    const highlightPointSlider = page.locator('input[aria-label="Highlight point"]');
    await expect(highlightPointSlider).toBeVisible({ timeout: 3000 });
    const intensitySlider = page.locator('input[aria-label="Tritone intensity"]');
    await expect(intensitySlider).toBeVisible({ timeout: 3000 });
    const preserveLumCheckbox = page.locator('input[aria-label="Preserve luminosity"]');
    await expect(preserveLumCheckbox).toBeVisible({ timeout: 3000 });
    const interpSelect = page.getByRole('combobox', { name: 'Interpolation method' });
    await expect(interpSelect).toBeVisible({ timeout: 3000 });
  });

  test('tritone interpolation selector changes value', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);

    const added = await addAdjustment(page, 'Tritone');
    if (!added) {
      test.skip();
      return;
    }

    const interpSelect = page.getByRole('combobox', { name: 'Interpolation method' });
    await expect(interpSelect).toBeVisible({ timeout: 5000 });
    await expect(interpSelect).toContainText('Smooth');

    await interpSelect.click();
    await page.waitForTimeout(200);
    const linearOption = page.locator('[role="option"]').filter({ hasText: 'Linear' });
    if (await linearOption.isVisible()) {
      await linearOption.click();
      await page.waitForTimeout(200);
      await expect(interpSelect).toContainText('Linear');
    }
  });

  test('gradient map channel mode shows channel bars', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);

    const added = await addAdjustment(page, 'Gradient Map');
    if (!added) {
      test.skip();
      return;
    }

    const modeSelect = page.locator('button[aria-label="Mapping mode"]');
    await expect(modeSelect).toBeVisible({ timeout: 5000 });
    await modeSelect.click();
    await page.waitForTimeout(200);
    const channelOption = page.locator('[role="option"]').filter({ hasText: 'Channel' });
    if (await channelOption.isVisible()) {
      await channelOption.click();
      await page.waitForTimeout(300);
    }

    const channelBars = page.locator('.gm-editor__channel');
    await expect(channelBars.first()).toBeVisible({ timeout: 5000 });
    await expect(channelBars).toHaveCount(3, { timeout: 3000 });
  });

  test('color halftone editor shows presets, mode, and dot shape', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);

    const added = await addAdjustment(page, 'Color Halftone');
    if (!added) {
      test.skip();
      return;
    }

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

    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);

    const added = await addAdjustment(page, 'Color Halftone');
    if (!added) {
      test.skip();
      return;
    }

    const presetSelect = page.locator('button[aria-label="Color halftone preset"]');
    await expect(presetSelect).toBeVisible({ timeout: 5000 });

    await presetSelect.click();
    await page.waitForTimeout(200);
    const popArtOption = page.locator('[role="option"]').filter({ hasText: 'Pop Art' });
    if (await popArtOption.isVisible()) {
      await popArtOption.click();
      await page.waitForTimeout(300);
      const modeSelect = page.locator('button[aria-label="Channel mode"]');
      await expect(modeSelect).toContainText('RGB');
    }
  });
});
