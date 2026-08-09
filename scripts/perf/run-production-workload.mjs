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
 *   node scripts/perf/run-production-workload.mjs --fixture=vector-1k
 *   node scripts/perf/run-production-workload.mjs --fixture=vector-5k \
 *       --workloads=single-drag,zoom,undo-redo,nudge
 *
 * `--fixture` seeds a deterministic corpus fixture (vector-100/500/1k/5k,
 * dense-overlap, wide-spread, effects-heavy, raster-heavy, ...) through the
 * app itself and opens it from the home screen; the fixture checksum and node
 * count are recorded with the results. Every workload record carries the
 * machine state captured around it and a `validity` classification
 * (valid/contended/thermally_suspect/background_activity/
 * insufficient_samples/instrumentation_error); only `valid` runs may be used
 * as authoritative regression evidence.
 *
 * Workloads are driven with real CDP pointer and keyboard input rather than an
 * in-page hook, so the measured path includes the browser's own event
 * dispatch, coalescing and hit-testing.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
const FIXTURE = args.get('fixture') ?? null;
const FIXTURE_DRAG = args.get('fixture-drag') ?? 'auto';
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

const CPU_COUNT = Number(run('nproc', [], '4') ?? 4);

// ── Machine state and benchmark validity ─────────────────────────────────────
// Wall-clock numbers from a contended host are not evidence. Every workload
// result carries the state captured around it, and a run whose state fails the
// thresholds below is classified rather than silently accepted.

function readProc(path, fallback = null) {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return fallback;
  }
}

function loadAverages() {
  const raw = readProc('/proc/loadavg');
  if (!raw) return [NaN, NaN, NaN];
  const parts = raw.split(/\s+/).map(Number);
  return [parts[0] ?? NaN, parts[1] ?? NaN, parts[2] ?? NaN];
}

