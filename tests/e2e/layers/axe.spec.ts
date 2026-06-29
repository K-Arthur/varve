import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Layers Panel - axe-core scan', () => {
  test('layers panel has no automated accessibility violations', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.layers-panel');

    const results = await new AxeBuilder({ page })
      .include('.layers-panel')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
