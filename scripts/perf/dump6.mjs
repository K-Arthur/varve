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
await page.keyboard.press('r');
const canvas = page.locator('canvas.editor-canvas__content-layer');
await canvas.waitFor({ state: 'visible', timeout: 15000 });
const box = await canvas.boundingBox();
await page.mouse.move(box.x + 100, box.y + 100);
await page.mouse.down();
await page.mouse.move(box.x + 200, box.y + 160);
await page.mouse.up();
await page.waitForTimeout(1200);
const frames = await page.evaluate(() =>
  window.__varvePerf ? window.__varvePerf.getFrames(30) : [],
);
console.log('FRAMES:', JSON.stringify(frames.slice(-8), null, 1));
console.log('ERRS:', errs.slice(0, 3));
await browser.close();
