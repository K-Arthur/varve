/* In-page interaction-latency probe: measures pointer-event -> paint latency
 * directly inside the page (no CDP input overhead) using the app's own
 * diagnostics ring buffer as the paint-commit signal. */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:1430/?perf=1';
const TARGET_NODES = Number(process.env.NODES || 256);

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
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 400)));
browser.on('disconnected', () => errs.push('[browser-disconnected]'));
page.on('crash', () => errs.push('[page-crash]'));

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

// Seed a handful, then duplicate to reach TARGET_NODES quickly.
for (let i = 0; i < 8; i++) {
  const col = i % 4;
  const row = Math.floor(i / 4);
  await page.keyboard.press('r');
  await page.waitForTimeout(100);
  await page.mouse.move(box.x + 60 + col * 80, box.y + 60 + row * 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 100 + col * 80, box.y + 90 + row * 80);
  await page.mouse.up();
  await page.waitForTimeout(100);
}
await page.keyboard.press('a'); // select all
await page.waitForTimeout(150);
let iter = 0;
while (true) {
  let count;
  try {
    count = await page.evaluate(() => document.querySelectorAll('[role=treeitem]').length);
  } catch (e) {
    console.log('CRASH at iter', iter, 'errs:', errs.slice(0, 4));
    throw e;
  }
  if (count >= TARGET_NODES) break;
  try {
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(120);
  } catch (e) {
    console.log('CRASH during dup iter', iter, 'at count', count, 'errs:', errs.slice(0, 5));
    throw e;
  }
  iter++;
}
const nodeCount = await page.evaluate(() => document.querySelectorAll('[role=treeitem]').length);
await page.waitForTimeout(1200);
console.log('NODES after build:', nodeCount, 'ERRS:', errs.slice(0, 3));
process.exitCode = 1;

// In-page latency measurement: dispatch a pointermove, poll diagnostics ring
// for a NEW frame, measure the gap. Run several iterations.
const latency = await page.evaluate(
  async (startXY) => {
    const perf = window.__strataPerf;
    const canvas = document.querySelector('canvas.editor-canvas__content-layer');
    if (!perf || !canvas) return { err: 'no handle/canvas' };
    const rect = canvas.getBoundingClientRect();
    const samples = [];
    for (let iter = 0; iter < 20; iter++) {
      perf.reset();
      const cx = rect.left + startXY[0] + (iter % 5) * 10;
      const cy = rect.top + startXY[1] + Math.floor(iter / 5) * 10;
      const t0 = performance.now();
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: cx,
          clientY: cy,
          pointerType: 'mouse',
        }),
      );
      // Poll at rAF rate for the first recorded frame.
      let dt = null;
      const pollStart = performance.now();
      while (performance.now() - pollStart < 250) {
        const frames = perf.getFrames(1);
        if (frames.length > 0) {
          dt = performance.now() - t0;
          break;
        }
        await new Promise((r) => requestAnimationFrame(r));
      }
      if (dt !== null) samples.push(dt);
    }
    return { samples };
  },
  [200, 200],
);

console.log('pointermove->frame latency:', JSON.stringify(summary(latency.samples ?? [])));

// Now a real drag inside the page: pointerdown + series of pointermove.
const dragLatency = await page.evaluate(
  async (startXY) => {
    const perf = window.__strataPerf;
    const canvas = document.querySelector('canvas.editor-canvas__content-layer');
    if (!perf || !canvas) return { err: 'no handle/canvas' };
    const rect = canvas.getBoundingClientRect();
    const samples = [];
    for (let iter = 0; iter < 10; iter++) {
      perf.reset();
      const sx = rect.left + startXY[0] + iter * 6;
      const sy = rect.top + startXY[1];
      const ev = (type, x, y) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            clientX: x,
            clientY: y,
            pointerType: 'mouse',
            buttons: type === 'pointerup' ? 0 : 1,
          }),
        );
      ev('pointerdown', sx, sy);
      const t0 = performance.now();
      let firstFrame = null;
      let lastFrame = null;
      const pollStart = performance.now();
      let step = 0;
      while (performance.now() - pollStart < 300) {
        if (step % 2 === 0) {
          ev('pointermove', sx + step * 2, sy + step);
        }
        const frames = perf.getFrames(1);
        if (frames.length > 0) {
          if (firstFrame === null) firstFrame = performance.now() - t0;
          lastFrame = performance.now() - t0;
        }
        step++;
        await new Promise((r) => requestAnimationFrame(r));
      }
      ev('pointerup', sx + step * 2, sy + step);
      if (firstFrame !== null) samples.push(firstFrame);
    }
    return { samples };
  },
  [220, 300],
);

console.log('drag first-frame latency:', JSON.stringify(summary(dragLatency.samples ?? [])));

// Pan via wheel: measure time to first frame after wheel event.
const wheelLatency = await page.evaluate(async () => {
  const perf = window.__strataPerf;
  const canvas = document.querySelector('canvas.editor-canvas__content-layer');
  if (!perf || !canvas) return { err: 'no handle/canvas' };
  const rect = canvas.getBoundingClientRect();
  const samples = [];
  for (let iter = 0; iter < 12; iter++) {
    perf.reset();
    const t0 = performance.now();
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        clientX: rect.left + 400,
        clientY: rect.top + 300,
        deltaY: -120 * iter,
        ctrlKey: true,
      }),
    );
    let dt = null;
    const pollStart = performance.now();
    while (performance.now() - pollStart < 250) {
      if (perf.getFrames(1).length > 0) {
        dt = performance.now() - t0;
        break;
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    if (dt !== null) samples.push(dt);
  }
  return { samples };
});
console.log('wheel->frame latency:', JSON.stringify(summary(wheelLatency.samples ?? [])));

// Frame cost at this scale: read the ring after a settled idle.
const diag = await page.evaluate(() => {
  const frames = window.__strataPerf ? window.__strataPerf.getFrames(60) : [];
  return {
    total: frames.map((f) => f.totalMs),
    build: frames.map((f) => f.buildIrMs),
    replay: frames.map((f) => f.replayMs),
    hash: frames.map((f) => f.hashMs ?? 0),
    nodeCount: frames.length ? frames[frames.length - 1].nodeCount : 0,
    culled: frames.length ? frames[frames.length - 1].culledCount : 0,
    cacheEntries: frames.length ? frames[frames.length - 1].cacheEntries : 0,
    renderPath: frames.length ? frames[frames.length - 1].renderPath : 'none',
  };
});
console.log('settled frame cost at', nodeCount, 'nodes:');
console.log('  totalMs', JSON.stringify(summary(diag.total)));
console.log('  buildIrMs', JSON.stringify(summary(diag.build)));
console.log('  replayMs', JSON.stringify(summary(diag.replay)));
console.log('  hashMs', JSON.stringify(summary(diag.hash)));
console.log(
  '  last nodeCount:',
  diag.nodeCount,
  'culled:',
  diag.culled,
  'cache:',
  diag.cacheEntries,
  'path:',
  diag.renderPath,
);
console.log('ERRS:', errs.slice(0, 3));
await browser.close();
