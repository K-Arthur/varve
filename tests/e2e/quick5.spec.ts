import { test } from '@playwright/test';

test.setTimeout(120000);
test('quick check short', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('http://localhost:1420/', { timeout: 60000, waitUntil: 'domcontentloaded' });
  console.log('DOM loaded');
  await page.waitForTimeout(5000);
  console.log('Errors:', JSON.stringify(errors));
  const html = await page.content();
  console.log('Has strata-home:', html.includes('strata-home'));
});
