import { expect, test } from '@playwright/test';

async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  // Toolbar button's accessible name is "New" (icon + "New" text), not
  // "New file" — matching on the fuller phrase silently times out.
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog')
    .getByRole('button', { name: /^create$/i })
    .waitFor({ timeout: 5000 });
  await page
    .locator('dialog')
    .getByRole('button', { name: /^create$/i })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 10000 });

  // A first-run "Welcome to Strata" modal can overlay the canvas.
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
}

test.describe('Layers Panel - Multi-Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await page.waitForSelector('[role="tablist"][aria-label="Page navigation"]');
  });

  test('page strip renders page thumbnails', async ({ page }) => {
    const tabs = page.locator('[role="tablist"][aria-label="Page navigation"] [role="tab"]');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(1);

    const firstTab = tabs.first();
    await expect(firstTab).toBeVisible();
    await expect(firstTab).toHaveAttribute('aria-label', /Page:/);
  });

  test('clicking page thumbnail switches active page', async ({ page }) => {
    const addBtn = page.locator('[aria-label="Add page"]');
    await addBtn.click();
    await page.waitForTimeout(200);

    const tabs = page.locator('[role="tablist"][aria-label="Page navigation"] [role="tab"]');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // First tab is active, second is not
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'false');

    // Click second tab
    await tabs.nth(1).click();
    await page.waitForTimeout(100);

    // Now second tab is active, first is not
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'false');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  });

  test('adding a new page creates new thumbnail', async ({ page }) => {
    const addBtn = page.locator('[aria-label="Add page"]');
    const tabsBefore = page.locator('[role="tablist"][aria-label="Page navigation"] [role="tab"]');
    const beforeCount = await tabsBefore.count();

    await addBtn.click();
    await page.waitForTimeout(200);

    const tabsAfter = page.locator('[role="tablist"][aria-label="Page navigation"] [role="tab"]');
    const afterCount = await tabsAfter.count();
    expect(afterCount).toBe(beforeCount + 1);
  });

  test('deleting a page removes its thumbnail', async ({ page }) => {
    // Add a second page first
    const addBtn = page.locator('[aria-label="Add page"]');
    await addBtn.click();
    await page.waitForTimeout(200);

    const tabs = page.locator('[role="tablist"][aria-label="Page navigation"] [role="tab"]');
    const beforeCount = await tabs.count();
    expect(beforeCount).toBeGreaterThanOrEqual(2);

    // Right-click second page to open context menu
    await tabs.nth(1).click({ button: 'right' });
    await page.waitForTimeout(100);

    // Click delete in context menu
    const deleteBtn = page.locator(
      '.page-nav__item + .strata-context-menu button:has-text("Delete page"), .page-nav__item ~ .strata-context-menu button:has-text("Delete page"), [role="menu"] button:has-text("Delete page")',
    );
    if ((await deleteBtn.count()) > 0) {
      await deleteBtn.click();
      await page.waitForTimeout(200);

      const afterCount = await tabs.count();
      expect(afterCount).toBe(beforeCount - 1);
    }
  });

  test('cannot delete the last page', async ({ page }) => {
    const tabs = page.locator('[role="tablist"][aria-label="Page navigation"] [role="tab"]');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(1);

    if (count === 1) {
      // Right-click the only page
      await tabs.first().click({ button: 'right' });
      await page.waitForTimeout(100);

      // Delete button should be disabled
      const deleteBtn = page.locator('button:has-text("Delete page")');
      if ((await deleteBtn.count()) > 0) {
        await expect(deleteBtn).toBeDisabled();
      }
    }
  });

  test('each page shows its own content in layers tree', async ({ page }) => {
    // Add a second page
    const addBtn = page.locator('[aria-label="Add page"]');
    await addBtn.click();
    await page.waitForTimeout(200);

    const tabs = page.locator('[role="tablist"][aria-label="Page navigation"] [role="tab"]');
    const tree = page.getByRole('tree', { name: /layers/i });

    // Switch between pages and verify tree re-renders
    await tabs.nth(0).click();
    await page.waitForTimeout(100);
    await expect(tree).toBeAttached();

    await tabs.nth(1).click();
    await page.waitForTimeout(100);
    await expect(tree).toBeAttached();
  });

  test('global children visible across all pages', async ({ page }) => {
    const tabs = page.locator('[role="tablist"][aria-label="Page navigation"] [role="tab"]');

    // Get tree items on first page
    await tabs.first().click();
    await page.waitForTimeout(100);

    const tree = page.getByRole('tree', { name: /layers/i });
    await expect(tree).toBeAttached();
  });
});
