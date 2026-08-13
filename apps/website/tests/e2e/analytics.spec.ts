import { expect, test } from '@playwright/test';

test('website analytics is consent-gated and withdrawable', async ({ page }) => {
  const plausibleRequests: string[] = [];
  await page.route('https://plausible.io/api/event', async (route) => {
    plausibleRequests.push(route.request().url());
    await route.fulfill({ status: 202, body: '' });
  });

  await page.goto('/');
  const enabled = await page.locator('html').getAttribute('data-analytics-enabled');

  if (enabled !== 'true') {
    await expect(page.locator('#website-analytics-consent')).toBeHidden();
    await page.waitForTimeout(100);
    expect(plausibleRequests).toEqual([]);
    return;
  }

  await page.evaluate(() => localStorage.removeItem('varve:website-analytics-consent'));
  await page.reload();
  await expect(page.locator('#website-analytics-consent')).toBeVisible();
  expect(plausibleRequests).toEqual([]);

  await page.getByRole('button', { name: 'Allow website analytics' }).click();
  await expect(page.locator('#website-analytics-consent')).toBeHidden();
  await page.waitForTimeout(100);
  expect(plausibleRequests.length).toBeGreaterThan(0);

  await page.goto('/about/privacy');
  await page.getByRole('button', { name: 'Withdraw website analytics consent' }).click();
  await expect(page.locator('#website-analytics-consent')).toBeVisible();
  await expect(page.locator('#website-analytics-consent')).toContainText(
    'Optional website analytics',
  );
});
