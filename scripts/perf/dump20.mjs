import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 200)}`));
await page.addInitScript(() => {
  Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
  // Track file inputs created
  window.__fileInputs = 0;
  const origCreate = document.createElement.bind(document);
  document.createElement = (tag, opts) => {
    const el = origCreate(tag, opts);
    if (String(tag).toLowerCase() === 'input') {
      Object.defineProperty(el, 'click', {
        configurable: true,
        value: function () {
          window.__fileInputs++;
          return origClick.call(this);
        },
      });
    }
    return el;
  };
});
await page.goto('http://localhost:1430/?perf=1', { timeout: 90000, waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page
  .locator('header, .home-toolbar, [class*=toolbar]')
  .getByRole('button', { name: /^open/i })
  .first()
  .click({ force: true, timeout: 10000 });
await page.waitForTimeout(2000);
const st = await page.evaluate(() => ({
  fileInputs: window.__fileInputs,
  inputs: [...document.querySelectorAll('input[type=file]')].length,
}));
console.log('STATE:', JSON.stringify(st));
console.log('LOGS:', JSON.stringify(logs.slice(-6), null, 1));
await browser.close();
