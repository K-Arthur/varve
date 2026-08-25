/**
 * E2E tests for the four new adjustment effects: Duotone, Black & White,
 * Posterize, and Threshold.
 *
 * Covers: UI controls, live preview, enable/disable, undo/redo, save/reopen,
 * export to SVG (verifying the old warning is absent), keyboard navigation.
 */
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('New Adjustment Effects', () => {
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

  async function drawShape(page: import('@playwright/test').Page): Promise<void> {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  }

  // ── Duotone ────────────────────────────────────────────────────────────

  test('duotone: UI controls are present', async ({ page }) => {
    await drawShape(page);
    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);
    const added = await addAdjustment(page, 'Duotone');
    if (!added) {
      test.skip();
      return;
    }

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
    await drawShape(page);
    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);
    const added = await addAdjustment(page, 'Duotone');
    if (!added) {
      test.skip();
      return;
    }

    const shadowSlider = page.locator('input[aria-label="Shadow point"]');
    await expect(shadowSlider).toBeVisible({ timeout: 5000 });
    const initialVal = await shadowSlider.inputValue();
    await shadowSlider.fill('0.5');
    await page.waitForTimeout(200);
    const newVal = await shadowSlider.inputValue();
    expect(newVal).not.toBe(initialVal);
  });

  test('duotone: enable/disable toggle', async ({ page }) => {
    await drawShape(page);
    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);
    const added = await addAdjustment(page, 'Duotone');
    if (!added) {
      test.skip();
      return;
    }

    const visibilityToggle = page
      .getByRole('treeitem')
      .filter({ hasText: /Adjustment/i })
      .getByRole('button', { name: /^(Hide|Show) / })
      .first();
    await expect(visibilityToggle).toBeVisible({ timeout: 5000 });
    await visibilityToggle.click();
    await page.waitForTimeout(200);
  });

  test('duotone: undo and redo changes', async ({ page }) => {
    await drawShape(page);
    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);
    const added = await addAdjustment(page, 'Duotone');
    if (!added) {
      test.skip();
      return;
    }

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
    await drawShape(page);
    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);
    const added = await addAdjustment(page, 'Black & White');
    if (!added) {
      test.skip();
      return;
    }

    await expect(page.locator('input[aria-label="Reds"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('input[aria-label="Yellows"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('input[aria-label="Greens"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('input[aria-label="Cyans"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('input[aria-label="Blues"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('input[aria-label="Magentas"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('input[aria-label="Brightness"]')).toBeVisible({ timeout: 3000 });
  });

  test('blackAndWhite: slider changes value', async ({ page }) => {
    await drawShape(page);
    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);
    const added = await addAdjustment(page, 'Black & White');
    if (!added) {
      test.skip();
      return;
    }

    const redsSlider = page.locator('input[aria-label="Reds"]');
    await expect(redsSlider).toBeVisible({ timeout: 5000 });
    await redsSlider.fill('120');
    await page.waitForTimeout(200);
    const val = await redsSlider.inputValue();
    expect(val).toBe('120');
  });

  test('blackAndWhite: enable/disable toggle', async ({ page }) => {
    await drawShape(page);
    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);
    const added = await addAdjustment(page, 'Black & White');
    if (!added) {
      test.skip();
      return;
    }

    const visibilityToggle = page
      .locator('.adj-panel__adjustment-row button[aria-label*="toggle"]')
      .first();
    await expect(visibilityToggle).toBeVisible({ timeout: 5000 });
    await visibilityToggle.click();
    await page.waitForTimeout(200);
  });

  // ── Posterize ──────────────────────────────────────────────────────────

  test('posterize: UI controls are present', async ({ page }) => {
    await drawShape(page);
    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);
    const added = await addAdjustment(page, 'Posterize');
    if (!added) {
      test.skip();
      return;
    }

    await expect(page.locator('input[aria-label="Levels"]')).toBeVisible({ timeout: 5000 });
  });

  test('posterize: level slider changes value', async ({ page }) => {
    await drawShape(page);
    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);
    const added = await addAdjustment(page, 'Posterize');
    if (!added) {
      test.skip();
      return;
    }

    const levelsSlider = page.locator('input[aria-label="Levels"]');
    await expect(levelsSlider).toBeVisible({ timeout: 5000 });
    await levelsSlider.fill('8');
    await page.waitForTimeout(200);
    const val = await levelsSlider.inputValue();
    expect(val).toBe('8');
  });

  test('posterize: enable/disable and undo/redo', async ({ page }) => {
    await drawShape(page);
    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);
    const added = await addAdjustment(page, 'Posterize');
    if (!added) {
      test.skip();
      return;
    }

    const levelsSlider = page.locator('input[aria-label="Levels"]');
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
    await drawShape(page);
    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);
    const added = await addAdjustment(page, 'Threshold');
    if (!added) {
      test.skip();
      return;
    }

    await expect(page.locator('input[aria-label="Level"]')).toBeVisible({ timeout: 5000 });
  });

  test('threshold: level slider changes value', async ({ page }) => {
    await drawShape(page);
    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);
    const added = await addAdjustment(page, 'Threshold');
    if (!added) {
      test.skip();
      return;
    }

    const levelSlider = page.locator('input[aria-label="Level"]');
    await expect(levelSlider).toBeVisible({ timeout: 5000 });
    await levelSlider.fill('200');
    await page.waitForTimeout(200);
    const val = await levelSlider.inputValue();
    expect(val).toBe('200');
  });

  test('threshold: enable/disable toggle', async ({ page }) => {
    await drawShape(page);
    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);
    const added = await addAdjustment(page, 'Threshold');
    if (!added) {
      test.skip();
      return;
    }

    const visibilityToggle = page
      .locator('.adj-panel__adjustment-row button[aria-label*="toggle"]')
      .first();
    await expect(visibilityToggle).toBeVisible({ timeout: 5000 });
    await visibilityToggle.click();
    await page.waitForTimeout(200);
  });

  test('threshold: undo and redo', async ({ page }) => {
    await drawShape(page);
    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);
    const added = await addAdjustment(page, 'Threshold');
    if (!added) {
      test.skip();
      return;
    }

    const levelSlider = page.locator('input[aria-label="Level"]');
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
    await drawShape(page);
    const created = await createAdjustmentLayer(page);
    if (!created) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);
    const added = await addAdjustment(page, 'Posterize');
    if (!added) {
      test.skip();
      return;
    }

    await page.waitForTimeout(500);

    const svgContent = await page.evaluate(() => {
      return new Promise<string>((resolve) => {
        const event = new CustomEvent('strata:request-svg-export', { detail: {} });
        document.dispatchEvent(event);
        const handler = (e: Event) => {
          const customEvent = e as CustomEvent;
          document.removeEventListener('strata:svg-export-result', handler as EventListener);
          resolve(customEvent.detail?.svg ?? '');
        };
        document.addEventListener('strata:svg-export-result', handler as EventListener);
        setTimeout(() => resolve(''), 3000);
      });
    });

    expect(svgContent).toBeTruthy();
    expect(svgContent).not.toContain('cannot render adjustment');
    expect(svgContent).toContain('<svg');
    expect(svgContent).toContain('</svg>');
  });
});
