import { expect, test } from '@playwright/test';

test.describe('Create File dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.strata-home');
  });

  test('clicking New File opens dialog', async ({ page }) => {
    await page.getByRole('button', { name: /^new$/i }).click();
    const dialog = page.locator('dialog.strata-dialog[open]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.strata-dialog__title')).toContainText(/new file/i);
  });

  test('presets tab shows preset options', async ({ page }) => {
    await page.getByRole('button', { name: /^new$/i }).click();
    const dialog = page.locator('dialog.strata-dialog[open]');
    await expect(dialog).toBeVisible();

    await expect(dialog.getByText('Presets')).toBeVisible();
    await expect(dialog.getByText('Blank')).toBeVisible();
    await expect(dialog.getByText('Web')).toBeVisible();
  });

  test('templates tab shows templates', async ({ page }) => {
    await page.getByRole('button', { name: /^new$/i }).click();
    const dialog = page.locator('dialog.strata-dialog[open]');
    await expect(dialog).toBeVisible();

    await dialog.getByText('Templates').click();
    await page.waitForTimeout(200);

    await expect(dialog.locator('.templates-gallery')).toBeVisible();
    await expect(dialog.locator('.template-card')).toHaveCount(
      await dialog.locator('.template-card').count(),
    );
  });

  test('clicking Create navigates to editor', async ({ page }) => {
    await page.getByRole('button', { name: /^new$/i }).click();
    await page.waitForSelector('dialog.strata-dialog[open]');

    await page.getByRole('button', { name: /^create$/i }).click();
    await page.waitForSelector('.layers-panel', { timeout: 10000 });

    await expect(page.locator('.layers-panel')).toBeVisible();
  });
});
