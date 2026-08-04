import { test } from '@playwright/test';

test('debug page load', async ({ page }) => {
  page.on('console', (msg) => console.log(`[browser] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`));
  await page.goto('/', { timeout: 60000, waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);
  const html = await page.content();
  console.log('Page HTML length:', html.length);
  console.log('Has .varve-home:', html.includes('varve-home'));
  console.log('Has new button:', html.includes('New'));
  console.log('Has loading:', html.includes('Loading Varve'));
  await page.screenshot({ path: '/tmp/debug-screenshot.png' });
  console.log('Done');
});
