import { expect, test } from '@playwright/test';
import { navigateToHome, sidebarNavClick, waitForOpenDialog } from '../shared';

test.describe('Home empty states', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToHome(page);
  });

  test('Recent section shows "Nothing here yet" headline', async ({ page }) => {
    await sidebarNavClick(page, 'Recent');
    const empty = page.locator('.strata-empty[role="status"]');
    await expect(empty.locator('.strata-empty__headline')).toContainText(/nothing here yet/i);
  });

  test('All Files section shows "Start with a blank slate" headline', async ({ page }) => {
    await sidebarNavClick(page, 'All Files');
    const empty = page.locator('.strata-empty[role="status"]');
    await expect(empty.locator('.strata-empty__headline')).toContainText(
      /start with a blank slate/i,
    );
  });

  test('Trash section shows "Trash is empty" headline', async ({ page }) => {
    await sidebarNavClick(page, 'Trash');
    const empty = page.locator('.strata-empty[role="status"]');
    await expect(empty.locator('.strata-empty__headline')).toContainText(/trash is empty/i);
  });

  test('empty state shows a CTA button', async ({ page }) => {
    await sidebarNavClick(page, 'Trash');
    const empty = page.locator('.strata-empty[role="status"]');
    const cta = empty.locator('.strata-empty__actions button');
    await expect(cta).toBeVisible();
  });

  test('CTA button in Recent section creates a new file', async ({ page }) => {
    await sidebarNavClick(page, 'Recent');
    const empty = page.locator('.strata-empty[role="status"]');
    const cta = empty.locator('.strata-empty__actions button');
    await expect(cta).toBeVisible();

    await cta.click();
    await page.waitForTimeout(150);

    const dialog = page.locator('dialog.strata-dialog[open]');
    await expect(dialog).toBeVisible();
  });

  test('search empty state shows different headline', async ({ page }) => {
    const search = page.locator('.strata-search__input');
    await search.fill('zzzznoresults');
    await page.waitForTimeout(150);

    const empty = page.locator('.strata-empty[role="status"]');
    await expect(empty).toBeVisible();
    await expect(empty.locator('.strata-empty__headline')).toContainText(/no results/i);
  });
});
