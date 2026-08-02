/* Seed a large document into IndexedDB and open it via the home screen.
 * Usage: node scripts/perf/seed-and-open.mjs [nodeCount] */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:1430';
const COUNT = Number(process.argv[2] ?? process.env.NODES ?? '500');

const browser = await chromium.launch({ headless: true, args: ['--disable-gpu-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));

// Boot the app so IndexedDB gets upgraded with all stores, then seed.
await page.goto(`${BASE}/`, { timeout: 60000, waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
const seeded = await page.evaluate(async (count) => {
  const CURRENT_DOCUMENT_VERSION = '2.10';
  const nodes = {};
  const rootChildren = [];
  for (let i = 0; i < count; i++) {
    const col = i % 100;
    const row = Math.floor(i / 100);
    const id = `bench-${i}`;
    nodes[id] = {
      id,
      kind: 'shape',
      name: `Rect ${i}`,
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      transform: [1, 0, 0, 1, col * 120, row * 120],
      rotation: 0,
      fill: { type: 'solid', color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 } },
      strokes: [],
      effects: [],
      shape: { kind: 'rect', x: 0, y: 0, w: 80, h: 60 },
    };
    rootChildren.push(id);
  }
  const doc = {
    id: 'bench-doc',
    formatVersion: CURRENT_DOCUMENT_VERSION,
    name: 'Bench Document',
    rootChildren,
    nodes,
    components: {},
    nextId: count + 1,
    selectionSets: { current: [], saved: {} },
  };
  const json = JSON.stringify(doc);
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('strata-home', 3);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const entry = {
    id: 'bench-doc',
    name: 'Bench Document',
    kind: 'design',
    projectId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    openedAt: Date.now(),
    size: json.length,
    pinned: false,
    trashedAt: null,
    ordering: '',
    contentHash: `bench-${count}`,
  };
  await new Promise((res, rej) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put({ entry, json });
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
  // Also record in recentFiles so the Recents list shows it.
  if (db.objectStoreNames.contains('recentFiles')) {
    await new Promise((res) => {
      const tx = db.transaction('recentFiles', 'readwrite');
      tx.objectStore('recentFiles').put({ id: 'bench-doc', entry, openedAt: Date.now() });
      tx.oncomplete = res;
    });
  }
  return { ok: true, jsonLen: json.length, nodeCount: count };
}, COUNT);
console.log('SEEDED:', JSON.stringify(seeded));

// Now go to home and open the file.
await page.goto(`${BASE}/`, { timeout: 60000, waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const hasCard = await page
  .getByText('Bench Document')
  .first()
  .isVisible({ timeout: 8000 })
  .catch(() => false);
console.log('home card visible:', hasCard);
if (hasCard) {
  await page.getByText('Bench Document').first().click({ force: true });
  await page.locator('.layers-panel').waitFor({ timeout: 30000 });
  console.log('OPENED in editor');
} else {
  console.log('FILE CARD NOT FOUND — dumping buttons');
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll('button,[role=button]')]
      .map((b) => (b.textContent || '').trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 25),
  );
  console.log(JSON.stringify(btns));
}
const treeCount = await page
  .evaluate(() => document.querySelectorAll('[role=treeitem]').length)
  .catch(() => -1);
console.log('TREE ITEMS:', treeCount, 'ERRS:', errs.slice(0, 3));
await browser.close();
