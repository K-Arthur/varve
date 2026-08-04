import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 400)));
await page.goto('http://localhost:1430/?perf=1', { timeout: 90000, waitUntil: 'domcontentloaded' });
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
const welcome = page
  .locator('dialog')
  .getByRole('button', { name: /blank canvas|close|get started/i })
  .first();
if (await welcome.isVisible({ timeout: 2000 }).catch(() => false))
  await welcome.click({ force: true });
const canvas = page.locator('canvas.editor-canvas__content-layer');
await canvas.waitFor({ state: 'visible', timeout: 15000 });
const box = await canvas.boundingBox();
await page.keyboard.press('r');
await page.waitForTimeout(100);
await page.mouse.move(box.x + 100, box.y + 100);
await page.mouse.down();
await page.mouse.move(box.x + 180, box.y + 140);
await page.mouse.up();
await page.waitForTimeout(1500);
const info = await page.evaluate(() => ({
  treeItems: document.querySelectorAll('[role=treeitem]').length,
  frames: window.__varvePerf ? window.__varvePerf.getFrames(1000).length : -1,
}));
console.log('RESULT:', JSON.stringify(info));
console.log('ERRS:', errs.slice(0, 3));
await browser.close();
