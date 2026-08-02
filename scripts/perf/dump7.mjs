import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 400)));
await page.goto('http://localhost:1430/?perf=1', { timeout: 90000, waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30000 });
await page.getByRole('button', { name: /^new$/i }).click({ force: true, timeout: 20000 });
await page.waitForTimeout(1500);
const createBtn = page.getByRole('button', { name: /^create$/i }).first();
await createBtn.waitFor({ state: 'visible', timeout: 15000 });
await createBtn.click({ force: true, timeout: 15000 });
await page.locator('.layers-panel').waitFor({ timeout: 20000 });
const canvas = page.locator('canvas.editor-canvas__content-layer');
await canvas.waitFor({ state: 'visible', timeout: 15000 });
await page.keyboard.press('r');
const box = await canvas.boundingBox();
await page.mouse.move(box.x + 100, box.y + 100);
await page.mouse.down();
await page.mouse.move(box.x + 200, box.y + 160);
await page.mouse.up();
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const h = window.__strataPerf;
  return {
    hasHandle: !!h,
    frameCount: h ? h.getFrames(1000).length : -1,
    isEnabled: h ? h.isEnabled() : false,
    last: h ? h.getLast() : null,
    treeItems: document.querySelectorAll('[role=treeitem]').length,
    contentCanvas: !!document.querySelector('canvas.editor-canvas__content-layer'),
    contentW: document.querySelector('canvas.editor-canvas__content-layer')?.width,
  };
});
console.log(JSON.stringify(info, null, 1));
console.log('ERRS:', errs.slice(0, 4));
await browser.close();
