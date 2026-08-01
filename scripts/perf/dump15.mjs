import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true, args: ['--disable-gpu-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(`[pageerror] ${String(e).slice(0, 300)}`));
page.on('crash', () => errs.push('[page-crash]'));
browser.on('disconnected', () => errs.push('[browser-disconnected]'));
await page.goto('http://localhost:1430/', { timeout: 90000, waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /^new$/i }).click({ force: true, timeout: 30000 });
await page.waitForTimeout(1500);
const createBtn = page.getByRole('button', { name: /^create$/i }).first();
await createBtn.click({ force: true, timeout: 15000 });
await page.locator('.layers-panel').waitFor({ timeout: 20000 });
for (let i = 0; i < 4; i++) {
  const n = await page.locator('dialog[open]').count();
  if (n === 0) break;
  const top = page.locator('dialog[open]').last();
  const close = top.getByRole('button', { name: /close/i }).first();
  if (await close.isVisible({ timeout: 500 }).catch(() => false))
    await close.click({ force: true });
  else await page.keyboard.press('Escape');
  await page.waitForTimeout(50);
}
const canvas = page.locator('canvas.editor-canvas__content-layer');
await canvas.waitFor({ state: 'visible', timeout: 15000 });
const box = await canvas.boundingBox();
const t0 = Date.now();
const _created = 0;
for (let i = 0; i < 120; i++) {
  const col = i % 30;
  const row = Math.floor(i / 30);
  await page.keyboard.press('r');
  await page.waitForTimeout(60);
  await page.mouse.move(box.x + 30 + col * 70, box.y + 30 + row * 70);
  await page.mouse.down();
  await page.mouse.move(box.x + 60 + col * 70, box.y + 50 + row * 70);
  await page.mouse.up();
  await page.waitForTimeout(20);
  if (i % 20 === 19) {
    const c = await page.evaluate(() => document.querySelectorAll('[role=treeitem]').length);
    console.log(`after ${i + 1} draws: treeitems=${c} ${(Date.now() - t0) / 1000}s elapsed`);
  }
}
const finalCount = await page
  .evaluate(() => document.querySelectorAll('[role=treeitem]').length)
  .catch(() => 'crash');
console.log(
  'FINAL treeitems:',
  finalCount,
  'total time:',
  `${((Date.now() - t0) / 1000).toFixed(1)}s`,
);
console.log('ERRS:', errs.slice(0, 4));
await browser.close();
