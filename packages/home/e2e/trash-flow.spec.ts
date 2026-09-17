import { expect, test } from '@playwright/test';

const TEST_PAGE = 'http://localhost:1420/e2e.html';

test.describe('Trash lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('trash section accessible from sidebar', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'File navigation' });
    const trashBtn = nav.getByRole('button', { name: /trash/i });
    await trashBtn.click();
    await page.waitForTimeout(300);
    // Trash section renders (may show empty state)
    await expect(page.getByText(/trash/i).first()).toBeVisible();
  });

  test('trashing a file via context menu moves it to trash', async ({ page }) => {
    // Right-click first file card
    const grid = page.getByRole('grid', { name: 'File grid' });
    const card = grid.getByRole('gridcell').first();
    const label = (await card.getAttribute('aria-label')) ?? '';
    const fileName = label.split(',')[0]?.trim() ?? '';
    expect(fileName).not.toBe('');
    await card.click({ button: 'right' });
    await page.waitForTimeout(300);

    // Click Move to Trash
    const trashAction = page.getByText('Move to Trash').first();
    await expect(trashAction).toBeVisible();
    await trashAction.click();
    await page.waitForTimeout(300);

    // Navigate to trash: the file moved there (real state assertion, not just
    // "a restore button exists").
    const nav = page.getByRole('navigation', { name: 'File navigation' });
    await nav.getByRole('button', { name: /trash/i }).click();
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: /restore/i }).first()).toBeVisible();
    await expect(page.getByText(fileName).first()).toBeVisible();
  });
});
