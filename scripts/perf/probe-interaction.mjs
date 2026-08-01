/* Interaction latency + frame cost probe using real CDP input and the
 * diagnostics ring buffer. Usage: node scripts/perf/probe-interaction.mjs */
import { chromium } from '@playwright/test';

// STRATA_PERF_URL lets the same probe run against a production build
// (vite preview) as well as the dev server.
const BASE = process.env.STRATA_PERF_URL ?? 'http://localhost:1432/?perf=1';

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
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
page.on('crash', () => errs.push('[page-crash]'));

await page.goto(BASE, { timeout: 90000, waitUntil: 'domcontentloaded' });
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

// Build ~100 nodes.
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
const readCount = () =>
  page.evaluate(() => {
    const f = window.__strataPerf ? window.__strataPerf.getFrames(3) : [];
    return f.length ? f[f.length - 1].nodeCount : 0;
  });
// Each pass doubles the node count (4 rects → 4·2^n). Configurable so the same
// probe can measure the small-document and heavy-document cases, and so dev and
// production runs can be compared at an identical node count — the comparison
// is meaningless otherwise.
const DUPS = Number(process.env.STRATA_PERF_DUPS ?? 5);
for (let guard = 0; guard < DUPS; guard++) {
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(25);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(60);
}
const nodeCount = await readCount();
await page.waitForTimeout(800);
console.log('NODES:', nodeCount);

// Measure frame cost during a real CDP drag of a selected node.
await page.keyboard.press('v');
await page.waitForTimeout(200);
await page.mouse.click(box.x + 100, box.y + 90);
await page.waitForTimeout(300);
await page.evaluate(() => {
  if (window.__strataPerf) window.__strataPerf.reset();
});
await page.mouse.move(box.x + 100, box.y + 90);
await page.mouse.down();
for (let i = 0; i < 20; i++) {
  await page.mouse.move(box.x + 100 + i * 5, box.y + 90 + i * 4);
  await page.waitForTimeout(8);
}
await page.mouse.up();
await page.waitForTimeout(400);
const dragDiag = await page.evaluate(() => {
  const f = window.__strataPerf ? window.__strataPerf.getFrames(120) : [];
  return {
    total: f.map((x) => x.totalMs),
    build: f.map((x) => x.buildIrMs),
    replay: f.map((x) => x.replayMs),
    hash: f.map((x) => x.hashMs ?? 0),
    computes: f.map((x) => x.engineNodeComputes ?? -1),
    hits: f.map((x) => x.engineNodeHits ?? -1),
    nodes: f.map((x) => x.nodeCount),
    setup: f.map((x) => x.setupMs ?? -1),
    preLoop: f.map((x) => x.preLoopMs ?? -1),
    n: f.length,
  };
});
console.log('DRAG frame totalMs:', JSON.stringify(summary(dragDiag.total)), 'n=', dragDiag.n);
console.log('DRAG buildIrMs:    ', JSON.stringify(summary(dragDiag.build)));
console.log('DRAG replayMs:     ', JSON.stringify(summary(dragDiag.replay)));
console.log('DRAG hashMs:       ', JSON.stringify(summary(dragDiag.hash)));
console.log('DRAG setupMs:      ', JSON.stringify(summary(dragDiag.setup)));
console.log('DRAG preLoopMs:    ', JSON.stringify(summary(dragDiag.preLoop)));
const accounted =
  summary(dragDiag.setup).p50 +
  summary(dragDiag.preLoop).p50 +
  summary(dragDiag.hash).p50 +
  summary(dragDiag.build).p50 +
  summary(dragDiag.replay).p50;
console.log(
  `PHASES: accounted p50 ${accounted.toFixed(1)}ms of ${summary(dragDiag.total).p50}ms total` +
    ` → ${(summary(dragDiag.total).p50 - accounted).toFixed(1)}ms post-replay/unattributed`,
);

// Deterministic work counts. Unlike the timings above these do not depend on
// machine load, so they are the reliable signal when the box is contended:
// a drag should re-derive only the node it is moving, not the whole scene.
console.log('DRAG engineNodeComputes:', JSON.stringify(summary(dragDiag.computes)));
console.log('DRAG engineNodeHits:    ', JSON.stringify(summary(dragDiag.hits)));
console.log('DRAG visible nodeCount: ', JSON.stringify(summary(dragDiag.nodes)));
const medNodes = summary(dragDiag.nodes).p50;
const medComputes = summary(dragDiag.computes).p50;
console.log(
  `VERDICT: median ${medComputes} conversions/frame for ${medNodes} visible nodes` +
    (medComputes < 0
      ? ' — counter absent (old build?)'
      : medNodes > 0 && medComputes <= Math.max(4, medNodes * 0.05)
        ? ' — memo effective'
        : ' — MEMO DEFEATED'),
);
console.log('ERRS:', errs.slice(0, 3));
await browser.close();
