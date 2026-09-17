import { expect, test } from '@playwright/test';

const TEST_PAGE = 'http://localhost:1420/e2e.html';

test.describe('Selection behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('shift-click multi-select does not select card text', async ({ page }) => {
    const cards = page.locator('.file-card');
    await cards.first().click();
    await page.keyboard.down('Shift');
    await cards.nth(2).click();
    await page.keyboard.up('Shift');
    await expect(page.getByRole('toolbar', { name: 'Batch file actions' })).toBeVisible();
    await expect(page.getByText('3 selected')).toBeVisible();
    const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    expect(selectedText).toBe('');
  });

  test('Escape clears the selection when no overlay is open', async ({ page }) => {
    const cards = page.locator('.file-card');
    await cards.first().click();
    await page.keyboard.down('Shift');
    await cards.nth(1).click();
    await page.keyboard.up('Shift');
    await expect(page.getByText('2 selected')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('toolbar', { name: 'Batch file actions' })).toHaveCount(0);
    await expect(cards.first()).toHaveAttribute('aria-selected', 'false');
  });

  test('Escape closes the context menu without clearing the selection', async ({ page }) => {
    const cards = page.locator('.file-card');
    await cards.first().click();
    await page.keyboard.down('Shift');
    await cards.nth(1).click();
    await page.keyboard.up('Shift');
    await cards.first().click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    // The selection survives closing the menu (Escape hierarchy).
    await expect(page.getByText('2 selected')).toBeVisible();
  });

  test('favorite star meets the 24px minimum target size', async ({ page }) => {
    const star = page.locator('.file-card__fav').first();
    await expect(star).toBeVisible();
    const box = await star.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
  });
});

test.describe('Search palette default suggestions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('empty query shows recent files and opens one', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: /search files/i })).toBeVisible();
    await expect(page.getByText('Recent files')).toBeVisible();
    const options = page.getByRole('option');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(3);

    const first = options.first();
    const name = (await first.locator('.search-palette__result-name').textContent())?.trim();
    expect(name).toBeTruthy();
    await first.click();
    const opened = await page.evaluate(
      () =>
        (window as unknown as Record<string, unknown>).__TEST_LAST_OPENED__ as { name?: string },
    );
    expect(opened?.name).toBe(name);
  });
});
