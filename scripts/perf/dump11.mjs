import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true, args: ['--disable-gpu-sandbox'] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 400)));
page.on('crash', () => errs.push('[page-crash]'));
browser.on('disconnected', () => errs.push('[browser-disconnected]'));
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
for (let i = 0; i < 3; i++) {
  await page.mouse.move(box.x + 60 + i * 120, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 100 + i * 120, box.y + 90);
  await page.mouse.up();
  await page.waitForTimeout(100);
}
const tree = await page.evaluate(() => {
  const items = [...document.querySelectorAll('[role=treeitem]')];
  return {
    count: items.length,
    labels: items.slice(0, 5).map((el) => (el.innerText || '').trim().slice(0, 30)),
  };
});
console.log('TREE:', JSON.stringify(tree));
console.log('ERRS:', errs.slice(0, 4));
await browser.close();
