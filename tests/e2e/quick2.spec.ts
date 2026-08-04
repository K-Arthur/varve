import { test } from '@playwright/test';

test('quick check dom', async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('CONSOLE:', msg.text());
  });
  await page.goto('http://localhost:1420/', { timeout: 120000, waitUntil: 'domcontentloaded' });
  console.log('DOM loaded');
  // Wait for app to render
  await page
    .waitForSelector('.varve-home', { timeout: 120000 })
    .catch(() => console.log('no varve-home'));
  const html = await page.content();
  console.log('Has varve-home:', html.includes('varve-home'));
  console.log('Has loading:', html.includes('Loading Varve'));
  console.log('HTML length:', html.length);
});
