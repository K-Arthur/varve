import { expect, type Page, test } from '@playwright/test';

/**
 * Integration CI deliberately builds without a collector. Enable only the two
 * public HTML configuration attributes and the matching CSP connection for this
 * fixture, so the actual compiled consent code is exercised in that build too.
 * All collector requests below are intercepted; no test data leaves the browser.
 */
async function enableAnalyticsFixture(page: Page): Promise<void> {
  await page.route(
    (url) => url.hostname === '127.0.0.1',
    async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const response = await route.fetch();
      const html = await response.text();
      expect(html).toContain('data-analytics-enabled=');
      await route.fulfill({
        response,
        body: html
          .replace(/data-analytics-enabled="[^"]*"/, 'data-analytics-enabled="true"')
          .replace(
            /data-analytics-domain="[^"]*"/,
            'data-analytics-domain="varvestudio.goatcounter.com"',
          )
          .replace(
            /connect-src 'self'[^;]*/,
            "connect-src 'self' https://varvestudio.goatcounter.com",
          ),
      });
    },
  );
}

test('the built website sends nothing before consent', async ({ page }) => {
  const requests: string[] = [];
  await page.route(
    /https:\/\/(.*\.goatcounter\.com|plausible\.io|gc\.zgo\.at)\//,
    async (route) => {
      requests.push(route.request().url());
      await route.abort();
    },
  );
  await page.goto('/');
  await page.waitForTimeout(200);
  expect(requests).toEqual([]);
});

test('website analytics is consent-gated and withdrawable', async ({ page }) => {
  await enableAnalyticsFixture(page);
  const analyticsRequests: string[] = [];
  await page.route('https://*.goatcounter.com/count?*', async (route) => {
    analyticsRequests.push(route.request().url());
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()).not.toHaveProperty('referer');
    expect(route.request().headers()).not.toHaveProperty('cookie');
    expect(new URL(route.request().url()).searchParams.get('ns')).toBe('true');
    await route.fulfill({ status: 202, body: '', headers: { 'access-control-allow-origin': '*' } });
  });

  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-analytics-enabled', 'true');
  await expect(page.locator('#website-analytics-consent')).toBeVisible();
  expect(analyticsRequests).toEqual([]);

  await page.getByRole('button', { name: 'Allow website analytics' }).click();
  await expect(page.locator('#website-analytics-consent')).toBeHidden();
  await expect.poll(() => analyticsRequests.length, { timeout: 10000 }).toBeGreaterThan(0);

  await page.goto('/about/privacy');
  await page.getByRole('button', { name: 'Withdraw website analytics consent' }).click();
  await expect(page.locator('#website-analytics-consent')).toBeVisible();
  await expect(page.locator('#website-analytics-consent')).toContainText(
    'Optional website analytics',
  );
  const countAfterWithdrawal = analyticsRequests.length;
  await page.reload();
  await expect(page.locator('#website-analytics-consent')).toBeHidden();
  await page.waitForTimeout(200);
  expect(analyticsRequests).toHaveLength(countAfterWithdrawal);
});

test('a prior provider grant requires a fresh choice and refusal sends nothing', async ({
  page,
}) => {
  await enableAnalyticsFixture(page);
  const requests: string[] = [];
  await page.addInitScript(() =>
    localStorage.setItem('varve:website-analytics-consent', 'granted'),
  );
  await page.route('https://*.goatcounter.com/**', async (route) => {
    requests.push(route.request().url());
    await route.abort();
  });
  await page.goto('/download');
  await expect(page.locator('#website-analytics-consent')).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.reload();
  await expect(page.locator('#website-analytics-consent')).toBeHidden();
  await page.waitForTimeout(200);
  expect(requests).toEqual([]);
});

for (const signal of ['globalPrivacyControl', 'doNotTrack'] as const) {
  test(`${signal} blocks every analytics request`, async ({ page }) => {
    await enableAnalyticsFixture(page);
    const requests: string[] = [];
    await page.addInitScript((name) => {
      Object.defineProperty(navigator, name, {
        configurable: true,
        value: name === 'globalPrivacyControl' ? true : '1',
      });
      localStorage.setItem('varve:website-analytics-consent:goatcounter-v1', 'granted');
    }, signal);
    await page.route(/https:\/\/(.*\.goatcounter\.com|plausible\.io)\//, async (route) => {
      requests.push(route.request().url());
      await route.abort();
    });
    await page.goto('/download');
    await expect(page.locator('#website-analytics-consent')).toBeHidden();
    await page.waitForTimeout(200);
    expect(requests).toEqual([]);
  });
}
