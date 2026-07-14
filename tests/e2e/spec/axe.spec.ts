import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

function getCanvas(page: import('@playwright/test').Page) {
  return page.getByRole('img', { name: 'Design canvas' });
}

test.describe('Spec Panel - axe-core scan', () => {
  async function activateTool(page: import('@playwright/test').Page, name: string) {
    const btn = page.getByRole('button', { name });
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click();
    await page.waitForTimeout(200);
  }

  test('spec panel empty state has no automated accessibility violations', async ({ page }) => {
    await navigateToEditor(page);

    // Enter inspect mode even with no selection — panel should show empty
    await activateTool(page, 'Inspect');
    await expect(page.locator('.spec-panel')).toBeVisible({ timeout: 5000 });

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
    await activateTool(page, 'Rectangle');
    await getCanvas(page).click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);

    // Enter inspect mode
    await activateTool(page, 'Inspect');
    await getCanvas(page).click({ position: { x: 200, y: 200 } });
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
