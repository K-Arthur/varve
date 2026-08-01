import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const fileChooserSeen = page
  .waitForEvent('filechooser', { timeout: 8000 })
  .then(() => 'filechooser')
  .catch(() => 'no-filechooser');
await page.goto('http://localhost:1430/?perf=1', { timeout: 90000, waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
await page.getByRole('button', { name: /^open/i }).first().click({ force: true, timeout: 15000 });
await page.waitForTimeout(3000);
const fc = await fileChooserSeen;
const dialogs = await page.evaluate(() =>
  [...document.querySelectorAll('dialog')].map((d) => ({
    open: d.open,
    text: (d.innerText || '').slice(0, 80),
  })),
);
console.log('chooser:', fc);
console.log('dialogs:', JSON.stringify(dialogs.slice(0, 5)));
await browser.close();
