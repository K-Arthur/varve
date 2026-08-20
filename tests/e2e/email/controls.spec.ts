import { expect, test } from '@playwright/test';

async function navigateToEditor(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/', { timeout: 180_000, waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 180_000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create design$/i })
    .click();
  await page.locator('.editor__layers-panel, .layers-panel').first().waitFor({ timeout: 180_000 });
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
}

test('email preview controls switch viewport and generated code remains read-only', async ({
  page,
}) => {
  await navigateToEditor(page);
  await page.keyboard.press('Control+Shift+7');
  await page.getByRole('tab', { name: 'Email' }).click();
  await page.getByRole('button', { name: 'Enable email template' }).click();

  await expect(page.getByTitle('Email browser preview')).toBeVisible();
  await expect(page.locator('.email-panel__preview-frame--desktop')).toBeVisible();

  await page.getByRole('button', { name: 'Mobile' }).click();
  await expect(page.locator('.email-panel__preview-frame--mobile')).toBeVisible();

  await page.getByTestId('email-panel').getByRole('button', { name: 'Code' }).click();
  const generated = page.getByRole('region', { name: 'Generated email HTML (read-only)' });
  await expect(generated).toBeVisible();
  await expect(generated.locator('pre')).toBeVisible();
  await expect(page.getByTitle('Email browser preview')).toBeHidden();
});
