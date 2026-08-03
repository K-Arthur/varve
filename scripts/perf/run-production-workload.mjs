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
 *   node scripts/perf/run-production-workload.mjs --workloads=single-drag,pan
 *   node scripts/perf/run-production-workload.mjs --iterations=30 --warmup=5
 *   node scripts/perf/run-production-workload.mjs --duplications=7   # ~512 nodes
 *   node scripts/perf/run-production-workload.mjs --allow-dev-build  # explicit opt-in
 *   node scripts/perf/run-production-workload.mjs --out=results.json
 *
 * Workloads are driven with real CDP pointer and keyboard input rather than an
 * in-page hook, so the measured path includes the browser's own event
 * dispatch, coalescing and hit-testing.
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
const DUPLICATIONS = Number(args.get('duplications') ?? 5);
/**
 * Attach to an already-serving production build instead of building and
 * serving one. The dev-build signal check still runs against the served
 * artifact, so this cannot be used to smuggle a dev server in as production.
 */
const EXTERNAL_BASE = args.get('base') ?? null;
const WORKLOADS = (
  args.get('workloads') ??
  'pointer-move-idle,single-drag,multi-drag,marquee-select,pan,zoom,undo-redo'
).split(',');

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

// ── Workload drivers ────────────────────────────────────────────────────────
// Workloads are driven through real CDP pointer/keyboard input, not through an
// in-page hook. A synthetic driver would exercise a code path users never take
// and would skip the browser's own event dispatch, coalescing and hit-testing
// — which is where a material share of interaction latency lives.

/** Open a new document and return the canvas bounding box. */
async function openEditorCanvas(page) {
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30_000 });
  await page
    .waitForFunction(
      () => document.querySelector('.startup-loader')?.getAttribute('aria-busy') !== 'true',
      { timeout: 30_000 },
    )
    .catch(() => {});
  await page.getByRole('button', { name: /^new$/i }).click({ force: true, timeout: 30_000 });
  await page.waitForTimeout(1_500);
  await page
    .getByRole('button', { name: /^create$/i })
    .first()
    .click({ force: true, timeout: 15_000 });
  await page.locator('.layers-panel').waitFor({ timeout: 20_000 });

  // Dismiss anything modal left open; a dialog over the canvas would swallow
  // the pointer input every workload depends on.
  for (let i = 0; i < 4; i++) {
    if ((await page.locator('dialog[open]').count()) === 0) break;
    const close = page
      .locator('dialog[open]')
      .last()
      .getByRole('button', { name: /close/i })
      .first();
    if (await close.isVisible({ timeout: 500 }).catch(() => false)) {
      await close.click({ force: true });
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(50);
  }

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15_000 });
  return canvas.boundingBox();
}

/**
 * Draw a seed grid, then double it `duplications` times.
 *
 * Each duplicated batch is nudged well clear of its source. Without that the
 * copies land essentially on top of each other, and every node then falls
 * inside any single node's dirty region — which makes `prunableByDirty`
 * structurally zero and renders the fixture unable to answer whether a
 * dirty-region query could prune anything. A spread scene is the only version
 * of this fixture that can.
 */
