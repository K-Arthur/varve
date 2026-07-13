import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { navigateToHome } from '../shared';

test.describe('Home - axe-core scan', () => {
  test('HomeShell main view has no automated accessibility violations', async ({ page }) => {
    await navigateToHome(page);

    const results = await new AxeBuilder({ page })
      .include('.strata-home')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('sidebar navigation has no automated accessibility violations', async ({ page }) => {
    await navigateToHome(page);

    const results = await new AxeBuilder({ page })
      .include('nav[aria-label="File navigation"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('New File dialog has no automated accessibility violations', async ({ page }) => {
    await navigateToHome(page);
    await page.getByRole('button', { name: /^new$/i }).click();
    await page.waitForSelector('dialog[open]');

    const results = await new AxeBuilder({ page })
      .include('dialog[open]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('Trash section has no automated accessibility violations', async ({ page }) => {
    await navigateToHome(page);

    const trashItem = page
      .locator('nav[aria-label="File navigation"]')
      .getByRole('button', { name: /trash/i });
    await trashItem.click();
    await page.waitForTimeout(200);

    const results = await new AxeBuilder({ page })
      .include('.strata-home__content')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
