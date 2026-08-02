import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto('http://localhost:1430/?perf=1', { timeout: 90000, waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
const btns = await page.evaluate(() =>
  [...document.querySelectorAll('button,[role=button]')]
    .map((b) => (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 30),
);
console.log('BUTTONS:', JSON.stringify(btns, null, 1));
await browser.close();
