import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /new file/i }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /new file/i }).click();
  await page
    .locator('dialog')
    .getByRole('button', { name: /^create$/i })
    .waitFor({ timeout: 5000 });
  await page
    .locator('dialog')
    .getByRole('button', { name: /^create$/i })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 10000 });
}

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
