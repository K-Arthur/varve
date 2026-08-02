import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true, args: ['--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 500)));
page.on('crash', () => errs.push('[page-crash]'));
browser.on('disconnected', () => errs.push('[browser-disconnected]'));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(`[console] ${m.text().slice(0, 300)}`);
});
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
const canvas = page.locator('canvas.editor-canvas__content-layer');
await canvas.waitFor({ state: 'visible', timeout: 15000 });
const box = await canvas.boundingBox();
await page.keyboard.press('r');
await page.waitForTimeout(80);
for (let i = 0; i < 4; i++) {
  await page.mouse.move(box.x + 60 + i * 80, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 100 + i * 80, box.y + 90);
  await page.mouse.up();
  await page.waitForTimeout(30);
}
console.log('seed done, errs:', errs.slice(0, 3));
await page.keyboard.press('a');
await page.waitForTimeout(200);
const before = await page.evaluate(() => document.querySelectorAll('[role=treeitem]').length);
console.log('selected all, treeitems:', before);
await page.keyboard.down('Alt');
await page.mouse.move(box.x + 300, box.y + 300);
await page.mouse.down();
await page.mouse.move(box.x + 340, box.y + 340);
await page.mouse.up();
await page.keyboard.up('Alt');
await page.waitForTimeout(1500);
const after = await page
  .evaluate(() => {
    const ok = !document.hidden;
    return { treeitems: document.querySelectorAll('[role=treeitem]').length, ok };
  })
  .catch((e) => ({ err: String(e).slice(0, 300) }));
console.log('after alt-drag:', JSON.stringify(after));
console.log('ERRS:', errs.slice(0, 5));
await browser.close();
