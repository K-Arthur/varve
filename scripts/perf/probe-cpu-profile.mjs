/* Interaction latency + frame cost probe using real CDP input and the
 * diagnostics ring buffer. Usage: node scripts/perf/probe-interaction.mjs */
import { chromium } from '@playwright/test';

// STRATA_PERF_URL lets the same probe run against a production build
// (vite preview) as well as the dev server — the dev/prod comparison is the
// point, since React dev-mode overhead dominates dev-build drag profiles.
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
for (let guard = 0; guard < 8; guard++) {
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(25);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(60);
}
const nodeCount = await readCount();
await page.waitForTimeout(800);
console.log('NODES:', nodeCount);

// ── CPU profile of a real drag ───────────────────────────────────────────────
// Locates frame cost by function self-time rather than by phase timers, which
// only bound cost to a code *region*. Run this when a phase breakdown shows a
// large unattributed remainder.
const client = await context.newCDPSession(page);
await client.send('Profiler.enable');
await client.send('Profiler.setSamplingInterval', { interval: 200 });

await page.keyboard.press('v');
await page.waitForTimeout(200);
await page.mouse.click(box.x + 100, box.y + 90);
await page.waitForTimeout(300);

await client.send('Profiler.start');
await page.mouse.move(box.x + 100, box.y + 90);
await page.mouse.down();
for (let i = 0; i < 20; i++) {
  await page.mouse.move(box.x + 100 + i * 5, box.y + 90 + i * 4);
  await page.waitForTimeout(8);
}
await page.mouse.up();
await page.waitForTimeout(400);
const { profile } = await client.send('Profiler.stop');

// Aggregate self time per (function, file:line).
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const total = profile.samples?.length ?? 0;
const durationMs = (profile.endTime - profile.startTime) / 1000;
for (const sampleId of profile.samples ?? []) {
  const node = byId.get(sampleId);
  if (!node) continue;
  const cf = node.callFrame;
  const name = cf.functionName || '(anonymous)';
  const loc = `${(cf.url || '').replace(/^https?:\/\/[^/]+/, '').split('?')[0]}:${cf.lineNumber + 1}`;
  const key = `${name} @ ${loc}`;
  self.set(key, (self.get(key) ?? 0) + 1);
}
// Attribute a named function's samples to its callers. Self-time alone says
// what is expensive; this says who is asking for it, which is what a fix has
// to target. Usage: node scripts/perf/probe-cpu-profile.mjs --callers=fnName
const wanted = process.argv.find((a) => a.startsWith('--callers='))?.split('=')[1];
if (wanted) {
  const parentOf = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parentOf.set(c, n.id);
  const callers = new Map();
  for (const sampleId of profile.samples ?? []) {
    const node = byId.get(sampleId);
    if (node?.callFrame.functionName !== wanted) continue;
    // Walk up past recursive self-frames to the first different function.
    let cur = parentOf.get(node.id);
    while (cur && byId.get(cur)?.callFrame.functionName === wanted) cur = parentOf.get(cur);
    const cf = byId.get(cur)?.callFrame;
    const key = cf
      ? `${cf.functionName || '(anonymous)'} @ ${(cf.url || '').replace(/^https?:\/\/[^/]+/, '').split('?')[0]}:${cf.lineNumber + 1}`
      : '(root)';
    callers.set(key, (callers.get(key) ?? 0) + 1);
  }
  console.log(`\nCALLERS of ${wanted}:`);
  for (const [k, c] of [...callers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(
      `${((c / total) * durationMs).toFixed(0).padStart(6)}ms  ${((c / total) * 100).toFixed(1).padStart(5)}%  ${k}`,
    );
  }
}

const ranked = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
console.log(`\nCPU PROFILE — ${durationMs.toFixed(0)}ms wall, ${total} samples\n`);
for (const [key, count] of ranked) {
  const ms = (count / total) * durationMs;
  console.log(
    `${ms.toFixed(0).padStart(6)}ms  ${((count / total) * 100).toFixed(1).padStart(5)}%  ${key}`,
  );
}
console.log('\nERRS:', errs.slice(0, 3));
await browser.close();
