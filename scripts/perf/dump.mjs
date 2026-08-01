import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:1420/', { timeout: 45000, waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30000 });
await page.getByRole('button', { name: /^new$/i }).click({ force: true, timeout: 20000 });
await page.waitForTimeout(2000);
const buttons = await page.evaluate(() => {
  const dlg = document.querySelector('dialog[open]');
  return dlg
    ? [...dlg.querySelectorAll('button')].map((b) => (b.textContent || '').trim().slice(0, 40))
    : [];
});
console.log('DIALOG BUTTONS:', JSON.stringify(buttons));
await browser.close();
