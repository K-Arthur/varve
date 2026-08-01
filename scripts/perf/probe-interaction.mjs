/* In-app interaction comparison: canvas frame cost (via diagnostics ring)
 * vs DOM panel update cost (via rAF-bound MutationObserver) during synthetic
 * in-page interactions. No CDP input — synthetic PointerEvents dispatched
 * directly, so we measure app latency, not transport. */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:1430/?perf=1';
const DEBUG_URL = true;

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

const browser = await chromium.launch({ headless: true, args: ['--disable-gpu-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
page.on('crash', () => errs.push('[page-crash]'));
browser.on('disconnected', () => errs.push('[browser-disconnected]'));
const cdp = await context.newCDPSession(page);
cdp.on('Inspector.targetCrashed', (p) => errs.push('[cdp-targetCrashed] ' + JSON.stringify(p)));
try {
  await cdp.send('Target.setDiscoverTargets', { discover: true });
} catch {}

await page.goto(BASE, { timeout: 90000, waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /^new$/i }).click({ force: true, timeout: 30000 });
await page.waitForTimeout(1500);
const createBtn = page.getByRole('button', { name: /^create$/i }).first();
await createBtn.click({ force: true, timeout: 15000 });
await page.locator('.layers-panel').waitFor({ timeout: 20000 });
console.log('URL after create:', page.url());
const handleCheck = await page.evaluate(() => ({
  search: window.location.search,
  hasPerf: !!window.__strataPerf,
  keys: Object.keys(window)
    .filter((k) => k.startsWith('__'))
    .slice(0, 10),
}));
console.log('HANDLE CHECK:', JSON.stringify(handleCheck));
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

// Build a moderate doc: 12 rects in a grid (each at a distinct location so
// draws don't select existing shapes).
for (let i = 0; i < 12; i++) {
  const col = i % 4;
  const row = Math.floor(i / 4);
  try {
    await page.keyboard.press('r');
    await page.waitForTimeout(60);
    await page.mouse.move(box.x + 40 + col * 130, box.y + 40 + row * 130);
    await page.mouse.down();
    await page.mouse.move(box.x + 110 + col * 130, box.y + 100 + row * 130);
    await page.mouse.up();
    await page.waitForTimeout(40);
  } catch (e) {
    console.log('CRASH during draw', i, 'errs:', errs.slice(0, 4));
    throw e;
  }
}
const nodeCount = await page.evaluate(() => document.querySelectorAll('[role=treeitem]').length);
await page.waitForTimeout(800);
console.log('NODES:', nodeCount);

// Measure canvas interaction latency: dispatch pointermove streams in-page,
// measure pointer->frame (diagnostics ring) and pointer->DOM mutation.
const canvasLat = await page.evaluate(async () => {
  const perf = window.__strataPerf;
  const c = document.querySelector('canvas.editor-canvas__content-layer');
  if (!perf) return { samples: [], err: 'no-perf', hasPerf: false };
  if (!c) return { samples: [], err: 'no-canvas' };
  const rect = c.getBoundingClientRect();
  const samples = [];
  for (let iter = 0; iter < 30; iter++) {
    perf.reset();
    const t0 = performance.now();
    let frames = 0;
    const x = rect.left + 200 + iter * 3;
    const y = rect.top + 200 + iter * 2;
    // Stream pointermove like a drag would, one per rAF tick.
    const step = () => {
      c.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: x,
          clientY: y,
          pointerType: 'mouse',
        }),
      );
      if (perf.getFrames(1).length > 0) frames++;
    };
    step();
    // Wait for the frame pipeline to react (poll a few rAFs).
    for (let k = 0; k < 5; k++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (perf.getFrames(1).length > 0) frames++;
    }
    if (frames > 0) samples.push(performance.now() - t0);
  }
  return { samples, hasPerf: true, enabled: perf.isEnabled() };
});
console.log(
  '\ncanvas pointer->frame latency (in-page):',
  JSON.stringify(canvasLat),
  JSON.stringify(summary(canvasLat.samples ?? [])),
);

// Measure panel (LayersPanel) update latency: trigger a selection change,
// measure time from dispatch to a layers-row DOM mutation commit.
const panelLat = await page.evaluate(async () => {
  const c = document.querySelector('canvas.editor-canvas__content-layer');
  const rect = c.getBoundingClientRect();
  const rows = document.querySelectorAll('[role=treeitem]');
  const samples = [];
  for (let iter = 0; iter < 15; iter++) {
    const row = rows[0];
    const rowRect = row.getBoundingClientRect();
    const t0 = performance.now();
    let committed = null;
    const mo = new MutationObserver(() => {
      if (committed === null) committed = performance.now() - t0;
    });
    mo.observe(row, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['data-selected', 'aria-selected', 'class'],
    });
    c.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: rect.left + 100 + iter * 5,
        clientY: rect.top + 100,
        pointerType: 'mouse',
      }),
    );
    c.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        clientX: rect.left + 100 + iter * 5,
        clientY: rect.top + 100,
        pointerType: 'mouse',
      }),
    );
    for (let k = 0; k < 10; k++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (committed !== null) break;
    }
    mo.disconnect();
    if (committed !== null) samples.push(committed);
  }
  return { samples };
});
console.log('panel (layers row) update latency:', JSON.stringify(summary(panelLat.samples ?? [])));

// Frame cost during a pan: dispatch wheel ctrl to zoom a few times, read ring.
await page.evaluate(async () => {
  const c = document.querySelector('canvas.editor-canvas__content-layer');
  const rect = c.getBoundingClientRect();
  for (let i = 0; i < 8; i++) {
    c.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        clientX: rect.left + 400,
        clientY: rect.top + 300,
        deltaY: -120,
        ctrlKey: true,
      }),
    );
    await new Promise((r) => requestAnimationFrame(r));
  }
});
await page.waitForTimeout(600);
const diag = await page.evaluate(() => {
  const f = window.__strataPerf ? window.__strataPerf.getFrames(40) : [];
  return {
    total: f.map((x) => x.totalMs),
    build: f.map((x) => x.buildIrMs),
    replay: f.map((x) => x.replayMs),
    hash: f.map((x) => x.hashMs ?? 0),
    nodes: f.length ? f[f.length - 1].nodeCount : -1,
    path: f.length ? f[f.length - 1].renderPath : 'none',
  };
});
console.log('\nzoom frame cost at', diag.nodes, 'nodes:');
console.log('  totalMs', JSON.stringify(summary(diag.total)));
console.log('  buildIrMs', JSON.stringify(summary(diag.build)));
console.log('  replayMs', JSON.stringify(summary(diag.replay)));
console.log('  hashMs', JSON.stringify(summary(diag.hash)));
console.log('ERRS:', errs.slice(0, 3));
await browser.close();
