import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true, args: ['--disable-gpu-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto('http://localhost:1430/', { timeout: 90000, waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const info = await page.evaluate(async () => {
  const dbs = await indexedDB.databases();
  const out = [];
  for (const { name } of dbs) {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    out.push({ name, version: db.version, stores: [...db.objectStoreNames] });
    db.close();
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
