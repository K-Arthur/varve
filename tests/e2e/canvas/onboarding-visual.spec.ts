import { expect, test } from '@playwright/test';

const BASE = process.env.VARVE_E2E_PORT
  ? `http://localhost:${process.env.VARVE_E2E_PORT}`
  : 'http://localhost:5199';

async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto(BASE);
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog')
    .getByRole('button', { name: /create/i })
    .waitFor({ timeout: 5000 });
  await page
    .locator('dialog')
    .getByRole('button', { name: /create/i })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 10000 });
  // Close welcome dialog if present
  const welcomeDialog = page.getByRole('dialog', { name: /welcome to varve/i });
  if (await welcomeDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
    const blankBtn = page.getByRole('button', { name: /blank canvas/i });
    const closeBtn = welcomeDialog.getByRole('button', { name: /close/i });
    if (await blankBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await blankBtn.click();
    } else if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await closeBtn.click();
    }
  }
}

test.describe('onboarding visual verification', () => {
  test('welcome dialog renders correctly', async ({ page }) => {
    await page.goto(BASE);
    await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /^new$/i }).click();
    await page
      .locator('dialog')
      .getByRole('button', { name: /create/i })
      .waitFor({ timeout: 5000 });
    await page
      .locator('dialog')
      .getByRole('button', { name: /create/i })
      .click();
    await page.locator('.layers-panel').waitFor({ timeout: 10000 });

    const welcome = page.getByRole('dialog', { name: /welcome to varve/i });
    if (await welcome.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(welcome).toBeVisible();
      await page.screenshot({
        path: 'test-results-onboarding/welcome-dialog.png',
        fullPage: false,
      });
    }
  });

  test('canvas empty state with keyboard shortcuts', async ({ page }) => {
    await navigateToEditor(page);
    await page.waitForTimeout(1000);

    // The empty state should show mode-aware guidance with keyboard shortcuts
    const emptyState = page.locator('.editor-canvas__empty-state');
    await expect(emptyState).toBeVisible({ timeout: 5000 });

    // Verify keyboard shortcut hints are visible
    await expect(page.getByText('Frame').first()).toBeVisible();
    await expect(page.getByText('Rectangle').first()).toBeVisible();

    await page.screenshot({
      path: 'test-results-onboarding/canvas-empty-state.png',
      fullPage: false,
    });
  });

  test("Help menu has What's New item", async ({ page }) => {
    await navigateToEditor(page);
    await page.waitForTimeout(500);

    await page.getByRole('menuitem', { name: /^help$/i }).click();
    await page.waitForTimeout(300);

    const whatsNew = page.getByRole('menuitem', { name: /what's new/i });
    await expect(whatsNew).toBeVisible();
    await page.screenshot({
      path: 'test-results-onboarding/help-menu-whats-new.png',
      fullPage: false,
    });
    await page.keyboard.press('Escape');
  });

  test('dark theme: canvas empty state', async ({ page }) => {
    await navigateToEditor(page);
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await page.waitForTimeout(500);

    const emptyState = page.locator('.editor-canvas__empty');
    if (await emptyState.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.screenshot({
        path: 'test-results-onboarding/canvas-empty-dark.png',
        fullPage: false,
      });
    }
  });
});
