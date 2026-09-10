/* Real-browser render-path benchmark: measures actual Canvas2D rasterization
 * via the visual harness (visual-harness.html) at 100/1k/10k/50k items.
 * Fills the jsdom-replay gap from renderPath.bench.ts — here the browser
 * actually paints pixels.
 *
 * Usage:
 *   node scripts/perf/bench-replay-browser.mjs            # run + print
 *   node scripts/perf/bench-replay-browser.mjs --ci      # fail vs .replay-browser-baseline.json
 *   node scripts/perf/bench-replay-browser.mjs --update  # write new baseline
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const ROOT = new URL('../../', import.meta.url).pathname;
const BASE = 'http://localhost:1430';
const BASELINE_PATH = `${ROOT}.replay-browser-baseline.json`;
const args = process.argv.slice(2);
const CI = args.includes('--ci');
const UPDATE = args.includes('--update');
const HEADROOM = 1.5;

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i] ?? 0;
}
function summarize(samples) {
  const s = [...samples].sort((a, b) => a - b);
  return {
    p50: +pct(s, 50).toFixed(3),
    p95: +pct(s, 95).toFixed(3),
    p99: +pct(s, 99).toFixed(3),
    min: +(s[0] ?? 0).toFixed(3),
    max: +(s[s.length - 1] ?? 0).toFixed(3),
    n: s.length,
  };
}

// Build a fixture of N rects spread over a large world space (so 50k items
// aren't all offscreen-cleared — the harness draws all of them).
function makeRects(count) {
  const cols = Math.ceil(Math.sqrt(count));
  const items = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    items.push({
      transform: [1, 0, 0, 1, (col % 100) * 96, (row % 100) * 96],
      fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
      primitive: { kind: 'rect', x: 8, y: 8, w: 64, h: 64 },
      opacity: 1,
      blendMode: 'normal',
      strokes: [],
      effects: [],
    });
  }
  return items;
}

void makeRects;

const browser = await chromium.launch({ headless: true, args: ['--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`${BASE}/visual-harness.html`, { timeout: 60000, waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__harnessReady === true, { timeout: 20000 });

const TIERS = [100, 1_000, 10_000, 50_000];
const results = { measuredAt: new Date().toISOString(), tiers: {} };

// Control: fixed-cost loop measured in the browser process (jsdom-style cost
// baseline, mirrors audit-render-perf.mjs).
const control = await page.evaluate(() => {
  const samples = [];
  for (let r = 0; r < 3; r++) {
    const t0 = performance.now();
    let acc = 0;
    for (let i = 0; i < 5_000_000; i++) acc += Math.sqrt(i) * 1.0000001;
    if (acc < 0) throw new Error('unreachable');
    samples.push(performance.now() - t0);
  }
  return samples;
});
results.control = summarize(control);

for (const count of TIERS) {
  const _items = makeRects(count);
  const samples = [];
  const iterations = count >= 10_000 ? 3 : 6;
  for (let i = 0; i < iterations; i++) {
    // Pass a compact stub and rebuild inside the page to avoid structured-clone
    // cost dominating the measurement (that cost is input transport, not paint).
    const ms = await page.evaluate(
      ({ count, width, height }) => {
        const cols = Math.ceil(Math.sqrt(count));
        const items = [];
        for (let j = 0; j < count; j++) {
          const col = j % cols;
          const row = Math.floor(j / cols);
          items.push({
            transform: [1, 0, 0, 1, (col % 100) * 96, (row % 100) * 96],
            fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
            primitive: { kind: 'rect', x: 8, y: 8, w: 64, h: 64 },
            opacity: 1,
            blendMode: 'normal',
            strokes: [],
            effects: [],
          });
        }
        const t0 = performance.now();
        window.__renderFixture(items, width, height);
        return performance.now() - t0;
      },
      { count, width: 1920, height: 1080 },
    );
    samples.push(ms);
  }
  const s = summarize(samples);
  results.tiers[String(count)] = s;
  console.log(`[replay-browser] ${count} items: p50=${s.p50}ms p95=${s.p95}ms p99=${s.p99}ms`);
}

writeFileSync(`${ROOT}.replay-browser-results.json`, `${JSON.stringify(results, null, 2)}\n`);
console.log(`\ncontrol p50=${results.control.p50}ms`);

const ratios = {};
for (const [tier, s] of Object.entries(results.tiers)) {
  ratios[tier] = +(s.p50 / results.control.p50).toFixed(4);
}
console.log('ratios:', JSON.stringify(ratios));

if (UPDATE) {
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({ version: new Date().toISOString().slice(0, 10), ratios, controlMs: results.control.p50 }, null, 2)}\n`,
  );
  console.log('baseline updated ->', BASELINE_PATH);
}

if (CI) {
  if (!existsSync(BASELINE_PATH)) {
    console.error('no baseline; run --update first');
    process.exit(1);
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
  let failed = false;
  for (const [tier, ratio] of Object.entries(ratios)) {
    const base = baseline.ratios[tier];
    if (base === undefined) continue;
    if (ratio > base * HEADROOM) {
      console.error(`FAIL: ${tier} items ratio ${ratio} > baseline ${base} * ${HEADROOM}`);
      failed = true;
    }
  }
  process.exit(failed ? 1 : 0);
}

await browser.close();