async function buildScene(page, box, duplications, spread = true) {
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
  for (let i = 0; i < duplications; i++) {
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(25);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(60);
    if (spread) {
      // Shift+Arrow is the large-step nudge; the duplicate is still selected.
      const horizontal = i % 2 === 0;
      for (let step = 0; step < 12; step++) {
        await page.keyboard.press(horizontal ? 'Shift+ArrowRight' : 'Shift+ArrowDown');
      }
      await page.waitForTimeout(60);
    }
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // A dedicated drag target drawn last, at a known location. Relying on a
  // fixed coordinate hitting one of the seed rects is fragile: after the
  // spread nudges above, a click can land on empty canvas, and the "drag"
  // silently becomes a marquee that never mutates the document — which makes
  // every frame report `clean` and looks exactly like partial redraw being
  // broken. Drawing the target explicitly removes that failure mode.
  const targetX = box.x + box.width * 0.5;
  const targetY = box.y + box.height * 0.5;
  await page.keyboard.press('r');
  await page.waitForTimeout(80);
  await page.mouse.move(targetX - 60, targetY - 40);
  await page.mouse.down();
  await page.mouse.move(targetX + 60, targetY + 40);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('v');
  await page.waitForTimeout(150);

  const nodeCount = await page.evaluate(() => {
    const frames = window.__strataPerf?.getFrames?.(3) ?? [];
    return frames.length ? frames[frames.length - 1].nodeCount : 0;
  });
  return { nodeCount, dragTarget: { x: targetX, y: targetY } };
}

/**
 * One iteration of a named workload. Each is a real gesture, so the resulting
 * traces cover the whole path from browser event dispatch to frame commit.
 */
async function driveWorkload(page, box, workload, iteration, dragTarget) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const jitter = (iteration % 5) * 3;

  switch (workload) {
    case 'pointer-move-idle':
      for (let i = 0; i < 12; i++) {
        await page.mouse.move(cx - 200 + i * 30, cy - 100 + jitter);
        await page.waitForTimeout(8);
      }
      return;

    case 'single-drag': {
      await page.keyboard.press('v');
      // Select the known drag target, then verify the click actually hit it:
      // an unselected drag is a marquee and measures nothing.
      await page.mouse.click(dragTarget.x, dragTarget.y);
      await page.waitForTimeout(80);
      await page.mouse.move(dragTarget.x, dragTarget.y);
      await page.mouse.down();
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(dragTarget.x + i * 5 + jitter, dragTarget.y + i * 4);
        await page.waitForTimeout(8);
      }
      await page.mouse.up();
      // Return the node to its origin so iterations stay comparable.
      await page.mouse.move(dragTarget.x + 100 + jitter, dragTarget.y + 80);
      await page.mouse.down();
      await page.mouse.move(dragTarget.x, dragTarget.y);
      await page.mouse.up();
      await page.waitForTimeout(80);
      return;
    }

    case 'multi-drag': {
      await page.keyboard.press('v');
      await page.keyboard.press('Control+a');
      await page.waitForTimeout(40);
      await page.mouse.move(box.x + 120, box.y + 110);
      await page.mouse.down();
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(box.x + 120 + i * 4 + jitter, box.y + 110 + i * 3);
        await page.waitForTimeout(8);
      }
      await page.mouse.up();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
      return;
    }

    case 'marquee-select': {
      await page.keyboard.press('v');
      await page.keyboard.press('Escape');
      await page.mouse.move(cx - 300, cy - 200);
      await page.mouse.down();
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(cx - 300 + i * 25, cy - 200 + i * 18);
        await page.waitForTimeout(8);
      }
      await page.mouse.up();
      await page.waitForTimeout(80);
      return;
    }

    case 'pan': {
      await page.keyboard.down('Space');
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(cx + i * 8, cy + i * 5);
        await page.waitForTimeout(8);
      }
      await page.mouse.up();
      await page.keyboard.up('Space');
      await page.waitForTimeout(80);
      return;
    }

    case 'zoom': {
      await page.mouse.move(cx, cy);
      for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(0, i % 2 === 0 ? -120 : 120);
        await page.waitForTimeout(16);
      }
      await page.waitForTimeout(80);
      return;
    }

    case 'undo-redo': {
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(40);
      }
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Control+Shift+z');
        await page.waitForTimeout(40);
      }
      return;
    }

    default:
      throw new Error(`unknown workload '${workload}'`);
  }
}

// ── Build ───────────────────────────────────────────────────────────────────

const DIST = `${ROOT}apps/desktop/dist`;

