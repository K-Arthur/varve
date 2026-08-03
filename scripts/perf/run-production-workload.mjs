#!/usr/bin/env node
/**
 * Deterministic workload corpus against a production (release-equivalent)
 * build.
 *
 * The point of this runner is that a development build is not evidence:
 * dev-only logging, React double-invocation, unminified bundles and
 * diagnostics all move the numbers. It therefore refuses to run against a dev
 * server rather than silently falling back to one, and records the exact
 * commit, build mode, feature flags and environment alongside every result so
 * a figure without provenance cannot enter the ledger.
 *
 * Usage:
 *   node scripts/perf/run-production-workload.mjs
 *   node scripts/perf/run-production-workload.mjs --workloads=small,flat-10k
 *   node scripts/perf/run-production-workload.mjs --iterations=30 --warmup=5
 *   node scripts/perf/run-production-workload.mjs --allow-dev-build   # explicit opt-in
 *   node scripts/perf/run-production-workload.mjs --out=results.json
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';

const ROOT = new URL('../../', import.meta.url).pathname;

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? 'true'];
  }),
);

const ITERATIONS = Number(args.get('iterations') ?? 24);
const WARMUP = Number(args.get('warmup') ?? 4);
const ALLOW_DEV = args.get('allow-dev-build') === 'true';
const OUT = args.get('out') ?? null;
const WORKLOADS = (args.get('workloads') ?? 'small,flat-10k,raster-heavy,effects-masks').split(',');

function run(cmd, cmdArgs, fallback = null) {
  try {
    return execFileSync(cmd, cmdArgs, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return fallback;
  }
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/** Provenance: a result without this is informational only, never a budget. */
function buildIdentity() {
  return {
    commit: run('git', ['rev-parse', 'HEAD'], 'unknown'),
    commitShort: run('git', ['rev-parse', '--short', 'HEAD'], 'unknown'),
    branch: run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown'),
    // A dirty tree means the artifact does not correspond to the commit.
    dirty: (run('git', ['status', '--porcelain'], '') ?? '').length > 0,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    os: run('uname', ['-sr'], 'unknown'),
    cpuModel: (
      run('sh', ['-c', "grep -m1 'model name' /proc/cpuinfo | cut -d: -f2"], '') ?? ''
    ).trim(),
    cpuCount: run('nproc', [], 'unknown'),
    memTotalKb: (
      run('sh', ['-c', "grep MemTotal /proc/meminfo | awk '{print $2}'"], '') ?? ''
    ).trim(),
    cpuGovernor: run(
      'sh',
      ['-c', 'cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null'],
      'unknown',
    ),
    sessionType: process.env.XDG_SESSION_TYPE ?? 'unknown',
    capturedAt: new Date().toISOString(),
  };
}

function fail(message) {
  console.error(`\n  production-workload: ${message}\n`);
  process.exit(1);
}

// ── Build ───────────────────────────────────────────────────────────────────

const DIST = `${ROOT}apps/desktop/dist`;

if (!ALLOW_DEV) {
  console.log('Building production bundle (pnpm --dir apps/desktop build)…');
  try {
    execFileSync('pnpm', ['--dir', 'apps/desktop', 'build'], {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 15 * 60 * 1000,
    });
  } catch {
    fail(
      'production build failed. Fix the build rather than measuring a dev server — ' +
        'dev-build numbers are not comparable. Pass --allow-dev-build only for smoke-testing this runner.',
    );
  }
  if (!existsSync(DIST)) {
    fail(`expected a production bundle at ${DIST} but none exists`);
  }
}

const buildMode = ALLOW_DEV ? 'development' : 'production';
if (ALLOW_DEV) {
  console.warn(
    '\n  WARNING: running against a development build. Results are NOT comparable\n' +
      '  with production figures and must never be recorded as a budget.\n',
  );
}

// ── Serve ───────────────────────────────────────────────────────────────────

const port = await findFreePort();
const serverCmd = ALLOW_DEV
  ? ['pnpm', ['--dir', 'apps/desktop', 'dev', '--port', String(port), '--strictPort']]
  : ['pnpm', ['--dir', 'apps/desktop', 'preview', '--port', String(port), '--strictPort']];

