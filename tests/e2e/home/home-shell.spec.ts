import { expect, test } from '@playwright/test';

test.describe('Home Shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.varve-home');
  });

  test('renders HomeShell with toolbar', async ({ page }) => {
    await expect(page.locator('.varve-home__toolbar')).toBeVisible();
    await expect(page.getByRole('button', { name: /^new$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /open/i })).toBeVisible();
  });

  test('sidebar nav renders with Recent, All Files, and Trash', async ({ page }) => {
    const sidebar = page.locator('nav[aria-label="File navigation"]');
    await expect(sidebar).toBeVisible();

    const items = sidebar.getByRole('button');
    const labels = await items.evaluateAll((els) => els.map((el) => el.textContent?.trim() ?? ''));

    expect(labels.some((l) => l.startsWith('Recent'))).toBe(true);
    expect(labels.some((l) => l.startsWith('All Files'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Trash'))).toBe(true);
  });

  test('sidebar nav items can be clicked to switch sections', async ({ page }) => {
    const trashItem = page
      .locator('nav[aria-label="File navigation"]')
      .getByRole('button', { name: /trash/i });
    await trashItem.click();
    await page.waitForTimeout(200);

    const emptyState = page.locator('.strata-empty');
    await expect(emptyState).toBeVisible();
    await expect(emptyState.locator('.strata-empty__headline')).toContainText(/trash/i);
  });

  test('empty state shows correct headline for recent section', async ({ page }) => {
    const emptyState = page.locator('.strata-empty[role="status"]');
    await expect(emptyState).toBeVisible();
    await expect(emptyState.locator('.strata-empty__headline')).toContainText(/nothing here yet/i);
  });
});
