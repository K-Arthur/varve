import { expect, test } from '@playwright/test';

async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
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
}

test.describe('onboarding and help', () => {
  test('welcome dialog offers skip paths and tour can be dismissed', async ({ page }) => {
    await navigateToEditor(page);

    const welcome = page.getByRole('dialog', { name: /welcome to strata/i });
    await expect(welcome).toBeVisible();

    await page.getByRole('button', { name: /blank canvas/i }).click();
    await expect(welcome).toBeHidden({ timeout: 5000 });

    // Dismissed state persists for the session
    await page.reload();
    await navigateToEditor(page);
    await expect(page.getByRole('dialog', { name: /welcome to strata/i })).toBeHidden({
      timeout: 5000,
    });
  });

  test('F1 opens contextual help without blocking the canvas', async ({ page }) => {
    await navigateToEditor(page);

    const welcomeClose = page
      .getByRole('dialog')
      .getByRole('button', { name: /close|get started/i });
    if (
      await welcomeClose
        .first()
        .isVisible({ timeout: 1000 })
        .catch(() => false)
    ) {
      await welcomeClose.first().click();
    } else {
      await page.getByRole('button', { name: /blank canvas/i }).click();
    }

    await page.keyboard.press('F1');
    await expect(page.getByRole('complementary', { name: 'Help' })).toBeVisible();
    await expect(page.locator('.editor-canvas')).toBeVisible();
  });

  test('help center opens from Help menu', async ({ page }) => {
    await navigateToEditor(page);

    const welcomeClose = page.getByRole('button', { name: /blank canvas/i });
    if (await welcomeClose.isVisible({ timeout: 1000 }).catch(() => false)) {
      await welcomeClose.click();
    }

    await page.getByRole('menuitem', { name: /^help$/i }).click();
    await page.getByRole('menuitem', { name: /help center/i }).click();
    await expect(page.getByRole('dialog').filter({ hasText: /help/i })).toBeVisible();
  });
});
