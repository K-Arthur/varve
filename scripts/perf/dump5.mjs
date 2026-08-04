import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
await page.goto('http://localhost:1430/?perf=1', { timeout: 90000, waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30000 });
await page
  .waitForFunction(
    () => document.querySelector('.startup-loader')?.getAttribute('aria-busy') !== 'true',
    { timeout: 30000 },
  )
  .catch(() => {});
await page.getByRole('button', { name: /^new$/i }).click({ force: true, timeout: 20000 });
await page.waitForTimeout(1500);
const createBtn = page.getByRole('button', { name: /^create$/i }).first();
await createBtn.waitFor({ state: 'visible', timeout: 15000 });
await createBtn.click({ force: true, timeout: 15000 });
await page.locator('.layers-panel').waitFor({ timeout: 20000 });
const handle = await page.evaluate(() => {
  const h = window.__varvePerf;
  return h
    ? { hasHandle: true, frames: h.getFrames(5).length, enabled: !!h.getLast() }
    : { hasHandle: false };
});
console.log('PERF HANDLE:', JSON.stringify(handle));
console.log('ERRS:', errs.slice(0, 3));
await browser.close();
