import { expect, test } from '@playwright/test';

const TEST_PAGE = 'http://localhost:1420/e2e.html';

test.describe('Create file', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('New File dialog opens on button click', async ({ page }) => {
    await page.getByRole('button', { name: /new file/i }).click();
    await page.waitForTimeout(500);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3000 });
  });

  test('dialog shows presets tab by default', async ({ page }) => {
    await page.getByRole('button', { name: /new file/i }).click();
    await page.waitForTimeout(500);
    await expect(page.getByText('Presets')).toBeVisible();
  });
});