const server = spawn(serverCmd[0], serverCmd[1], { cwd: ROOT, stdio: 'pipe' });
let serverLog = '';
server.stdout.on('data', (d) => {
  serverLog += d.toString();
});
server.stderr.on('data', (d) => {
  serverLog += d.toString();
});

const BASE = `http://127.0.0.1:${port}`;

async function waitForServer(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let browser = null;
let exitCode = 0;
const partial = { identity: buildIdentity(), buildMode, workloads: [], errors: [] };

function flush(reason) {
  partial.completedAt = new Date().toISOString();
  partial.terminationReason = reason;
  const json = JSON.stringify(partial, null, 2);
  if (OUT) {
    writeFileSync(OUT, json);
    console.log(`\nWrote ${OUT} (${reason})`);
  } else {
    console.log(json);
  }
}

// Partial results are still evidence; a run killed halfway must not vanish.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    flush(`interrupted by ${signal}`);
    server.kill();
    browser?.close();
    process.exit(130);
  });
}

try {
  if (!(await waitForServer())) {
    fail(`server did not start within 90s. Log:\n${serverLog.slice(-2000)}`);
  }

  browser = await chromium.launch({
    headless: true,
    // Exposed GC is required for the forced-heap samples and is explicitly a
    // benchmark-only flag; production never runs with it.
    args: ['--js-flags=--expose-gc'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('console', (msg) => {
    if (msg.type() === 'error') partial.errors.push(msg.text());
  });

  await page.goto(`${BASE}/?perf=1`, { timeout: 60_000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__strataPerf), { timeout: 30_000 });

  // Refuse to attribute production numbers to a bundle that is actually a dev
  // build — the check is on the artifact, not on our own intent.
  const looksDev = await page.evaluate(
    () =>
      Boolean(window.__vite_plugin_react_preamble_installed__) ||
      Boolean(window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size),
  );
  partial.devBuildSignalsDetected = looksDev;
  if (looksDev && !ALLOW_DEV) {
    fail('the served bundle shows development-build signals; refusing to record it as production');
  }

  for (const workload of WORKLOADS) {
    const record = { workload, warmupIterations: WARMUP, measuredIterations: ITERATIONS };
    try {
      // Warm-up is separated from measurement: JIT, font and shader
      // initialisation are one-time costs and must not enter the distribution.
      await page.evaluate(
        async ({ workload, warmup }) => {
          const perf = window.__strataPerf;
          perf.interactions?.reset?.();
          perf.nodeWork?.reset?.();
          for (let i = 0; i < warmup; i++) await perf.runWorkload?.(workload);
        },
        { workload, warmup: WARMUP },
      );

      const measured = await page.evaluate(
        async ({ workload, iterations }) => {
          const perf = window.__strataPerf;
          perf.interactions?.reset?.();
          perf.nodeWork?.reset?.();
          const heap = [];
          for (let i = 0; i < iterations; i++) {
            await perf.runWorkload?.(workload);
            if (typeof globalThis.gc === 'function') {
              globalThis.gc();
              heap.push(performance.memory?.usedJSHeapSize ?? 0);
            }
          }
          return {
            interactions: perf.interactions?.summary?.() ?? null,
            nodeWork: perf.nodeWork?.getSamples?.(30) ?? null,
            workerBitmapBudget: perf.workerBitmapBudget?.() ?? null,
            clockCalibration: perf.clockCalibration?.() ?? null,
            presentation: perf.presentation?.() ?? null,
            heapSamples: heap,
          };
        },
        { workload, iterations: ITERATIONS },
      );
      Object.assign(record, measured, { status: 'ok' });
    } catch (error) {
      // One failed workload must not lose the others.
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : String(error);
    }
    partial.workloads.push(record);
    console.log(`  ${workload}: ${record.status}`);
  }

  flush('completed');
} catch (error) {
  partial.errors.push(error instanceof Error ? error.message : String(error));
  flush('aborted');
  exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}

process.exit(exitCode);
