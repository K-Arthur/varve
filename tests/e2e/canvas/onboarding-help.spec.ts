import { expect, test } from '@playwright/test';

import { navigateToEditor } from '../shared';

test.describe('onboarding and help', () => {
  test('welcome dialog offers skip paths and tour can be dismissed', async ({ page }) => {
    await navigateToEditor(page);

    const welcome = page.getByRole('dialog', { name: /welcome to varve/i });
    await expect(welcome).toBeVisible();

    await page.getByRole('button', { name: /blank canvas/i }).click();
    await expect(welcome).toBeHidden({ timeout: 5000 });

    // Dismissed state persists for the session
    await page.reload();
    await navigateToEditor(page);
    await expect(page.getByRole('dialog', { name: /welcome to varve/i })).toBeHidden({
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
