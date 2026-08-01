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
await page.waitForTimeout(1500);
const dbInfo = await page.evaluate(async () => {
  const dbs = await indexedDB.databases();
  const out = [];
  for (const { name } of dbs) {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const stores = [...db.objectStoreNames];
    const rec = { name, stores: {} };
    for (const s of stores) {
      const tx = db.transaction(s);
      const obj = tx.objectStore(s);
      const count = await new Promise((res) => {
        const c = obj.count();
        c.onsuccess = () => res(c.result);
      });
      let sample = null;
      if (count > 0 && ['files', 'versionContent', 'templates'].includes(s)) {
        sample = await new Promise((res) => {
          const g = obj.getAll();
          g.onsuccess = () => res(g.result.slice(0, 1));
        });
      }
      rec.stores[s] = { count, sampleKeys: sample ? Object.keys(sample[0] || {}) : null };
      if (sample && s === 'files') {
        rec.stores[s].sampleEntry = sample[0].entry;
        rec.stores[s].jsonLen = (sample[0].json || '').length;
        rec.stores[s].jsonSample = (sample[0].json || '').slice(0, 300);
      }
    }
    out.push(rec);
  }
  return out;
});
console.log(JSON.stringify(dbInfo, null, 1));
await browser.close();
