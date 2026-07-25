import { test } from '@playwright/test';
test('quick check', async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('CONSOLE:', msg.text());
  });
  await page.goto('http://localhost:1420/', { timeout: 120000, waitUntil: 'load' });
  await page.waitForTimeout(10000);
  const text = await page
    .locator('#strata-boot-fallback h1')
    .textContent()
    .catch(() => 'none');
  console.log('Fallback text:', text);
  const html = await page.content();
  console.log('Has strata-home:', html.includes('strata-home'));
  console.log('HTML length:', html.length);
});
