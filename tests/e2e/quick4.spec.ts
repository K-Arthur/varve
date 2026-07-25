import { test } from '@playwright/test';

test('quick check with errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      errors.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  await page.goto('http://localhost:1420/', { timeout: 60000, waitUntil: 'domcontentloaded' });
  console.log('DOM loaded, waiting for app...');
  await page.waitForTimeout(15000);
  console.log('Errors during load:', JSON.stringify(errors, null, 2));
  const html = await page.content();
  console.log('Has strata-home:', html.includes('strata-home'));
  console.log('HTML length:', html.length);
});
