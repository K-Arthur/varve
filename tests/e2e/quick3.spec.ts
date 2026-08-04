import { test } from '@playwright/test';

test('quick check 127', async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));
  await page.goto('http://127.0.0.1:1420/', { timeout: 60000, waitUntil: 'domcontentloaded' });
  console.log('DOM loaded');
  await page.waitForTimeout(5000);
  console.log('Waited 5s, checking for varve-home');
  const el = page.locator('.varve-home');
  const count = await el.count().catch(() => -1);
  console.log('varve-home count:', count);
  const html = await page.content();
  console.log('HTML length:', html.length);
  console.log('Has Loading:', html.includes('Loading Varve'));
});
