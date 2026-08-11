#!/usr/bin/env node
/**
 * Render-path performance ratchet, ratio-based (not absolute wall-clock).
 *
 * CI machines are noisy. A raw "full-frame render must be under Xms" gate
 * produces false failures whenever the runner is busy — exactly the failure
 * mode already found in this repo's own benchmark suite (see
 * docs/quality/test-reality.md §4: `replay bench 100 rects — replay under
 * 50ms p95` flaked under contention in this very audit). Instead, this
 * script runs the render-path benchmarks AND a fixed-cost control loop in
 * the same process, and gates on the RATIO of each render-path metric to
 * the control — a ratio stays stable even when the machine itself is fast
 * or slow that day, because both numerator and denominator move together.
 *
 * Usage:
 *   node scripts/audit-render-perf.mjs           # run + report ratios
 *   node scripts/audit-render-perf.mjs --ci       # fail on ratio regression vs baseline
 *   node scripts/audit-render-perf.mjs --update   # write current ratios as the new baseline
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const RESULTS_PATH = `${ROOT}.render-perf-results.json`;
const BASELINE_PATH = `${ROOT}.render-perf-baseline.json`;
const args = process.argv.slice(2);
const CI_MODE = args.includes('--ci');
const UPDATE = args.includes('--update');
// Headroom multiplier: a ratio has to grow by more than this fraction over
// the baseline ratio to count as a regression. Generous on purpose — see
// module doc.
const HEADROOM = 1.5;

function runBenchmarks() {
  console.log('Running render-path benchmark suite...');
  // The main vitest config excludes `**/*.bench.ts` (so benches never run in
  // `pnpm test`). Use the dedicated bench config, otherwise `vitest run`
  // matches zero files and exits 1. See vitest.bench.config.ts.
  execSync(
    // Vitest 4 removed the 'basic' reporter name (its built-ins are
    // default/minimal/verbose/dot/json/tap/...); 'minimal' is the closest
    // equivalent for a CI perf gate that only needs the summary line.
    'npx vitest run --config vitest.bench.config.ts packages/editor/src/canvas/__benchmarks__/renderPath.bench.ts --reporter=minimal',
    { cwd: ROOT, stdio: 'inherit' },
  );
}

function loadResults() {
  if (!existsSync(RESULTS_PATH)) {
    throw new Error(`${RESULTS_PATH} not found — the benchmark run did not produce results`);
  }
  return JSON.parse(readFileSync(RESULTS_PATH, 'utf-8'));
}

function computeRatios(results) {
  const controlMs = results.control?.p50;
  if (!controlMs || controlMs <= 0) {
    throw new Error('control benchmark p50 missing or zero — cannot compute ratios');
  }
  const ratios = {};
  for (const [tier, data] of Object.entries(results.tiers)) {
    ratios[tier] = {
      fullFrameRatio: data.fullFrame.p50 / controlMs,
      incrementalFrameRatio: data.incrementalFrame.p50 / controlMs,
      panZoomFrameRatio: data.panZoomFrame.p50 / controlMs,
      timeToFirstPaintRatio: data.timeToFirstPaint.p50 / controlMs,
    };
  }
  return ratios;
}

function main() {
  runBenchmarks();
  const results = loadResults();
  const ratios = computeRatios(results);

  console.log('\n═══ Render-path ratios (metric p50 / control p50) ═══');
  for (const [tier, r] of Object.entries(ratios)) {
    console.log(
      `  ${tier} nodes: full-frame=${r.fullFrameRatio.toFixed(2)}x  incremental=${r.incrementalFrameRatio.toFixed(2)}x  pan/zoom=${r.panZoomFrameRatio.toFixed(2)}x  TTFP=${r.timeToFirstPaintRatio.toFixed(2)}x`,
    );
  }

  if (UPDATE) {
    const baseline = {
      version: new Date().toISOString().slice(0, 10),
      note:
        'Ratios of render-path metric p50 to a fixed-cost control-loop p50, measured in the ' +
        'same process. Absolute ms in .render-perf-results.json is informational only — this ' +
        'file is what --ci actually gates on.',
      controlMs: results.control.p50,
      ratios,
      rawResultsSnapshot: results,
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`\naudit-render-perf: baseline written to .render-perf-baseline.json`);
    return;
  }

  if (CI_MODE) {
    if (!existsSync(BASELINE_PATH)) {
      console.error(
        'audit-render-perf: no .render-perf-baseline.json found. Run with --update once to create it.',
      );
      process.exit(1);
    }
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
    const errors = [];
    for (const [tier, r] of Object.entries(ratios)) {
      const base = baseline.ratios[tier];
      if (!base) continue;
      for (const metric of Object.keys(r)) {
        const current = r[metric];
        const floor = base[metric];
        if (current > floor * HEADROOM) {
          errors.push(
            `${tier} nodes, ${metric}: ${current.toFixed(2)}x control, baseline was ${floor.toFixed(2)}x ` +
              `(regression beyond ${HEADROOM}x headroom)`,
          );
        }
      }
    }
    if (errors.length > 0) {
      console.error('\n❌ RENDER-PATH PERFORMANCE REGRESSION:');
      for (const err of errors) console.error(`  ${err}`);
      console.error(
        '\nIf this is an intentional tradeoff (see AGENTS.md — "the clean version is not ' +
          'always the fast version"), justify it explicitly in the PR description, then run ' +
          '`node scripts/audit-render-perf.mjs --update`.',
      );
      process.exit(1);
    }
    console.log('\n✓ Render-path performance within baseline ratio + headroom.');
  }
}

main();