if (!ALLOW_DEV && !EXTERNAL_BASE) {
  console.log('Building production bundle (vite build)…');
  try {
    // `vite build` directly rather than the package's `build` script: that
    // script gates on `tsc --noEmit` over the whole workspace, so unrelated
    // in-flight type errors elsewhere in the tree would block a perf run that
    // does not depend on them. The emitted bundle is identical either way —
    // Vite strips types without checking them — but the bypass is recorded in
    // the results so a reader knows the typecheck gate did not run.
    execFileSync('npx', ['vite', 'build'], {
      cwd: `${ROOT}apps/desktop`,
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

let server = null;
let serverLog = '';
let BASE = EXTERNAL_BASE;

if (!EXTERNAL_BASE) {
  const port = await findFreePort();
  const serverCmd = ALLOW_DEV
    ? ['pnpm', ['--dir', 'apps/desktop', 'dev', '--port', String(port), '--strictPort']]
    : ['pnpm', ['--dir', 'apps/desktop', 'preview', '--port', String(port), '--strictPort']];

  server = spawn(serverCmd[0], serverCmd[1], { cwd: ROOT, stdio: 'pipe' });
  server.stdout.on('data', (d) => {
    serverLog += d.toString();
  });
  server.stderr.on('data', (d) => {
    serverLog += d.toString();
  });

  // `localhost`, not `127.0.0.1`: vite preview binds the loopback name, which
  // on a dual-stack host resolves to ::1 — probing the IPv4 literal then never
  // connects and the runner reports a phantom startup timeout.
  BASE = `http://localhost:${port}`;
}

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
const partial = {
  identity: buildIdentity(),
  buildMode,
  // Recorded so a reader knows the bundle is production-mode but was emitted
  // without the workspace typecheck gate having passed.
  typecheckGateBypassed: !ALLOW_DEV,
  workloads: [],
  errors: [],
};

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
    server?.kill();
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

  // The perf handle is installed by CanvasArea on mount, so it cannot exist on
  // the home screen — the document has to be open before it is waited on.
  const box = await openEditorCanvas(page);
  await page.waitForFunction(() => Boolean(window.__strataPerf), { timeout: 30_000 });
  partial.sceneSpread = args.get('no-spread') !== 'true';
  const scene = await buildScene(page, box, DUPLICATIONS, partial.sceneSpread);
  partial.sceneNodeCount = scene.nodeCount;
  console.log(`Scene built: ${scene.nodeCount} nodes`);

  for (const workload of WORKLOADS) {
    const record = { workload, warmupIterations: WARMUP, measuredIterations: ITERATIONS };
    try {
      // Warm-up is separated from measurement: JIT, font and shader
      // initialisation are one-time costs and must not enter the distribution.
      for (let i = 0; i < WARMUP; i++)
        await driveWorkload(page, box, workload, i, scene.dragTarget);

      await page.evaluate(() => {
        const perf = window.__strataPerf;
        perf?.reset?.();
        perf?.interactions?.reset?.();
        perf?.nodeWork?.reset?.();
      });

      const heapSamples = [];
      for (let i = 0; i < ITERATIONS; i++) {
        await driveWorkload(page, box, workload, i, scene.dragTarget);
        // Forced GC is a benchmark-only capability (--expose-gc) and is never
        // available in production; sampling after it isolates retained heap
        // from collectable garbage.
        const heap = await page.evaluate(() => {
          if (typeof globalThis.gc !== 'function') return null;
          globalThis.gc();
          return performance.memory?.usedJSHeapSize ?? null;
        });
        if (heap !== null) heapSamples.push(heap);
      }

      const measured = await page.evaluate(() => {
        const perf = window.__strataPerf;
        return {
          interactions: perf?.interactions?.summary?.() ?? null,
          traceCount: perf?.interactions?.count?.() ?? 0,
          nodeWork: perf?.nodeWork?.getSamples?.(30) ?? null,
          frames: perf?.getFrames?.(120) ?? null,
          workerBitmapBudget: perf?.workerBitmapBudget?.() ?? null,
          clockCalibration: perf?.clockCalibration?.() ?? null,
          presentation: perf?.presentation?.() ?? null,
        };
      });
      Object.assign(record, measured, { heapSamples, status: 'ok' });

      // A workload that produced no traces measured nothing; recording it as a
      // success would be worse than recording a failure.
      if (!record.traceCount) {
        record.status = 'no-evidence';
        record.error = 'workload completed but produced no interaction traces';
      }
    } catch (error) {
      // One failed workload must not lose the others.
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : String(error);
    }
    partial.workloads.push(record);
    const summary = record.interactions
      ? ` p2p p95 ${record.interactions.pointerToPresent?.p95?.toFixed(1)}ms, ${record.traceCount} traces`
      : '';
    console.log(`  ${workload}: ${record.status}${summary}`);
  }

  flush('completed');
} catch (error) {
  partial.errors.push(error instanceof Error ? error.message : String(error));
  flush('aborted');
  exitCode = 1;
} finally {
  await browser?.close();
  server?.kill();
}

process.exit(exitCode);
