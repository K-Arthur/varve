import { expect, test } from '@playwright/test';

const TEST_PAGE = 'http://localhost:1420/e2e.html';

test.describe('Home shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('renders toolbar with New File button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /new file/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /open/i })).toBeVisible();
  });

  test('renders sidebar navigation with sections', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'File navigation' });
    const items = nav.getByRole('option');
    const labels = await items.allTextContents();
    expect(labels.join(' ')).toContain('Recent');
    expect(labels.join(' ')).toContain('All Files');
    expect(labels.join(' ')).toContain('Templates');
    expect(labels.join(' ')).toContain('Trash');
  });

  test('renders project entries in sidebar', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'File navigation' });
    const items = nav.getByRole('option');
    const labels = await items.allTextContents();
    expect(labels.join(' ')).toContain('Brand');
    expect(labels.join(' ')).toContain('Marketing');
    expect(labels.join(' ')).toContain('App UI');
  });

  test('sidebar selection navigates to section', async ({ page }) => {
    // Navigate to All Files via menu icon - this is in the toolbar
    await page.goto(TEST_PAGE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    // Click the sidebar item for All Files
    const allFiles = page.getByRole('option', { name: /all files/i });
    await allFiles.click();
    // Check content area renders files
    await expect(page.getByRole('grid', { name: 'File grid' })).toBeVisible();
  });
});
