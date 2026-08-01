import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 300)}`));
page.on('console', (m) => {
  if (m.type() === 'error') logs.push(`[err] ${m.text().slice(0, 200)}`);
});
page.on('requestfailed', (r) =>
  logs.push(`[reqfail] ${r.url().slice(0, 80)} ${r.failure()?.errorText}`),
);
await page.goto('http://localhost:1420/', { timeout: 45000, waitUntil: 'domcontentloaded' });
for (let wait = 5; wait <= 30; wait += 5) {
  await page.waitForTimeout(5000);
  const st = await page.evaluate(() => ({
    splash: document.querySelector('.startup-loader')?.getAttribute('aria-busy'),
    newBtn: !!document.querySelector('[data-testid="new-file-button"]'),
    rootLen: (document.getElementById('root')?.innerHTML || '').length,
    dialogs: [...document.querySelectorAll('dialog[open]')].length,
    bodyText: (document.body.innerText || '').slice(0, 80),
  }));
  console.log(`t=${wait}s`, JSON.stringify(st));
}
console.log('ERRS:', JSON.stringify(logs.slice(0, 8), null, 1));
await browser.close();
