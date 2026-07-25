import { test } from '@playwright/test';

test.setTimeout(120000);
test('check new button state', async ({ page }) => {
  page.on('pageerror', (err) => console.log('ERR:', err.message));
  await page.goto('http://localhost:1420/', { timeout: 60000, waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Try various selectors for the "New" button
  const btn1 = page.locator('[data-testid="new-file-button"]');
  console.log('data-testid button exists:', await btn1.isVisible().catch(() => false));

  const btn2 = page.getByRole('button', { name: /^new$/i });
  console.log('role button exact new exists:', await btn2.isVisible().catch(() => false));
  const btn2Name = await btn2.getAttribute('aria-label').catch(() => 'no attr');
  console.log('Button aria-label:', btn2Name);
  const btn2Text = await btn2.textContent().catch(() => 'no text');
  console.log('Button text:', btn2Text);

  // Try clicking the data-testid button
  if (await btn1.isVisible()) {
    await btn1.click({ timeout: 10000 });
    console.log('Clicked data-testid new button');
    await page.waitForTimeout(1000);
  }

  const html = await page.content();
  console.log('Has strata-home:', html.includes('strata-home'));
  console.log('Has dialog:', html.includes('<dialog'));
});