function thermalMaxC() {
  try {
    const zones = execFileSync('sh', ['-c', 'ls /sys/class/thermal/thermal_zone*'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);
    let max = NaN;
    for (const zone of zones) {
      const temp = readProc(`${zone}/temp`);
      if (temp && !Number.isNaN(Number(temp))) {
        // Most drivers report milli-degrees; some report degrees.
        const milli = Number(temp) > 1000;
        max = Math.max(max, milli ? Number(temp) / 1000 : Number(temp));
      }
    }
    return max;
  } catch {
    return NaN;
  }
}

/** Other processes touching this repo or running repo-adjacent tooling. */
function backgroundActivity(myPids) {
  try {
    const lines = execFileSync('sh', ['-c', 'ps -eo pid=,args='], { cwd: ROOT, encoding: 'utf8' })
      .trim()
      .split('\n');
    const mine = new Set(myPids.map(String));
    const suspicious = /(vitest|tsx |ts-node|esbuild|tsc |vite|webpack|next dev|madge)/;
    const hits = [];
    for (const line of lines) {
      const pid = line.trim().split(/\s+/)[0];
      if (!pid || mine.has(pid)) continue;
      const rest = line.slice(pid.length);
      if (!rest.includes('Varve') && !suspicious.test(rest)) continue;
      if (rest.includes('grep') || rest.includes('run-production-workload')) continue;
      hits.push(rest.trim().slice(0, 90));
    }
    return hits;
  } catch {
    return null;
  }
}

function captureMachineState(myPids = []) {
  const [load1, load5, load15] = loadAverages();
  const memAvailableKb = Number(
    readProc('/proc/meminfo')?.match(/MemAvailable:\s+(\d+)/)?.[1] ?? NaN,
  );
  const thermal = thermalMaxC();
  const activity = backgroundActivity(myPids);
  return {
    load1,
    load5,
    load15,
    cpuCount: CPU_COUNT,
    memAvailableKb: Number.isFinite(memAvailableKb) ? memAvailableKb : null,
    thermalMaxC: Number.isFinite(thermal) ? thermal : null,
    governor: readProc('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor', 'unknown'),
    backgroundActivity: activity,
  };
}

/**
 * Benchmark validity classification. Contended/thermal/background runs are
 * retained for diagnostics but must not be used as authoritative regression
 * evidence; `insufficient_samples` and `instrumentation_error` mark the run
 * itself as unreliable.
 */
function classifyRun(state) {
  if (!state || state.instrumentationError) return 'instrumentation_error';
  const loadOK = Number.isFinite(state.load1) && state.load1 > CPU_COUNT * 1.5;
  if (loadOK) return 'contended';
  if (Array.isArray(state.backgroundActivity) && state.backgroundActivity.length > 0) {
    return 'background_activity';
  }
  if (state.thermalMaxC !== null && state.thermalMaxC > 90) return 'thermally_suspect';
  return 'valid';
}

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
    .locator('dialog[open]')
    .getByRole('button', { name: /^create(?: design)?$/i })
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
 * Apply a deterministic corpus fixture as the open document. The fixture
 * documents live in the editor's workload corpus (single source of truth),
 * so the checksum and node count come from the same code the unit tests
 * exercise. The apply path replaces the document in the open editor — the
 * web build runs on the memory platform, so IndexedDB seeding cannot reach
 * the home screen.
 */
async function openFixtureEditor(page, fixtureId) {
  // The perf handle (and therefore the fixture applier) is installed by
  // CanvasArea on mount, so an editor page must exist first.
  await openEditorCanvas(page);
  await page.waitForFunction(() => Boolean(window.__varvePerf ?? window.__strataPerf), {
    timeout: 30_000,
  });
  const seeded = await page.evaluate(async (id) => {
    const perf = window.__varvePerf ?? window.__strataPerf;
    if (!perf?.fixtures?.apply) return { ok: false, error: 'fixtures.apply missing' };
    return perf.fixtures.apply(id);
  }, fixtureId);
  if (!seeded?.ok) {
    throw new Error(`fixture apply failed for '${fixtureId}' (${seeded?.error ?? 'unknown'})`);
  }
  // Wait for the fixture to render before measuring.
  await page.waitForTimeout(2500);
  // Applying a document can re-open the welcome dialog over the canvas;
  // dismiss any modal so pointer input reaches the canvas.
  for (let i = 0; i < 4; i++) {
    if ((await page.locator('dialog[open]').count()) === 0) break;
    const close = page
      .locator('dialog[open]')
      .last()
      .getByRole('button', { name: /close|get started/i })
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
  const box = await canvas.boundingBox();
  return { seeded, box };
}

/**
 * Where the fixture-drag workload should start. Grid fixtures have a known
 * layout (rects at `spacing` apart, first cell at 0,0) so the click point is
 * computable; dense fixtures fall back to the viewport centre, which reliably
 * hits *something*. `--fixture-drag=x,y` overrides everything.
 */
function fixtureDragPoint(seeded, box, gridSpacing = 140, cell = { w: 64, h: 48 }) {
  const explicit = FIXTURE_DRAG;
  if (explicit !== 'auto') {
    const [x, y] = explicit.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x: x + box.x, y: y + box.y };
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const id = seeded?.id ?? '';
  if (/^perf-vector-/.test(id)) {
    const col = Math.max(0, Math.floor((cx - box.x - cell.w / 2) / gridSpacing));
    const row = Math.max(0, Math.floor((cy - box.y - cell.h / 2) / gridSpacing));
    return { x: box.x + col * gridSpacing + cell.w / 2, y: box.y + row * gridSpacing + cell.h / 2 };
  }
  return { x: cx, y: cy };
}

/**
 * Draw a seed grid, then double it `duplications` times.
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
    const perf = window.__varvePerf ?? window.__strataPerf;
    const frames = perf?.getFrames?.(3) ?? [];
    return frames.length ? frames[frames.length - 1].nodeCount : 0;
  });
  return { nodeCount, dragTarget: { x: targetX, y: targetY } };
}

/**
 * Dismiss any modal (welcome dialog can re-open asynchronously after a
 * document apply) and verify the drag point still hits the content canvas,
 * so a workload can never silently measure nothing.
 */
async function ensureCanvasHitTarget(page, dragTarget) {
  // The welcome dialog can open a beat after the fixture apply; retry the
  // dismissal + hit check so a late dialog cannot invalidate a workload.
  for (let attempt = 0; attempt < 3; attempt++) {
    for (let i = 0; i < 4; i++) {
      if ((await page.locator('dialog[open]').count()) === 0) break;
      const close = page
        .locator('dialog[open]')
        .last()
        .getByRole('button', { name: /close|get started/i })
        .first();
      if (await close.isVisible({ timeout: 500 }).catch(() => false)) {
        await close.click({ force: true });
      } else {
        await page.keyboard.press('Escape');
      }
      await page.waitForTimeout(50);
    }
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return Boolean(el?.closest?.('.editor-canvas'));
    }, dragTarget);
    if (hit) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

/**
 * Select the first node in the layers panel, then resolve a drag point clear
 * of the selection handle grid. Every node centre carries its own 16px move
 * handle (pointer-events:auto, stops propagation), and the corner handles
 * extend 8px inward along each edge — so the safe point is 16px inside the
 * left edge at the box's vertical centre.
 */
async function resolveDragTarget(page, seedPoint) {
  await page.keyboard.press('v');
  await page.waitForTimeout(150);
  const row = page.getByRole('treeitem').first();
  if (!(await row.isVisible({ timeout: 3000 }).catch(() => false))) return seedPoint;
  await row.click({ force: true });
  await page.waitForTimeout(400);
  const target = await page.evaluate(() => {
    const rects = [...document.querySelectorAll('.editor-canvas svg rect')]
      .filter((r) => (r.getAttribute('style') || '').includes('resize'))
      .map((r) => {
        const b = r.getBoundingClientRect();
        return { x: b.x, y: b.y };
      });
    if (rects.length < 4) return null;
    const xs = rects.map((r) => r.x);
    const ys = rects.map((r) => r.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    // 16px inside the left edge, vertically centred: clear of the corner
    // handles (8px inward), the edge handles (centred on the edges) and the
    // centre move handle.
    return { x: minX + 16, y: (minY + maxY) / 2 };
  });
  return target ?? seedPoint;
}

/**
 * One iteration of a named workload. Each is a real gesture, so the resulting
 * traces cover the whole path from browser event dispatch to frame commit.
 */
async function driveWorkload(page, box, workload, iteration, dragTarget) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const jitter = (iteration % 5) * 3;

  // A drag workload that misses the canvas measures nothing (the previous
  // failure mode: the welcome dialog re-opened over the canvas after the
  // fixture apply and swallowed every pointer event).
  const pointerWorkloads = new Set([
    'single-drag',
    'multi-drag',
    'marquee-select',
    'resize',
    'rotate',
    'alt-drag',
    'nudge',
    'layer-visibility',
    'pan',
    'zoom',
  ]);
  if (pointerWorkloads.has(workload) && !(await ensureCanvasHitTarget(page, dragTarget))) {
    throw new Error(
      `drag target (${dragTarget.x}, ${dragTarget.y}) does not hit the content canvas`,
    );
  }

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
      // Focus the canvas so the keyboard shortcuts reach its handler (the
      // global shortcut path is not traced).
      await page
        .locator('canvas.editor-canvas__content-layer')
        .click({ position: { x: 300, y: 200 } });
      await page.waitForTimeout(80);
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

    // ── Extended interactions (Phase 2 corpus) ─────────────────────────────

    case 'resize': {
      await page.keyboard.press('v');
      await page.mouse.click(dragTarget.x, dragTarget.y);
      await page.waitForTimeout(80);
      // The bottom-right selection handle sits just past the node corner; the
      // drag target rect is 120x80 centred on dragTarget.
      const hx = dragTarget.x + 62;
      const hy = dragTarget.y + 42;
      await page.mouse.move(hx, hy);
      await page.mouse.down();
      for (let i = 0; i < 16; i++) {
        await page.mouse.move(hx + i * 3 + jitter, hy + i * 2);
        await page.waitForTimeout(8);
      }
      await page.mouse.up();
      await page.waitForTimeout(80);
      return;
    }

    case 'rotate': {
      await page.keyboard.press('v');
      await page.mouse.click(dragTarget.x, dragTarget.y);
      await page.waitForTimeout(80);
      // The rotate handle floats above the selection box's top edge.
      const rx = dragTarget.x;
      const ry = dragTarget.y - 64;
      await page.mouse.move(rx, ry);
      await page.mouse.down();
      for (let i = 0; i < 16; i++) {
        await page.mouse.move(rx + i * 3 + jitter, ry - i * 1.5);
        await page.waitForTimeout(8);
      }
      await page.mouse.up();
      // Undo the rotation so iterations stay comparable.
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(80);
      return;
    }

    case 'alt-drag': {
      await page.keyboard.press('v');
      await page.mouse.click(dragTarget.x, dragTarget.y);
      await page.waitForTimeout(80);
      await page.mouse.move(dragTarget.x, dragTarget.y);
      await page.keyboard.down('Alt');
      await page.mouse.down();
      for (let i = 0; i < 14; i++) {
        await page.mouse.move(dragTarget.x + i * 6 + jitter, dragTarget.y + i * 4);
        await page.waitForTimeout(8);
      }
      await page.mouse.up();
      await page.keyboard.up('Alt');
      await page.waitForTimeout(120);
      // Remove the duplicate so iterations stay comparable.
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(80);
      return;
    }

    case 'nudge': {
      await page.keyboard.press('v');
      await page.mouse.click(dragTarget.x, dragTarget.y);
      await page.waitForTimeout(80);
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(12);
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(12);
      }
      // Return the node to its origin.
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(12);
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(12);
      }
      await page.waitForTimeout(80);
      return;
    }

    case 'tool-switch': {
      // Rapid switching between select / rectangle / pen across one canvas.
      const tools = ['v', 'r', 'p', 'e', 'v'];
      for (const key of tools) {
        await page.keyboard.press(key);
        await page.waitForTimeout(40);
      }
      await page.mouse.move(cx, cy);
      await page.waitForTimeout(80);
      return;
    }

    case 'layer-visibility': {
      await page.keyboard.press('v');
      await page.mouse.click(dragTarget.x, dragTarget.y);
      await page.waitForTimeout(80);
      const toggle = page
        .locator('.layers-panel [role="treeitem"]')
        .last()
        .getByRole('button', { name: /eye|visibility|hide|show/i })
        .first();
      for (let i = 0; i < 4; i++) {
        if (await toggle.isVisible({ timeout: 500 }).catch(() => false)) {
          await toggle.click({ force: true });
          await page.waitForTimeout(60);
        }
      }
      await page.waitForTimeout(80);
      return;
    }

    case 'canvas-resize': {
      for (const [w, h] of [
        [1600, 1000],
        [1200, 800],
        [1600, 1000],
      ]) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(150);
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
  let box;
  let scene;
  if (FIXTURE) {
    const opened = await openFixtureEditor(page, FIXTURE);
    box = opened.box;
    await page.waitForFunction(() => Boolean(window.__varvePerf ?? window.__strataPerf), {
      timeout: 30_000,
    });
    partial.fixture = {
      id: FIXTURE,
      documentId: opened.seeded?.id,
      nodeCount: opened.seeded?.nodeCount,
      fixtureChecksum: opened.seeded?.fixtureChecksum,
    };
    const seedPoint = fixtureDragPoint(opened.seeded, box);
    partial.fixtureDragPoint = seedPoint;
    const resolved = await resolveDragTarget(page, seedPoint);
    partial.fixtureDragTarget = resolved;
    scene = { dragTarget: resolved };
    partial.sceneNodeCount = opened.seeded?.nodeCount ?? null;
    console.log(`Fixture opened: ${FIXTURE} (${opened.seeded?.nodeCount} nodes)`);
  } else {
    box = await openEditorCanvas(page);
    await page.waitForFunction(() => Boolean(window.__varvePerf ?? window.__strataPerf), {
      timeout: 30_000,
    });
    partial.sceneSpread = args.get('no-spread') !== 'true';
    scene = await buildScene(page, box, DUPLICATIONS, partial.sceneSpread);
    partial.sceneNodeCount = scene.nodeCount;
    console.log(`Scene built: ${scene.nodeCount} nodes`);
  }

  for (const workload of WORKLOADS) {
    const beforeState = captureMachineState([process.pid, server?.pid]);
    const record = {
      workload,
      warmupIterations: WARMUP,
      measuredIterations: ITERATIONS,
      machineBefore: beforeState,
      validity: classifyRun(beforeState),
    };
    try {
      // Warm-up is separated from measurement: JIT, font and shader
      // initialisation are one-time costs and must not enter the distribution.
      for (let i = 0; i < WARMUP; i++)
        await driveWorkload(page, box, workload, i, scene.dragTarget);
      // A drag settles the node's selection box with its centre at the drag
      // point; the measured iterations re-resolve the drag target from the
      // current box so a drag never starts on a selection handle.
      if (FIXTURE) {
        const settled = await resolveDragTarget(page, scene.dragTarget);
        scene.dragTarget = settled;
        partial.fixtureDragTarget = settled;
      }

      await page.evaluate(() => {
        const perf = window.__varvePerf ?? window.__strataPerf;
        perf?.reset?.();
        perf?.interactions?.reset?.();
        perf?.nodeWork?.reset?.();
      });

      const heapSamples = [];
      for (let i = 0; i < ITERATIONS; i++) {
        // Re-resolve from the settled selection box right before each drag so
        // the pointer never starts on a selection handle (a drag moves the
        // node's centre to the click point).
        if (FIXTURE && workload !== 'zoom') {
          scene.dragTarget = await resolveDragTarget(page, scene.dragTarget);
        }
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
        const perf = window.__varvePerf ?? window.__strataPerf;
        const traces = perf?.interactions?.getTraces?.(50) ?? [];
        const distribution = (values) => {
          const sorted = [...values].sort((a, b) => a - b);
          const at = (percent) => {
            if (sorted.length === 0) return null;
            return sorted[Math.ceil((percent / 100) * sorted.length) - 1];
          };
          return {
            count: sorted.length,
            p50: at(50),
            p75: at(75),
            p90: at(90),
            p95: at(95),
            p99: at(99),
            max: sorted.at(-1) ?? null,
          };
        };
        const spanDurations = {};
        const traceKinds = {};
        const frameDispositions = {};
        const frameTotals = [];
        let droppedSpans = 0;
        let droppedFrames = 0;
        for (const trace of traces) {
          traceKinds[trace.kind] = (traceKinds[trace.kind] ?? 0) + 1;
          droppedSpans += trace.droppedSpanCount ?? 0;
          droppedFrames += trace.droppedFrameCount ?? 0;
          for (const span of trace.spans ?? []) {
            const durations = spanDurations[span.name] ?? [];
            durations.push(span.durationMs);
            spanDurations[span.name] = durations;
          }
          for (const frame of trace.frames ?? []) {
            const disposition = frame.disposition ?? 'unspecified';
            frameDispositions[disposition] = (frameDispositions[disposition] ?? 0) + 1;
            frameTotals.push(frame.totalMs);
          }
        }
        return {
          interactions: perf?.interactions?.summary?.() ?? null,
          traceCount: perf?.interactions?.count?.() ?? 0,
          interactionBreakdown: {
            traceKinds,
            spans: Object.fromEntries(
              Object.entries(spanDurations).map(([name, values]) => [name, distribution(values)]),
            ),
            frameDispositions,
            frameTotal: distribution(frameTotals),
            droppedSpans,
            droppedFrames,
          },
          nodeWork: perf?.nodeWork?.getSamples?.(30) ?? null,
          frames: perf?.getFrames?.(120) ?? null,
          workerBitmapBudget: perf?.workerBitmapBudget?.() ?? null,
          clockCalibration: perf?.clockCalibration?.() ?? null,
          presentation: perf?.presentation?.() ?? null,
        };
      });
      Object.assign(record, measured, { heapSamples, status: 'ok' });
      record.machineAfter = captureMachineState([process.pid, server?.pid]);
      record.validity = classifyRun(record.machineAfter);

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
    const pointerToPresent = record.interactions?.pointerToPresent;
    const pointerToPresentP95 = pointerToPresent?.count
      ? `${pointerToPresent.p95.toFixed(1)}ms (${pointerToPresent.count} samples)`
      : 'n/a (0 samples)';
    const summary = record.interactions
      ? ` p2p p95 ${pointerToPresentP95}, ${record.traceCount} traces`
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
