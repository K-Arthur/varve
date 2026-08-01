import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true, args: ['--disable-gpu-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
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
await page.keyboard.press('r');
await page.waitForTimeout(80);
await page.mouse.move(box.x + 60, box.y + 60);
await page.mouse.down();
await page.mouse.move(box.x + 100, box.y + 90);
await page.mouse.up();
await page.waitForTimeout(400);
// Save via Ctrl+S
await page.keyboard.press('Control+s');
await page.waitForTimeout(2000);
const dbInfo = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('strata-home');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const stores = [...db.objectStoreNames];
  const out = { stores: {} };
  for (const s of stores) {
    const tx = db.transaction(s);
    const obj = tx.objectStore(s);
    const count = await new Promise((res) => {
      const c = obj.count();
      c.onsuccess = () => res(c.result);
    });
    let recs = null;
    if (count > 0)
      recs = await new Promise((res) => {
        const g = obj.getAll();
        g.onsuccess = () => res(g.result);
      });
    out.stores[s] = { count, recs };
  }
  return out;
});
console.log(
  JSON.stringify(
    dbInfo,
    (k, v) => (typeof v === 'string' && v.length > 2000 ? v.slice(0, 2000) + '...[truncated]' : v),
    1,
  ).slice(0, 4000),
);
await browser.close();
