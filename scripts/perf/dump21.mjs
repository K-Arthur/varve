import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
page.on('crash', () => errs.push('[page-crash]'));
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
// Draw 1 rect
await page.keyboard.press('r');
await page.waitForTimeout(80);
await page.mouse.move(box.x + 60, box.y + 60);
await page.mouse.down();
await page.mouse.move(box.x + 120, box.y + 100);
await page.mouse.up();
await page.waitForTimeout(300);
console.log(
  'after 1 rect:',
  await page.evaluate(() => document.querySelectorAll('[role=treeitem]').length),
);
// Select it, then Ctrl+D a few times
await page.keyboard.press('a');
await page.waitForTimeout(200);
for (let i = 0; i < 5; i++) {
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(300);
  const c = await page.evaluate(() => document.querySelectorAll('[role=treeitem]').length);
  console.log(`after Ctrl+D #${i + 1}:`, c);
}
console.log('ERRS:', errs.slice(0, 3));
await browser.close();
