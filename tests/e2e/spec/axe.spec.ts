import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForSelector('button:has-text("New File")', { timeout: 10000 });
  await page.getByRole('button', { name: /new file/i }).click();
  await page.waitForSelector('button:has-text("Create")', { timeout: 5000 });
  await page.getByRole('button', { name: /^create$/i }).click();
  await page.waitForSelector('.layers-panel', { timeout: 10000 });
}

test.describe('Spec Panel - axe-core scan', () => {
  test('spec panel empty state has no automated accessibility violations', async ({ page }) => {
    await navigateToEditor(page);

    // Enter inspect mode even with no selection — panel should show empty
    await page.keyboard.press('i');

    const results = await new AxeBuilder({ page })
      .include('.spec-panel')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('spec panel with selected node has no automated accessibility violations', async ({
    page,
  }) => {
    await navigateToEditor(page);

    // Create a rect
    await page.keyboard.press('r');
    const canvas = page.locator('canvas').first();
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(200);

    // Enter inspect mode
    await page.keyboard.press('i');
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(300);

    // Ensure spec panel is visible
    await expect(page.locator('.spec-panel')).toBeVisible({ timeout: 5000 });

    const results = await new AxeBuilder({ page })
      .include('.spec-panel')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
