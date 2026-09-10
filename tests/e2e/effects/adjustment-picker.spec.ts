import { expect, test } from '@playwright/test';

async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog.varve-dialog[open]')
    .getByRole('button', { name: /^create design$/i })
    .click();
  await page.locator('.layers-panel').waitFor();

  const welcomeClose = page
    .getByRole('dialog')
    .getByRole('button', { name: /close|get started/i })
    .first();
  if (await welcomeClose.isVisible({ timeout: 1000 }).catch(() => false)) {
    await welcomeClose.click();
  }
}

async function createAdjustmentLayer(page: import('@playwright/test').Page) {
  await page.getByRole('menuitem', { name: /^Object$/i }).click();
  await page.getByRole('menuitem', { name: /new adjustment layer/i }).click();
  await expect(page.getByText('Adjustment Layer', { exact: true })).toBeVisible();
}

test.describe('Adjustment filter picker', () => {
  test('selects the requested non-first filter instead of Brightness', async ({ page }) => {
    await navigateToEditor(page);
    await createAdjustmentLayer(page);

    await page.getByRole('button', { name: /add adjustment/i }).click();
    const contrast = page.getByRole('menuitem', { name: /^Contrast$/i });
    await contrast.click();

    await expect(page.getByRole('slider', { name: 'Contrast', exact: true })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Brightness', exact: true })).toHaveCount(0);
  });

  test('can select a filter that starts below the menu viewport', async ({ page }) => {
    await navigateToEditor(page);
    await createAdjustmentLayer(page);

    await page.getByRole('button', { name: /add adjustment/i }).click();
    const gradientMap = page.getByRole('menuitem', { name: /^Gradient Map$/i });
    await gradientMap.scrollIntoViewIfNeeded();
    await gradientMap.click();

    await expect(page.getByText('Gradient Map', { exact: true }).last()).toBeVisible();
    await expect(page.getByLabel('Dither')).toBeVisible();
  });
});
