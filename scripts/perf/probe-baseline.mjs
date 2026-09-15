/* Baseline probe: real-browser canvas frame timing via Playwright. */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:1430';
const NODES = process.env.NODES ? Number(process.env.NODES) : 200;

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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let lastLongTaskCount = 0;

// Instrument frame timing BEFORE navigation so no rAF is missed.
await page.addInitScript(() => {
  window.__frameTimes = [];
  window.__longTasks = [];
  const push = (cb) => (t) => {
    const _now = performance.now();
    if (window.__frameTimes.length) {
      window.__frameTimes.push(t - window.__frameTimes._last);
    } else {
      window.__frameTimes.push(0);
    }
    window.__frameTimes._last = t;
    cb(t);
  };
  const origRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => origRaf(push(cb));
  if (typeof PerformanceObserver !== 'undefined') {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__longTasks.push({ dur: entry.duration, start: entry.startTime });
      }
    });
    try {
      po.observe({ entryTypes: ['longtask'] });
    } catch {}
  }
});

await page.goto(`${BASE}/?perf=1`, { timeout: 90000, waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30000 });
await page
  .waitForFunction(
    () => {
      const s = document.querySelector('.startup-loader');
      return s?.getAttribute('aria-busy') !== 'true';
    },
    { timeout: 30000 },
  )
  .catch(() => {});
await page.getByRole('button', { name: /^new$/i }).click({ force: true, timeout: 20000 });
await page.waitForTimeout(1500);
const createBtn = page.getByRole('button', { name: /^create$/i }).first();
await createBtn.waitFor({ state: 'visible', timeout: 15000 });
await createBtn.click({ force: true, timeout: 15000 });
await page.locator('.layers-panel').waitFor({ timeout: 20000 });
// Close any dialogs
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

// Dismiss welcome / get-started
const welcome = page
  .locator('dialog')
  .getByRole('button', { name: /blank canvas|close|get started/i })
  .first();
if (await welcome.isVisible({ timeout: 2000 }).catch(() => false)) {
  await welcome.click({ force: true });
}
const dismiss = page.locator('.onboarding-checklist__dismiss');
if (await dismiss.isVisible({ timeout: 1000 }).catch(() => false)) {
  await dismiss.click({ force: true });
}
await page.waitForTimeout(500);

const canvas = page.locator('canvas.editor-canvas__content-layer');
await canvas.waitFor({ state: 'visible', timeout: 15000 });

// Build N rects through the public UI: rect tool + drag.
const box = await canvas.boundingBox();
const t0 = Date.now();
for (let i = 0; i < NODES; i++) {
  const col = i % 40;
  const row = Math.floor(i / 40);
  const x1 = box.x + 40 + col * 60;
  const y1 = box.y + 40 + row * 60;
  await page.keyboard.press('r');
  await page.waitForTimeout(40);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 40, y1 + 36);
  await page.mouse.up();
  await page.waitForTimeout(20);
}
const buildMs = Date.now() - t0;
await page.waitForTimeout(1000);

async function measureInteraction(name, action, settleMs = 400) {
  await page.evaluate(() => {
    window.__frameTimes.length = 0;
    window.__frameTimes._last = undefined;
    if (window.__varvePerf) window.__varvePerf.reset();
  });
  const before = await page.evaluate(() => ({
    heap: performance.memory ? performance.memory.usedJSHeapSize : 0,
  }));
  await action();
  await page.waitForTimeout(settleMs);
  const result = await page.evaluate(() => ({
    frames: [...window.__frameTimes],
    longTasks: [...window.__longTasks],
    heap: performance.memory ? performance.memory.usedJSHeapSize : 0,
    perfFrames: window.__varvePerf ? window.__varvePerf.getFrames(200) : [],
  }));
  const frames = result.frames.filter((f) => f > 0 && f < 500);
  const interactive = frames.filter((f) => f <= 100);
  console.log(`\n== ${name} ==`);
  console.log(`  rAF frames: ${frames.length}  frame-times ${JSON.stringify(summary(frames))}`);
  console.log(
    `  dropped(>16.7ms): ${frames.filter((f) => f > 16.7).length}  (>33ms): ${frames.filter((f) => f > 33).length}  (>100ms): ${frames.filter((f) => f > 100).length}`,
  );
  console.log(
    `  longTasks: ${result.longTasks.length} (new since last: ${result.longTasks.length - lastLongTaskCount})`,
  );
  lastLongTaskCount = result.longTasks.length;
  console.log(`  heap delta: ${((result.heap - before.heap) / 1048576).toFixed(1)} MB`);
  let total = [];
  if (result.perfFrames.length) {
    total = result.perfFrames.map((f) => f.totalMs);
    const build = result.perfFrames.map((f) => f.buildIrMs);
    const replay = result.perfFrames.map((f) => f.replayMs);
    const hash = result.perfFrames.map((f) => f.hashMs ?? 0);
    const other = result.perfFrames.map(
      (f, _i) => f.totalMs - f.buildIrMs - f.replayMs - (f.hashMs ?? 0),
    );
    console.log(`  APP totalMs: ${JSON.stringify(summary(total))}`);
    console.log(`    buildIrMs: ${JSON.stringify(summary(build))}`);
    console.log(`    replayMs:  ${JSON.stringify(summary(replay))}`);
    console.log(`    hashMs:    ${JSON.stringify(summary(hash))}`);
    console.log(`    otherMs:   ${JSON.stringify(summary(other))}`);
    const last = result.perfFrames[result.perfFrames.length - 1];
    if (last) {
      console.log(
        `    last: nodes=${last.nodeCount} culled=${last.culledCount} cacheHits=${last.cacheHitCount} path=${last.renderPath} partial=${last.partialRedraw} tier=${last.profileTier} cacheEntries=${last.cacheEntries} cacheKB=${(last.cacheBytes / 1024).toFixed(0)}`,
      );
    }
  } else {
    console.log('  APP perfFrames: none recorded');
  }
  return { interactive: summary(interactive), total: summary(total ?? []) };
}

// Pan via space+drag
await measureInteraction('PAN (space+drag)', async () => {
  await page.keyboard.down('Space');
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  for (let i = 0; i < 30; i++) {
    await page.mouse.move(box.x + 300 + i * 8, box.y + 300 + i * 5, { steps: 1 });
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  await page.keyboard.up('Space');
});

// Zoom via wheel
await measureInteraction('ZOOM (ctrl+wheel)', async () => {
  const c = await canvas.boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(8);
  }
});

// Drag a shape
await measureInteraction('DRAG (select+move)', async () => {
  await page.keyboard.press('v');
  await page.mouse.click(box.x + 100, box.y + 100);
  await page.waitForTimeout(200);
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  for (let i = 0; i < 25; i++) {
    await page.mouse.move(box.x + 100 + i * 8, box.y + 100 + i * 6, { steps: 1 });
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
});

console.log(`\nBUILD ${NODES} rects: ${buildMs}ms`);
await browser.close();
