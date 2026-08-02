import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.addInitScript(() => {
  Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
});
const fcPromise = page
  .waitForEvent('filechooser', { timeout: 12000 })
  .then((fc) => `FC:${fc.element().tagName}`)
  .catch(() => 'NO-FC');
await page.goto('http://localhost:1430/?perf=1', { timeout: 90000, waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
// Click the toolbar Open… via text, scoped to the toolbar area.
const btn = page
  .locator('header, .home-toolbar, [class*=toolbar]')
  .getByRole('button', { name: /^open/i })
  .first();
const count = await btn.count();
console.log('toolbar open btn count:', count);
if (count > 0) {
  await btn
    .click({ force: true, timeout: 10000 })
    .catch((e) => console.log('click err:', e.message.slice(0, 100)));
} else {
  // fall back: click all Open buttons in sequence
  const all = page.getByRole('button', { name: /^open/i });
  const n = await all.count();
  console.log('all open buttons:', n);
  for (let i = 0; i < n; i++) {
    await all
      .nth(i)
      .click({ force: true, timeout: 3000 })
      .catch(() => {});
    await page.waitForTimeout(800);
  }
}
await page.waitForTimeout(1500);
console.log('chooser:', await fcPromise);
await browser.close();
