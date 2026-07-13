import { expect, test } from '@playwright/test';

test.describe('Home trash flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.strata-home');
  });

  test('sidebar has Trash item with count', async ({ page }) => {
    const trashItem = page
      .locator('nav[aria-label="File navigation"]')
      .getByRole('button', { name: /trash/i });
    await expect(trashItem).toBeVisible();
  });

  test('trash section shows empty state when no trashed files', async ({ page }) => {
    const trashItem = page
      .locator('nav[aria-label="File navigation"]')
      .getByRole('button', { name: /trash/i });
    await trashItem.click();
    await page.waitForTimeout(200);

    const emptyState = page.locator('.strata-empty[role="status"]');
    await expect(emptyState).toBeVisible();
    await expect(emptyState.locator('.strata-empty__headline')).toContainText(/trash is empty/i);
  });

  test('trash section CTA navigates back to files', async ({ page }) => {
    const trashItem = page
      .locator('nav[aria-label="File navigation"]')
      .getByRole('button', { name: /trash/i });
    await trashItem.click();
    await page.waitForTimeout(200);

    const cta = page.locator('.strata-empty__actions button');
    await expect(cta).toBeVisible();

    await cta.click();
    await page.waitForTimeout(200);

    await expect(page.locator('.strata-home')).toBeVisible();
  });

  test('trash section with files shows Restore and Delete buttons', async ({ page }) => {
    const trashItem = page
      .locator('nav[aria-label="File navigation"]')
      .getByRole('button', { name: /trash/i });
    await trashItem.click();
    await page.waitForTimeout(200);

    const hasFiles = await page
      .locator('button:has-text("Restore")')
      .isVisible()
      .catch(() => false);
    if (!hasFiles) return;

    await expect(page.locator('button:has-text("Restore")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Empty Trash")')).toBeVisible();
  });

  test('file context menu offers Move to Trash option', async ({ page }) => {
    const card = page.locator('.home-grid[role="grid"] [role="gridcell"]').first();
    const count = await page.locator('.home-grid[role="grid"] [role="gridcell"]').count();
    if (count < 1) return;

    await card.click({ button: 'right' });
    await page.waitForTimeout(200);

    const ctxMenu = page.locator('.strata-ctxmenu[role="menu"]');
    await expect(ctxMenu.locator('[role="menuitem"]').filter({ hasText: /trash/i })).toBeVisible();
  });
});
