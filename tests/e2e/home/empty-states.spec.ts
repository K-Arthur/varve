import { expect, test } from '@playwright/test';

test.describe('Home empty states', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.strata-home');
  });

  async function navigateToSection(page: import('@playwright/test').Page, label: string) {
    const item = page.locator('nav[aria-label="File navigation"] button[role="option"]', {
      hasText: label,
    });
    if (await item.isVisible()) {
      await item.click();
      await page.waitForTimeout(300);
    }
  }

  test('Recent section shows "No recent files" headline', async ({ page }) => {
    await navigateToSection(page, 'Recent');
    const empty = page.locator('.strata-empty[role="status"]');
    await expect(empty.locator('.strata-empty__headline')).toContainText(/no recent files/i);
  });

  test('All Files section shows "No files yet" headline', async ({ page }) => {
    await navigateToSection(page, 'All Files');
    const empty = page.locator('.strata-empty[role="status"]');
    await expect(empty.locator('.strata-empty__headline')).toContainText(/no files yet/i);
  });

  test('Trash section shows "Trash is empty" headline', async ({ page }) => {
    await navigateToSection(page, 'Trash');
    const empty = page.locator('.strata-empty[role="status"]');
    await expect(empty.locator('.strata-empty__headline')).toContainText(/trash is empty/i);
  });

  test('empty state shows a CTA button', async ({ page }) => {
    await navigateToSection(page, 'Trash');
    const empty = page.locator('.strata-empty[role="status"]');
    const cta = empty.locator('.strata-empty__actions button');
    await expect(cta).toBeVisible();
  });

  test('CTA button in Recent section creates a new file', async ({ page }) => {
    await navigateToSection(page, 'Recent');
    const empty = page.locator('.strata-empty[role="status"]');
    const cta = empty.locator('.strata-empty__actions button');
    await expect(cta).toBeVisible();

    await cta.click();
    await page.waitForTimeout(300);

    const dialog = page.locator('dialog.strata-dialog');
    await expect(dialog).toBeVisible();
  });

  test('search empty state shows different headline', async ({ page }) => {
    const search = page.locator('.strata-search__input');
    await search.fill('zzzznoresults');
    await page.waitForTimeout(300);

    const empty = page.locator('.strata-empty[role="status"]');
    await expect(empty).toBeVisible();
    await expect(empty.locator('.strata-empty__headline')).toContainText(/no results/i);
  });
});
