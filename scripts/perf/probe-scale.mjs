/* In-app canvas scaling probe: builds N nodes, then measures steady-state
 * frame cost (diagnostics ring) and interaction response using real CDP input.
 * Usage: node scripts/perf/probe-scale.mjs [nodeCount] */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:1430/?perf=1';
const TARGET = Number(process.argv[2] ?? process.env.NODES ?? '200');

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

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
page.on('crash', () => errs.push('[page-crash]'));
browser.on('disconnected', () => errs.push('[browser-disconnected]'));

await page.goto(BASE, { timeout: 90000, waitUntil: 'domcontentloaded' });
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

// Seed 8 rects in a grid (distinct positions).
for (let i = 0; i < 8; i++) {
  const col = i % 4;
  const row = Math.floor(i / 4);
  await page.keyboard.press('r');
  await page.waitForTimeout(50);
  await page.mouse.move(box.x + 40 + col * 120, box.y + 40 + row * 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 100 + col * 120, box.y + 90 + row * 120);
  await page.mouse.up();
  await page.waitForTimeout(30);
}
// Duplicate to target via Ctrl+D.
let count = await page.evaluate(() => document.querySelectorAll('[role=treeitem]').length);
await page.keyboard.press('a');
await page.waitForTimeout(150);
let guard = 0;
while (count < TARGET && guard < 500) {
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(25);
  count = await page.evaluate(() => document.querySelectorAll('[role=treeitem]').length);
  guard++;
}
console.log('NODES:', count, 'dups:', guard, 'ERRS:', errs.slice(0, 2));
await page.waitForTimeout(1500);

// Steady-state frame cost (idle redraws).
await page.waitForTimeout(800);
const idle = await page.evaluate(() => {
  const f = window.__varvePerf ? window.__varvePerf.getFrames(60) : [];
  return {
    total: f.map((x) => x.totalMs),
    build: f.map((x) => x.buildIrMs),
    replay: f.map((x) => x.replayMs),
    hash: f.map((x) => x.hashMs ?? 0),
    other: f.map((x) => x.totalMs - x.buildIrMs - x.replayMs - (x.hashMs ?? 0)),
    nodeCount: f.length ? f[f.length - 1].nodeCount : -1,
    culled: f.length ? f[f.length - 1].culledCount : -1,
    cacheHits: f.length ? f[f.length - 1].cacheHitCount : -1,
    cacheEntries: f.length ? f[f.length - 1].cacheEntries : -1,
    path: f.length ? f[f.length - 1].renderPath : 'none',
  };
});
console.log('IDLE frame cost at', idle.nodeCount, 'nodes (path:', idle.path, '):');
console.log('  totalMs ', JSON.stringify(summary(idle.total)));
console.log('  buildIrMs', JSON.stringify(summary(idle.build)));
console.log('  replayMs ', JSON.stringify(summary(idle.replay)));
console.log('  hashMs   ', JSON.stringify(summary(idle.hash)));
console.log('  otherMs  ', JSON.stringify(summary(idle.other)));

// Zoom interaction via real CDP wheel.
const zoom = await page.evaluate(async () => {
  const perf = window.__varvePerf;
  if (!perf) return { err: 'no-perf' };
  const c = document.querySelector('canvas.editor-canvas__content-layer');
  const rect = c.getBoundingClientRect();
  perf.reset();
  const samples = [];
  for (let iter = 0; iter < 10; iter++) {
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
    let dt = null;
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      if (perf.getFrames(1).length > 0) {
        dt = performance.now() - t0;
        break;
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    if (dt !== null) samples.push(dt);
  }
  const f = perf.getFrames(60);
  return {
    samples,
    frameTotal: f.map((x) => x.totalMs),
    build: f.map((x) => x.buildIrMs),
    replay: f.map((x) => x.replayMs),
    hash: f.map((x) => x.hashMs ?? 0),
  };
});
console.log('\nZOOM wheel->frame latency:', JSON.stringify(summary(zoom.samples ?? [])));
if (zoom.frameTotal) {
  console.log('ZOOM frame totalMs ', JSON.stringify(summary(zoom.frameTotal)));
  console.log('ZOOM buildIrMs     ', JSON.stringify(summary(zoom.build)));
  console.log('ZOOM replayMs      ', JSON.stringify(summary(zoom.replay)));
  console.log('ZOOM hashMs        ', JSON.stringify(summary(zoom.hash)));
}

// Pan via CDP drag (space+move).
console.log('\nPAN via CDP drag...');
await page.evaluate(async () => {
  const perf = window.__varvePerf;
  if (perf) perf.reset();
});
const panStart = Date.now();
await page.keyboard.down('Space');
await page.mouse.move(box.x + 400, box.y + 400);
await page.mouse.down();
for (let i = 0; i < 25; i++) {
  await page.mouse.move(box.x + 400 - i * 8, box.y + 400 - i * 5);
  await page.waitForTimeout(8);
}
await page.mouse.up();
await page.keyboard.up('Space');
const panMs = Date.now() - panStart;
await page.waitForTimeout(600);
const panDiag = await page.evaluate(() => {
  const f = window.__varvePerf ? window.__varvePerf.getFrames(40) : [];
  return {
    total: f.map((x) => x.totalMs),
    build: f.map((x) => x.buildIrMs),
    replay: f.map((x) => x.replayMs),
    hash: f.map((x) => x.hashMs ?? 0),
  };
});
console.log('pan wall-clock (CDP-dominated):', panMs, 'ms');
console.log('PAN frame totalMs ', JSON.stringify(summary(panDiag.total)));
console.log('PAN frame buildIrMs', JSON.stringify(summary(panDiag.build)));
console.log('PAN frame replayMs ', JSON.stringify(summary(panDiag.replay)));
console.log('PAN frame hashMs   ', JSON.stringify(summary(panDiag.hash)));
console.log('ERRS:', errs.slice(0, 3));
await browser.close();
