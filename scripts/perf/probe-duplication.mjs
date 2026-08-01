import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: [
    '--disable-gpu-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto('http://localhost:1432/', { timeout: 90000, waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30000 });
await page
  .waitForFunction(
    () => {
      const s = document.querySelector('.startup-loader');
      return !s || s.getAttribute('aria-busy') !== 'true';
    },
    { timeout: 30000 },
  )
  .catch(() => {});
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
for (let i = 0; i < 4; i++) {
  const col = i % 2;
  const row = Math.floor(i / 2);
  await page.keyboard.press('r');
  await page.waitForTimeout(60);
  await page.mouse.move(box.x + 60 + col * 160, box.y + 60 + row * 160);
  await page.mouse.down();
  await page.mouse.move(box.x + 130 + col * 160, box.y + 120 + row * 160);
  await page.mouse.up();
  await page.waitForTimeout(40);
}
for (let guard = 0; guard < 7; guard++) {
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(30);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(80);
}
await page.waitForTimeout(300);
const t0 = Date.now();
await page.keyboard.press('Control+a');
await page.waitForTimeout(20);
await page.keyboard.press('Control+d');
await page.waitForTimeout(200);
console.log('FIXED dup wall (~500 nodes):', Date.now() - t0, 'ms');
await browser.close();
