import { expect, test } from '@playwright/test';

test('file formats documentation explains local file actions', async ({ page }) => {
  await page.goto('/docs/file-formats/');
  await expect(
    page.getByRole('heading', { name: /open, import, place, and install/i }),
  ).toBeVisible();
  await expect(
    page.getByText(/upload.*reserved for an explicit, consented remote service/i),
  ).toBeVisible();
  await expect(page.getByText(/duplicate names are allowed/i)).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('file-formats-local-actions.png'),
    fullPage: true,
  });
});
