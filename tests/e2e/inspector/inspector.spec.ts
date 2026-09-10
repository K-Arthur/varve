import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('Inspector Panel - axe-core scan', () => {
  test('inspector panel empty state has no automated accessibility violations', async ({
    page,
  }) => {
    await navigateToEditor(page);

    // Inspector panel should be visible by default (not in inspect mode)
    const results = await new AxeBuilder({ page })
      .include('.editor-inspector')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('inspector panel with selected node has no automated accessibility violations', async ({
    page,
  }) => {
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
  });
});
