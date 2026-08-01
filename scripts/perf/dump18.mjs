import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' || m.text().includes('Open'))
    console.log('CONSOLE:', m.text().slice(0, 200));
});
page.on('pageerror', (e) => console.log('PAGEERR:', String(e).slice(0, 200)));
const fcPromise = page
  .waitForEvent('filechooser', { timeout: 10000 })
  .then(() => 'FC')
  .catch(() => 'NO-FC');
await page.goto('http://localhost:1430/?perf=1', { timeout: 90000, waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
const caps = await page.evaluate(() => ({
  showOpenFilePicker: typeof window.showOpenFilePicker,
  showSaveFilePicker: typeof window.showSaveFilePicker,
}));
console.log('CAPS:', JSON.stringify(caps));
// click the toolbar Open… (the second one)
await page
  .getByRole('button', { name: /^open/i })
  .nth(1)
  .click({ force: true, timeout: 15000 })
  .catch((e) => console.log('click err', e.message.slice(0, 80)));
await page.waitForTimeout(2000);
console.log('chooser result:', await fcPromise);
await browser.close();
