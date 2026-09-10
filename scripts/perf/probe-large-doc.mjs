/* Deterministic large-document probe: generate a .varve document on disk,
 * open it through the app's own Open dialog (file chooser), then measure
 * canvas frame cost + interaction latency via the diagnostics ring.
 *
 * Usage: node scripts/perf/probe-large-doc.mjs [nodeCount] */

import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:1430/?perf=1';
const COUNT = Number(process.argv[2] ?? process.env.NODES ?? '2000');
const DOC_PATH = '/tmp/opencode/bench-doc.varve';

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i] ?? 0;
}
function summary(samples) {
  const s = [...samples].sort((a, b) => a - b);
  return {
    p50: +pct(s, 50).toFixed(2),
    p95: +pct(s, 95).toFixed(2),
    p99: +pct(s, 99).toFixed(2),
    max: +(s[s.length - 1] ?? 0).toFixed(2),
    n: s.length,
  };
}

// Generate document JSON.
const nodes = {};
const rootChildren = [];
for (let i = 0; i < COUNT; i++) {
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
  formatVersion: '2.10',
  name: 'Bench Document',
  rootChildren,
  nodes,
  components: {},
  nextId: COUNT + 1,
  selectionSets: { current: [], saved: {} },
};
writeFileSync(DOC_PATH, JSON.stringify(doc));

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
// Force the app onto the <input type=file> fallback, which Playwright's
// filechooser event reliably intercepts (showOpenFilePicker intercept is
// flakier headless).
await page.addInitScript(() => {
  Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
  Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
});
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
page.on('crash', () => errs.push('[page-crash]'));
browser.on('disconnected', () => errs.push('[browser-disconnected]'));

await page.goto(BASE, { timeout: 90000, waitUntil: 'domcontentloaded' });
await page
  .waitForFunction(
    () => {
      const s = document.querySelector('.startup-loader');
      return s?.getAttribute('aria-busy') !== 'true';
    },
    { timeout: 30000 },
  )
  .catch(() => {});

// Open via Open dialog -> file chooser.
const chooserPromise = page.waitForEvent('filechooser', { timeout: 30000 });
await page.getByRole('button', { name: /^open/i }).first().click({ force: true, timeout: 20000 });
const chooser = await chooserPromise;
await chooser.setFiles(DOC_PATH);
await page.locator('.layers-panel').waitFor({ timeout: 60000 });
console.log('OPENED doc, handle:', !!(await page.evaluate(() => !!window.__varvePerf)));
await page.waitForTimeout(1500);

const nodeCount = await page.evaluate(() => document.querySelectorAll('[role=treeitem]').length);
console.log('TREE ITEMS:', nodeCount);

// Measure full-frame cost via CDP-driven zoom (real input).
const zoomCost = await page.evaluate(async () => {
  const perf = window.__varvePerf;
  if (!perf) return { err: 'no-perf' };
  perf.reset();
  const c = document.querySelector('canvas.editor-canvas__content-layer');
  const rect = c.getBoundingClientRect();
  const samples = [];
  for (let iter = 0; iter < 8; iter++) {
    perf.reset();
    const t0 = performance.now();
    c.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 400,
        clientY: rect.top + 300,
        deltaY: -120,
        deltaX: 0,
        deltaMode: 0,
        ctrlKey: true,
        button: 0,
      }),
    );
    // poll for first frame
    let dt = null;
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline) {
      const f = perf.getFrames(1);
      if (f.length > 0) {
        dt = performance.now() - t0;
        break;
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    if (dt !== null) samples.push(dt);
  }
  return { samples };
});
console.log('wheel->frame latency (zoom):', JSON.stringify(summary(zoomCost.samples ?? [])));

// Wait a moment, then read steady-state frame cost.
await page.waitForTimeout(1200);
const diag = await page.evaluate(() => {
  const f = window.__varvePerf ? window.__varvePerf.getFrames(80) : [];
  return {
    total: f.map((x) => x.totalMs),
    build: f.map((x) => x.buildIrMs),
    replay: f.map((x) => x.replayMs),
    hash: f.map((x) => x.hashMs ?? 0),
    other: f.map((x) => x.totalMs - x.buildIrMs - x.replayMs - (x.hashMs ?? 0)),
    nodeCount: f.length ? f[f.length - 1].nodeCount : -1,
    culled: f.length ? f[f.length - 1].culledCount : -1,
    cacheEntries: f.length ? f[f.length - 1].cacheEntries : -1,
    renderPath: f.length ? f[f.length - 1].renderPath : 'none',
    partial: f.length ? f[f.length - 1].partialRedraw : false,
  };
});
console.log(
  '\nSTEADY-STATE frame cost at',
  diag.nodeCount,
  'nodes (path:',
  diag.renderPath,
  'partial:',
  diag.partial,
  '):',
);
console.log('  totalMs ', JSON.stringify(summary(diag.total)));
console.log('  buildIrMs', JSON.stringify(summary(diag.build)));
console.log('  replayMs ', JSON.stringify(summary(diag.replay)));
console.log('  hashMs   ', JSON.stringify(summary(diag.hash)));
console.log('  otherMs  ', JSON.stringify(summary(diag.other)));
console.log('  culled:', diag.culled, 'cacheEntries:', diag.cacheEntries);

// Measure a real drag via CDP on the canvas.
console.log('\nDRAG via CDP...');
await page.keyboard.press('v');
await page.waitForTimeout(200);
const dragStart = Date.now();
const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
await page.mouse.move(box.x + 100, box.y + 100);
await page.mouse.down();
for (let i = 0; i < 20; i++) {
  await page.mouse.move(box.x + 100 + i * 6, box.y + 100 + i * 5);
  await page.waitForTimeout(8);
}
await page.mouse.up();
const dragMs = Date.now() - dragStart;
console.log('drag total (CDP round-trip dominated):', dragMs, 'ms');
await page.waitForTimeout(500);
const diag2 = await page.evaluate(() => {
  const f = window.__varvePerf ? window.__varvePerf.getFrames(40) : [];
  return { total: f.map((x) => x.totalMs) };
});
console.log('post-drag frame totalMs:', JSON.stringify(summary(diag2.total)));
console.log('ERRS:', errs.slice(0, 4));
await browser.close();
