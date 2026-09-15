import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('Inspector Panel - axe-core scan', () => {
  test('inspector panel empty state has no automated accessibility violations', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);

    // Inspector panel should be visible by default (not in inspect mode)
    const results = await new AxeBuilder({ page })
      .include('.editor-inspector')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);

    const inspector = page.locator('.editor-inspector');
    for (const theme of ['light', 'dark', 'high-contrast'] as const) {
      await page.evaluate((nextTheme) => {
        document.documentElement.setAttribute('data-theme', nextTheme);
      }, theme);
      await inspector.screenshot({
        path: testInfo.outputPath(`inspector-empty-${theme}.png`),
      });
    }
  });

  test('inspector panel with selected node has no automated accessibility violations', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);

    // Create a rect
    await page.keyboard.press('r');
    const canvas = page.locator('canvas').first();
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(200);

    // Ensure inspector panel is visible
    await expect(page.locator('.editor-inspector')).toBeVisible({ timeout: 5000 });

    const results = await new AxeBuilder({ page })
      .include('.editor-inspector')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);

    const inspector = page.locator('.editor-inspector');
    for (const theme of ['light', 'dark', 'high-contrast'] as const) {
      await page.evaluate((nextTheme) => {
        document.documentElement.setAttribute('data-theme', nextTheme);
      }, theme);
      await inspector.screenshot({
        path: testInfo.outputPath(`inspector-panel-${theme}.png`),
      });
    }
  });

  test('inspector panel for frame has preset dropdown, orientation swap button, and no a11y violations', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);

    // Create a frame using 'f' shortcut
    await page.keyboard.press('f');
    const canvas = page.locator('canvas').first();
    await canvas.click({ position: { x: 300, y: 300 } });
    await page.waitForTimeout(300);

    const inspector = page.locator('.editor-inspector');
    await expect(inspector).toBeVisible({ timeout: 5000 });

    const presetTrigger = page.locator('[data-testid="frame-preset-dropdown-trigger"]');
    await expect(presetTrigger).toBeVisible({ timeout: 5000 });

    const orientationBtn = page.locator('.insp-orientation-btn');
    await expect(orientationBtn).toBeVisible({ timeout: 5000 });

    const results = await new AxeBuilder({ page })
      .include('.editor-inspector')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);

    for (const theme of ['light', 'dark', 'high-contrast'] as const) {
      await page.evaluate((nextTheme) => {
        document.documentElement.setAttribute('data-theme', nextTheme);
      }, theme);
      await inspector.screenshot({
        path: testInfo.outputPath(`inspector-frame-${theme}.png`),
      });
    }
  });
});
