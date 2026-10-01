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
 *   node scripts/perf/run-production-workload.mjs --mode=canvas2d-worker --fixture=vector-1k --preflight-only --out=preflight.json
 *   node scripts/perf/run-production-workload.mjs --headed --mode=webgl2 --preflight-only --out=headed-preflight.json
 *   node scripts/perf/run-production-workload.mjs --quality=full --fixture=vector-1k
 *   node scripts/perf/run-production-workload.mjs --quality=automatic --fixture=vector-1k
 *   node scripts/perf/run-production-workload.mjs --help
 *   node scripts/perf/run-production-workload.mjs --fixture=vector-5k \
 *       --workloads=single-drag,zoom,undo-redo,nudge
 *
 * `--quality` explicitly selects Automatic or Full interactive preview quality;
 * reports record this alongside the renderer mode. The default is Automatic.
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
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname as pathDirname, resolve as pathResolve } from 'node:path';
import { chromium } from '@playwright/test';
import {
  classifyRun,
  measuredTraceFailure,
  performanceEvidence,
  summarizeRunnerTraces,
  worstValidity,
} from './productionEvidence.mjs';
import { fixtureDragPoint } from './workloadGeometry.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? 'true'];
  }),
);

if (args.has('help') || args.has('h')) {
  process.stdout.write(`Usage: node scripts/perf/run-production-workload.mjs [options]

Options:
  --mode=canvas2d-main|canvas2d-worker|webgl2
  --fixture=<id>                 Deterministic document fixture
  --workloads=<a,b,...>          Gesture workloads (default: standard interaction set)
  --iterations=<count>           Requested measured samples (minimum 100 accepted)
  --warmup=<count>               Warmup gestures (default: 10)
  --quality=automatic|full       Interactive preview quality
  --width=<pixels> --height=<pixels> --dpr=<scale>
  --headed                       Use the local browser/display for compatibility screening
  --preflight-only               Build and verify the requested renderer without timing
  --base=<url>                   Use an existing production preview
  --out=<path>                   Write the evidence report
  --help, -h                     Show this help without building or launching a browser

Headless Chromium uses SwiftShader by default. Browser gesture timings do not
qualify native Tauri/WebKitGTK hardware performance or physical presentation.
`);
  process.exit(0);
}

const ITERATIONS = Number(args.get('iterations') ?? 120);
const WARMUP = Number(args.get('warmup') ?? 10);
const MIN_WARM_SAMPLES = 100;
const MAX_ATTEMPTS = 500;
const ATTEMPTS = Math.min(MAX_ATTEMPTS, Math.max(ITERATIONS + WARMUP, WARMUP + MIN_WARM_SAMPLES));
const MEASURED_ATTEMPTS = ATTEMPTS - WARMUP;
const ALLOW_DEV = args.get('allow-dev-build') === 'true';
const OUT = args.get('out') ?? null;
const SNAPSHOT = args.get('snapshot') ?? null;
const DUPLICATIONS = Number(args.get('duplications') ?? 5);
const FIXTURE = args.get('fixture') ?? null;
const FIXTURE_DRAG = args.get('fixture-drag') ?? 'auto';
const RENDERER_MODE = args.get('mode') ?? 'canvas2d-worker';
const RENDERER_MODES = new Set(['canvas2d-main', 'canvas2d-worker', 'webgl2']);
const PREVIEW_QUALITY = args.get('quality') ?? 'automatic';
const PREVIEW_QUALITIES = new Set(['automatic', 'full']);
const PREFLIGHT_ONLY = args.get('preflight-only') === 'true';
const HEADLESS = args.get('headed') !== 'true';
const DPR = Number(args.get('dpr') ?? 1);
const VIEWPORT_WIDTH = Number(args.get('width') ?? 1600);
const VIEWPORT_HEIGHT = Number(args.get('height') ?? 1000);
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
const MEASUREMENT_TRACE_KINDS = {
  'pointer-move-idle': ['hover'],
  'single-drag': ['pointer-drag'],
  'multi-drag': ['pointer-drag'],
  'marquee-select': ['pointer-drag'],
  pan: ['pointer-drag'],
  zoom: ['wheel', 'pinch'],
  brush: ['pointer-drag'],
  'brush-large-tip': ['pointer-drag'],
  eraser: ['pointer-drag'],
  'undo-redo': ['keyboard'],
  resize: ['pointer-drag'],
  rotate: ['pointer-drag'],
  'alt-drag': ['pointer-drag'],
  nudge: ['keyboard'],
  'tool-switch': ['keyboard'],
  'layer-visibility': ['pointer-drag'],
};

if (!RENDERER_MODES.has(RENDERER_MODE)) {
  fail(`unknown --mode '${RENDERER_MODE}'; use canvas2d-main, canvas2d-worker, or webgl2`);
}
if (!PREVIEW_QUALITIES.has(PREVIEW_QUALITY)) {
  fail(`unknown --quality '${PREVIEW_QUALITY}'; use automatic or full`);
}
if (!Number.isFinite(DPR) || DPR <= 0 || DPR > 4) fail('--dpr must be between 0 and 4');
if (!Number.isInteger(VIEWPORT_WIDTH) || VIEWPORT_WIDTH < 320 || VIEWPORT_WIDTH > 8192) {
  fail('--width must be an integer between 320 and 8192');
}
if (!Number.isInteger(VIEWPORT_HEIGHT) || VIEWPORT_HEIGHT < 240 || VIEWPORT_HEIGHT > 8192) {
  fail('--height must be an integer between 240 and 8192');
}

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
    let max = Number.NEGATIVE_INFINITY;
    for (const zone of zones) {
      const temp = readProc(`${zone}/temp`);
      if (temp && !Number.isNaN(Number(temp))) {
        // Most drivers report milli-degrees; some report degrees.
        const milli = Number(temp) > 1000;
        max = Math.max(max, milli ? Number(temp) / 1000 : Number(temp));
      }
    }
    return Number.isFinite(max) ? max : NaN;
  } catch {
    return NaN;
  }
}

function psiAvg10(resource) {
  const raw = readProc(`/proc/pressure/${resource}`);
  const value = raw?.match(/^some\s+.*?avg10=([\d.]+)/m)?.[1];
  return value === undefined ? null : Number(value);
}

function cpuFrequency() {
  const current = Number(readProc('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq', 'NaN'));
  const maximum = Number(readProc('/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq', 'NaN'));
  return {
    currentKHz: Number.isFinite(current) ? current : null,
    maxKHz: Number.isFinite(maximum) ? maximum : null,
    fractionOfMaximum:
      Number.isFinite(current) && Number.isFinite(maximum) && maximum > 0
        ? current / maximum
        : null,
  };
}

/** Other processes touching this repo or running repo-adjacent tooling. */
function backgroundActivity(myPids) {
  try {
    const lines = execFileSync('sh', ['-c', 'ps -eo pid=,ppid=,args='], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .trim()
      .split('\n');
    const processes = lines
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
        return match ? { pid: match[1], parent: match[2], args: match[3] } : null;
      })
      .filter(Boolean);
    const mine = new Set(myPids.filter(Number.isFinite).map(String));
    let changed = true;
    while (changed) {
      changed = false;
      for (const process of processes) {
        if (mine.has(process.parent) && !mine.has(process.pid)) {
          mine.add(process.pid);
          changed = true;
        }
      }
    }
    const suspicious =
      /(vitest|tsx |ts-node|esbuild|tsc |vite|webpack|next dev|madge|varve-desktop|chromium|chrome|WebKitWebProcess)/i;
    const hits = [];
    for (const process of processes) {
      if (mine.has(process.pid)) continue;
      const rest = process.args;
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
  const memoryPressure10 = psiAvg10('memory');
  const cpuPressure10 = psiAvg10('cpu');
  const memLow = Number.isFinite(memAvailableKb) && memAvailableKb < 1024 * 1024;
  const frequency = cpuFrequency();
  return {
    load1,
    load5,
    load15,
    cpuCount: CPU_COUNT,
    memAvailableKb: Number.isFinite(memAvailableKb) ? memAvailableKb : null,
    thermalMaxC: Number.isFinite(thermal) ? thermal : null,
    cpuPressureAvg10: Number.isFinite(cpuPressure10) ? cpuPressure10 : null,
    memoryPressureAvg10: Number.isFinite(memoryPressure10) ? memoryPressure10 : null,
    memoryPressure: memLow || (Number.isFinite(memoryPressure10) && memoryPressure10 > 1),
    cpuFrequency: frequency,
    governor: readProc('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor', 'unknown'),
    backgroundActivity: activity,
  };
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

function hashDirectory(directory) {
  const hash = createHash('sha256');
  const visit = (path, relative = '') => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const child = `${path}/${entry.name}`;
      const childRelative = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(child, childRelative);
      else {
        hash.update(childRelative);
        hash.update(readFileSync(child));
      }
    }
  };
  visit(directory);
  return hash.digest('hex');
}

function fail(message) {
  console.error(`\n  production-workload: ${message}\n`);
  process.exit(1);
}

async function readChromiumGpuDiagnostics(browser) {
  let session;
  try {
    session = await browser.newBrowserCDPSession();
    const info = await session.send('SystemInfo.getInfo');
    const gpu = info?.gpu ?? {};
    return {
      source: 'Chrome DevTools SystemInfo.getInfo',
      softwareRendering: gpu.auxAttributes?.softwareRendering ?? null,
      glVendor: gpu.auxAttributes?.glVendor ?? null,
      glRenderer: gpu.auxAttributes?.glRenderer ?? null,
      glVersion: gpu.auxAttributes?.glVersion ?? null,
      featureStatus: gpu.featureStatus ?? null,
      activeDevices: (gpu.devices ?? [])
        .filter((device) => device.active)
        .map(({ vendorId, deviceId, vendorString, deviceString, driverVendor, driverVersion }) => ({
          vendorId,
          deviceId,
          vendorString,
          deviceString,
          driverVendor,
          driverVersion,
        })),
      hardwareExecution: 'unknown; system GPU diagnostics do not prove this run executed there',
    };
  } catch (error) {
    return {
      source: 'unavailable',
      error: error instanceof Error ? error.message : String(error),
      hardwareExecution: 'unknown',
    };
  } finally {
    await session?.detach().catch(() => {});
  }
}

function rendererModeUrl(base, mode) {
  const url = new URL('/?perf=1', base);
  if (mode === 'canvas2d-main') url.searchParams.set('renderWorker', '0');
  if (mode === 'canvas2d-worker') url.searchParams.set('renderWorker', '1');
  return url.toString();
}

async function inspectRendererMode(page, mode) {
  const offscreenProbe =
    mode === 'canvas2d-worker'
      ? await page.evaluate(async () => {
          const perf = window.__varvePerf;
          return (await perf?.probeOffscreen?.()) ?? null;
        })
      : null;
  const snapshot = await page.evaluate(() => {
    const perf = window.__varvePerf;
    const frames = perf?.getFrames?.(120) ?? [];
    const recent = frames.at(-1);
    const path = perf?.renderPath?.();
    return {
      frames,
      path,
      latestPath: recent?.actualDrawingPath ?? null,
    };
  });
  const paths = new Set(snapshot.frames.map((frame) => frame.actualDrawingPath).filter(Boolean));
  let available = false;
  let reason = null;
  if (mode === 'canvas2d-main') {
    available = paths.has('canvas2d-main');
    if (!available)
      reason = `main-thread Canvas2D was not observed (${snapshot.latestPath ?? 'no frame'})`;
  } else if (mode === 'canvas2d-worker') {
    available =
      snapshot.path?.offscreenCanvasVerified === true &&
      snapshot.path?.workerHostCreated === true &&
      paths.has('canvas2d-worker');
    if (!available) reason = snapshot.path?.summary ?? 'verified Canvas2D worker frame unavailable';
  } else {
    available = paths.has('webgl2') || paths.has('webgl2-mixed');
    if (!available)
      reason = `WebGL2 actual drawing path was not observed (${snapshot.latestPath ?? 'no frame'})`;
  }
  return {
    requestedMode: mode,
    available,
    reason,
    actualPaths: [...paths],
    workerProbe: snapshot.path
      ? {
          offscreenCanvasVerified: snapshot.path.offscreenCanvasVerified,
          workerHostCreated: snapshot.path.workerHostCreated,
          fallbackReason: snapshot.path.fallbackReason,
        }
      : null,
    offscreenProbe,
    webgl2: {
      contextAvailable: mode === 'webgl2' ? available : null,
      vendor: null,
      renderer: null,
      hardwareExecution: 'unknown',
      diagnosticsSource: 'native-webview diagnostics not available from Chromium screening runner',
    },
  };
}

async function contentCanvasDigest(page) {
  return page.locator('canvas.editor-canvas__content-layer').evaluate(async (canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('content canvas is missing');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('content canvas pixels are not readable');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const digest = await crypto.subtle.digest('SHA-256', pixels);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  });
}

/**
 * History shortcuts are captured at window level before the canvas keyboard
 * trace handler runs, so undo is not guaranteed to create a keyboard trace.
 * Verify restoration from the pixels themselves, then ask the independent
 * full-redraw oracle to confirm those pixels still match the authoritative
 * document state. The preceding drag must already have changed the digest,
 * which prevents accepting an old baseline surface before undo commits.
 */
async function waitForAuthoritativeCanvasDigest(page, expectedDigest, label) {
  const deadline = Date.now() + 5_000;
  let lastDigest = null;
  while (Date.now() < deadline) {
    lastDigest = await contentCanvasDigest(page);
    if (lastDigest === expectedDigest) {
      const oracle = await page.evaluate(async () => window.__varvePerf?.forceFullRedraw?.());
      if (oracle?.authoritative === true) {
        lastDigest = await contentCanvasDigest(page);
        if (lastDigest === expectedDigest) return;
      }
    }
    await page.waitForTimeout(50);
  }
  throw new Error(
    `${label} did not restore baseline pixels with an authoritative redraw within 5 seconds; last digest=${lastDigest ?? 'unavailable'}`,
  );
}

async function readScriptResourceState(page) {
  return page.evaluate(() => {
    globalThis.gc?.();
    const resources = performance
      .getEntriesByType('resource')
      .filter((entry) => entry.initiatorType === 'script' || /\.js(?:\?|$)/.test(entry.name))
      .map((entry) => ({
        resource: new URL(entry.name).pathname,
        encodedBytes: entry.encodedBodySize || null,
        decodedBytes: entry.decodedBodySize || null,
        startTimeMs: entry.startTime,
      }));
    return {
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
      resources,
    };
  });
}

function summarizeRendererFrames(frames) {
  const counts = {};
  for (const frame of frames) {
    const path = frame.actualDrawingPath ?? 'unattributed';
    counts[path] = (counts[path] ?? 0) + 1;
  }
  const sum = (key) => frames.reduce((total, frame) => total + (frame[key] ?? 0), 0);
  const distributions = (key) => {
    const values = frames
      .map((frame) => frame[key])
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const at = (p) => values[Math.ceil((p / 100) * values.length) - 1] ?? null;
    return { count: values.length, p50: at(50), p95: at(95), max: values.at(-1) ?? null };
  };
  return {
    frameCount: frames.length,
    actualPathCounts: counts,
    visibleItemCount: sum('nodeCount'),
    gpuSubmittedItems: sum('gpuSubmittedItems'),
    fallbackCanvasItems: sum('fallbackCanvasItems'),
    textureUploads: sum('textureUploads'),
    gpuTextureBytesMax: Math.max(0, ...frames.map((frame) => frame.gpuTextureBytes ?? 0)),
    gpuSubmitCpuMs: distributions('gpuSubmitCpuMs'),
    gpuBlitCpuMs: distributions('gpuBlitCpuMs'),
  };
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
      undefined,
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
  await page.waitForFunction(() => Boolean(window.__varvePerf), undefined, { timeout: 30_000 });
  const seeded = await page.evaluate(async (id) => {
    const perf = window.__varvePerf;
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
    const perf = window.__varvePerf;
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
    const canvas = document.querySelector('canvas.editor-canvas__content-layer');
    const canvasBounds = canvas?.getBoundingClientRect();
    if (!canvasBounds || canvasBounds.width <= 0 || canvasBounds.height <= 0) return null;
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
    const candidate = { x: minX + 16, y: (minY + maxY) / 2 };
    // Virtualized/rotated overlays can expose stale SVG handles outside the
    // actual content surface. Never let that diagnostic geometry replace a
    // known fixture point with an off-canvas coordinate; the hit assertion
    // below should measure the workload, not fail on overlay bookkeeping.
    if (
      candidate.x < canvasBounds.left ||
      candidate.x > canvasBounds.right ||
      candidate.y < canvasBounds.top ||
      candidate.y > canvasBounds.bottom
    ) {
      return null;
    }
    // The canvas surface can be transformed or expose a world-sized backing
    // rect, so a bounds-only check is insufficient. Confirm the browser's
    // actual hit-test sees the editor surface at this viewport coordinate.
    if (!document.elementFromPoint(candidate.x, candidate.y)?.closest('.editor-canvas')) {
      return null;
    }
    return candidate;
  });
  return target ?? seedPoint;
}

/**
 * Wait for HandTool inertia to finish before restoring the next sample's
 * camera. Its bounded momentum keeps issuing real camera frames after pointerup;
 * a reset started mid-inertia races the oracle's expected state and invalidates
 * an otherwise correct authoritative redraw.
 */
async function waitForCameraToSettle(page) {
  let previous = null;
  let stableSamples = 0;
  for (let attempt = 0; attempt < 50; attempt++) {
    const camera = await page.evaluate(() => {
      const value = window.__varvePerf?.getFrames?.(1)?.at(-1)?.camera;
      return value
        ? { zoom: value.zoom, panX: value.panX, panY: value.panY, rotation: value.rotation }
        : null;
    });
    if (!camera) throw new Error('cannot verify pan completion without a committed camera frame');
    const identity = JSON.stringify(camera);
    stableSamples = identity === previous ? stableSamples + 1 : 0;
    if (stableSamples >= 2) return;
    previous = identity;
    await page.waitForTimeout(50);
  }
  throw new Error('camera inertia did not settle within 2.5 seconds');
}

async function latestInteractionTraceId(page) {
  return page.evaluate(() => {
    const traces = window.__varvePerf?.interactions?.getTraces?.(50) ?? [];
    return traces.reduce((latest, trace) => Math.max(latest, trace.id ?? 0), 0);
  });
}

async function waitForCommittedInteraction(page, kind, afterId, label) {
  try {
    await page.waitForFunction(
      ({ expectedKind, minimumId }) => {
        const traces = window.__varvePerf?.interactions?.getTraces?.(50) ?? [];
        return traces.some(
          (trace) =>
            trace.id > minimumId &&
            trace.kind === expectedKind &&
            trace.inputToCommitMs !== null &&
            trace.frameCount > 0,
        );
      },
      { expectedKind: kind, minimumId: afterId },
      { timeout: 5_000, polling: 'raf' },
    );
  } catch {
    const recent = await page.evaluate(() => {
      const traces = window.__varvePerf?.interactions?.getTraces?.(8) ?? [];
      return traces.map((trace) => ({
        id: trace.id,
        kind: trace.kind,
        inputToCommitMs: trace.inputToCommitMs,
        frameCount: trace.frameCount,
        presentationExpected: trace.presentationExpected,
        instrumentationErrors: trace.instrumentationErrors,
      }));
    });
    throw new Error(
      `${label} interaction did not produce a causally committed frame after trace ${afterId}; recent=${JSON.stringify(recent)}`,
    );
  }
}

/**
 * One iteration of a named workload. Each is a real gesture, so the resulting
 * traces cover the whole path from browser event dispatch to frame commit.
 */
let largeBrushTipPrepared = false;
async function driveWorkload(
  page,
  box,
  workload,
  iteration,
  dragTarget,
  baselineFingerprint = null,
) {
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
    'brush',
    'brush-large-tip',
    'eraser',
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
      // The fixture resolver has already selected the first layer row and
      // chosen an interior point clear of the selection handles. Clicking the
      // canvas here could hit its floating toolbar, leaving the following
      // gesture as the selection click rather than the measured drag.
      if (!(await ensureCanvasHitTarget(page, dragTarget))) {
        throw new Error('resolved drag target no longer hits the content canvas after selection');
      }
      const beforeDragTraceId = await latestInteractionTraceId(page);
      await page.mouse.move(dragTarget.x, dragTarget.y);
      await page.mouse.down();
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(dragTarget.x + i * 5 + jitter, dragTarget.y + i * 4);
        await page.waitForTimeout(8);
      }
      await page.mouse.up();
      await waitForCommittedInteraction(page, 'pointer-drag', beforeDragTraceId, 'drag');
      await page.waitForTimeout(80);
      if (baselineFingerprint) {
        const movedFingerprint = await contentCanvasDigest(page);
        if (movedFingerprint === baselineFingerprint) {
          throw new Error('drag did not change artwork pixels; pointer missed the selected object');
        }
      }
      // Undo the single drag so every iteration starts from byte-identical
      // artwork; a hand-built inverse drag can leave fractional-pixel residue.
      // The global history shortcut intentionally runs before canvas keyboard
      // tracing, so verify its committed effect with the full-redraw oracle
      // instead of waiting for a keyboard trace that may not exist.
      await page.keyboard.press('Control+z');
      await waitForAuthoritativeCanvasDigest(page, baselineFingerprint, 'undo');
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
      // Space spring-loads the Hand tool through the focused canvas handler.
      // The fixture workflow often leaves focus on its layer row; without
      // returning focus here the browser sends Space elsewhere and this
      // sequence is recorded as a pointer trace that never moves the camera.
      await page.locator('canvas.editor-canvas__content-layer').focus();
      await page.keyboard.down('Space');
      // Avoid racing ToolManager's 150 ms spring-load guard; otherwise the
      // drag starts on the previous tool and does not pan the camera.
      await page.waitForTimeout(175);
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(cx + i * 8, cy + i * 5);
        await page.waitForTimeout(8);
      }
      await page.mouse.up();
      await page.keyboard.up('Space');
      // HandTool keeps a short inertial tail after release. Let it finish
      // before sampling camera stability or restoring the canonical camera.
      await page.waitForTimeout(2_000);
      await waitForCameraToSettle(page);
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

    case 'brush':
    case 'brush-large-tip':
    case 'eraser': {
      if (workload === 'eraser') {
        await page.keyboard.press('e');
      } else {
        await page.keyboard.press('b');
        if (workload === 'brush-large-tip' && !largeBrushTipPrepared) {
          for (let index = 0; index < 12; index++) await page.keyboard.press(']');
          largeBrushTipPrepared = true;
        }
      }
      await page.mouse.move(cx - 120, cy + 48);
      await page.mouse.down();
      for (let index = 1; index <= 24; index++) {
        const progress = index / 24;
        await page.mouse.move(
          cx - 120 + progress * 240,
          cy + 48 + Math.sin(progress * Math.PI * 2) * 18,
        );
        await page.waitForTimeout(8);
      }
      await page.mouse.up();
      await page.waitForTimeout(48);
      // Keep every sample on the same committed scene; the measurement keeps
      // only the pointer trace and excludes this reset keystroke.
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(64);
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

/**
 * Drain the bounded in-page ring after each measured gesture. Keeping the
 * aggregate in the runner gives a workload 100+ warm samples without raising
 * the production ring's memory budget. Re-reading an existing id lets a late
 * frame commit update the same trace before the workload completes.
 */
async function drainInteractionTraces(page, collected, workload = null) {
  const traces = await page.evaluate(() => window.__varvePerf?.interactions?.getTraces?.(50) ?? []);
  for (const trace of traces) {
    if (['brush', 'brush-large-tip', 'eraser'].includes(workload) && trace.kind !== 'pointer') {
      continue;
    }
    collected.set(`${trace.sessionId ?? 'session'}:${trace.id}`, trace);
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
  requestedRendererMode: RENDERER_MODE,
  previewQuality: PREVIEW_QUALITY,
  viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT, dpr: DPR },
  browserMode: HEADLESS ? 'headless' : 'headed',
  presentationBoundary: 'browser event-to-commit / EventTiming only; not physical presentation',
  // Recorded so a reader knows the bundle is production-mode but was emitted
  // without the workspace typecheck gate having passed.
  typecheckGateBypassed: !ALLOW_DEV,
  workloads: [],
  errors: [],
  runtimeErrors: [],
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
    headless: HEADLESS,
    // Exposed GC is required for the forced-heap samples and is explicitly a
    // benchmark-only flag; production never runs with it.
    args: ['--js-flags=--expose-gc'],
  });
  partial.webglRuntimeEvidence = await readChromiumGpuDiagnostics(browser);
  const page = await browser.newPage({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    deviceScaleFactor: DPR,
  });
  await page.addInitScript(
    ({ mode, previewQuality }) => {
      if (location.origin === 'null') return;
      let current = {};
      try {
        current = JSON.parse(localStorage.getItem('varve-editor-settings') ?? '{}');
      } catch {
        current = {};
      }
      const render = current.render ?? {};
      const renderer = mode === 'webgl2' ? 'webgl2' : 'canvas2d';
      localStorage.setItem(
        'varve-editor-settings',
        JSON.stringify({
          ...current,
          render: { ...render, renderer, interactivePreview: previewQuality },
        }),
      );
      localStorage.setItem('varve.renderWorker', mode === 'canvas2d-worker' ? 'on' : 'off');
      const stats = { trusted: 0, untrusted: 0, types: {} };
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) {
        addEventListener(
          type,
          (event) => {
            if (event.isTrusted) stats.trusted++;
            else stats.untrusted++;
            stats.types[type] = (stats.types[type] ?? 0) + 1;
          },
          true,
        );
      }
      window.__varveQualificationInput = stats;
    },
    { mode: RENDERER_MODE, previewQuality: PREVIEW_QUALITY },
  );
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const location = msg.location();
    const message = msg.text();
    partial.errors.push(message);
    partial.runtimeErrors.push({
      source: 'console',
      message,
      url: location.url || null,
      lineNumber: location.lineNumber ?? null,
      columnNumber: location.columnNumber ?? null,
    });
  });
  page.on('pageerror', (error) => {
    const message = error.stack ?? error.message;
    partial.errors.push(message);
    partial.runtimeErrors.push({ source: 'pageerror', message });
  });

  await page.goto(rendererModeUrl(BASE, RENDERER_MODE), {
    timeout: 60_000,
    waitUntil: 'domcontentloaded',
  });

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
  partial.homeBundleCost = await readScriptResourceState(page);

  // The perf handle is installed by CanvasArea on mount, so it cannot exist on
  // the home screen — the document has to be open before it is waited on.
  let box;
  let scene;
  if (PREFLIGHT_ONLY) {
    // A preflight only needs the renderer mounted on a live editor canvas.
    // Avoid fixture generation, asset materialization, and drag-target
    // resolution so an unavailable renderer can be diagnosed cheaply. Draw
    // one trusted rectangle so WebGL2 path attribution observes a real GPU
    // submission instead of mistaking an empty scene for an unavailable path.
    box = await openEditorCanvas(page);
    if (!box) fail('the editor canvas has no visible bounds during renderer preflight');
    await page.waitForFunction(() => Boolean(window.__varvePerf), undefined, { timeout: 30_000 });
    await page.keyboard.press('r');
    await page.mouse.move(box.x + 60, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + 130);
    await page.mouse.up();
    await page.getByRole('treeitem').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.keyboard.press('v');
    partial.sceneNodeCount = 1;
    scene = {};
  } else if (FIXTURE) {
    const opened = await openFixtureEditor(page, FIXTURE);
    box = opened.box;
    await page.waitForFunction(() => Boolean(window.__varvePerf), undefined, { timeout: 30_000 });
    partial.fixture = {
      id: FIXTURE,
      documentId: opened.seeded?.id,
      nodeCount: opened.seeded?.nodeCount,
      fixtureChecksum: opened.seeded?.fixtureChecksum,
      assets: opened.seeded?.assets ?? null,
    };
    const explicitDragPoint = FIXTURE_DRAG === 'auto' ? null : FIXTURE_DRAG.split(',').map(Number);
    const camera = await page.evaluate(
      () => window.__varvePerf?.getFrames?.(1)?.at(-1)?.camera ?? null,
    );
    if (!camera) fail('fixture frame did not expose a camera for its drag target');
    const seedPoint =
      explicitDragPoint?.length === 2 && explicitDragPoint.every(Number.isFinite)
        ? { x: explicitDragPoint[0] + box.x, y: explicitDragPoint[1] + box.y }
        : fixtureDragPoint(opened.seeded, box, camera);
    partial.fixtureDragPoint = seedPoint;
    const resolved = await resolveDragTarget(page, seedPoint);
    partial.fixtureDragTarget = resolved;
    scene = { dragTarget: resolved };
    partial.sceneNodeCount = opened.seeded?.nodeCount ?? null;
    console.log(`Fixture opened: ${FIXTURE} (${opened.seeded?.nodeCount} nodes)`);
  } else {
    box = await openEditorCanvas(page);
    await page.waitForFunction(() => Boolean(window.__varvePerf), undefined, { timeout: 30_000 });
    partial.sceneSpread = args.get('no-spread') !== 'true';
    scene = await buildScene(page, box, DUPLICATIONS, partial.sceneSpread);
    partial.sceneNodeCount = scene.nodeCount;
    console.log(`Scene built: ${scene.nodeCount} nodes`);
  }

  await page.waitForTimeout(1_500);
  partial.rendererQualification = await inspectRendererMode(page, RENDERER_MODE);
  const editorResourceState = await readScriptResourceState(page);
  const initialResources = new Map(
    (partial.homeBundleCost?.resources ?? []).map((resource) => [resource.resource, resource]),
  );
  const addedResources = editorResourceState.resources.filter((resource) => {
    const initial = initialResources.get(resource.resource);
    return !initial || initial.encodedBytes !== resource.encodedBytes;
  });
  const navigation = await page.evaluate(() => {
    const entry = performance.getEntriesByType('navigation')[0];
    return entry
      ? {
          responseStartMs: entry.responseStart,
          domContentLoadedMs: entry.domContentLoadedEventEnd,
          loadMs: entry.loadEventEnd,
        }
      : null;
  });
  partial.startupAndBundleCost = {
    startup: navigation,
    homeHeapBytes: partial.homeBundleCost?.heapBytes ?? null,
    editorOpenHeapBytes: editorResourceState.heapBytes,
    homeScriptEncodedBytes: (partial.homeBundleCost?.resources ?? []).reduce(
      (sum, resource) => sum + (resource.encodedBytes ?? 0),
      0,
    ),
    editorAddedScriptEncodedBytes: addedResources.reduce(
      (sum, resource) => sum + (resource.encodedBytes ?? 0),
      0,
    ),
    editorAddedScriptDecodedBytes: addedResources.reduce(
      (sum, resource) => sum + (resource.decodedBytes ?? 0),
      0,
    ),
    likelyRendererChunks: addedResources.filter((resource) =>
      /webgl|compositor/i.test(resource.resource),
    ),
    addedResources,
  };
  partial.sourceArtifact = {
    commit: partial.identity.commit,
    dirty: partial.identity.dirty,
    appBundleSha256: existsSync(DIST) ? hashDirectory(DIST) : null,
    host: 'chromium-browser',
  };
  partial.environment = await page.evaluate(
    (webglEvidence) => ({
      userAgent: navigator.userAgent,
      dpr: window.devicePixelRatio,
      theme:
        document.documentElement.dataset.theme ??
        document.body.dataset.theme ??
        getComputedStyle(document.documentElement).colorScheme,
      trustedInputDriver: 'Playwright CDP browser input',
      webglHardwareExecution: webglEvidence?.hardwareExecution ?? 'unknown',
      navigation: (() => {
        const nav = performance.getEntriesByType('navigation')[0];
        return nav
          ? {
              responseStartMs: nav.responseStart,
              domContentLoadedMs: nav.domContentLoadedEventEnd,
              loadMs: nav.loadEventEnd,
            }
          : null;
      })(),
      scriptResources: performance
        .getEntriesByType('resource')
        .filter((entry) => entry.initiatorType === 'script' || /\.js(?:\?|$)/.test(entry.name))
        .map((entry) => ({
          resource: new URL(entry.name).pathname,
          encodedBytes: entry.encodedBodySize || null,
          decodedBytes: entry.decodedBodySize || null,
        })),
    }),
    partial.webglRuntimeEvidence,
  );
  const rendererAvailable = partial.rendererQualification.available;
  partial.modeStatus = rendererAvailable ? 'available' : 'unavailable';
  if (!rendererAvailable) {
    partial.modeUnavailableReason = partial.rendererQualification.reason;
    exitCode = 0;
  }

  if (PREFLIGHT_ONLY) partial.preflightOnly = true;

  if (!PREFLIGHT_ONLY) {
    const baselineCamera = rendererAvailable
      ? await page.evaluate(() => {
          const frame = window.__varvePerf?.getFrames?.(1)?.at(-1);
          return frame?.camera
            ? {
                zoom: frame.camera.zoom,
                pan: { x: frame.camera.panX, y: frame.camera.panY },
                rotation: frame.camera.rotation,
              }
            : null;
        })
      : null;
    partial.baselineCamera = baselineCamera;
    if (rendererAvailable && !baselineCamera)
      fail('renderer frame did not expose a baseline camera');
    const restoreBaselineCamera = async () => {
      const cameraSet = await page.evaluate((camera) => {
        const perf = window.__varvePerf;
        const frameCamera = perf?.getFrames?.(1)?.at(-1)?.camera;
        const alreadyAtBaseline = Boolean(
          frameCamera &&
            frameCamera.zoom === camera.zoom &&
            frameCamera.panX === camera.pan.x &&
            frameCamera.panY === camera.pan.y &&
            frameCamera.rotation === (camera.rotation ?? 0),
        );
        if (alreadyAtBaseline) return true;
        return perf?.camera?.setState?.(camera) === true;
      }, baselineCamera);
      if (!cameraSet) throw new Error('cannot reset the benchmark camera through the perf handle');
      await page.waitForFunction(
        (camera) => {
          const frame = window.__varvePerf?.getFrames?.(1)?.at(-1);
          return Boolean(
            frame?.camera &&
              frame.camera.zoom === camera.zoom &&
              frame.camera.panX === camera.pan.x &&
              frame.camera.panY === camera.pan.y &&
              frame.camera.rotation === (camera.rotation ?? 0),
          );
        },
        baselineCamera,
        { timeout: 3_000, polling: 'raf' },
      );
      const oracle = await page.evaluate(async () => window.__varvePerf?.forceFullRedraw?.());
      if (oracle?.authoritative !== true)
        throw new Error('camera reset did not produce an authoritative full redraw');
    };
    let baselineSceneFingerprint = null;
    if (rendererAvailable) {
      await restoreBaselineCamera();
      baselineSceneFingerprint = await contentCanvasDigest(page);
    }
    partial.scenePixelsSha256 = baselineSceneFingerprint;
    if (SNAPSHOT) {
      const snapshotPath = pathResolve(SNAPSHOT);
      mkdirSync(pathDirname(snapshotPath), { recursive: true });
      const snapshot = await page.locator('canvas.editor-canvas__content-layer').screenshot({
        path: snapshotPath,
        animations: 'disabled',
      });
      partial.scenePngSha256 = createHash('sha256').update(snapshot).digest('hex');
      partial.scenePngPath = snapshotPath;
    }

    for (const workload of rendererAvailable ? WORKLOADS : []) {
      const browserPid = browser?.process?.()?.pid;
      const beforeState = captureMachineState([process.pid, server?.pid, browserPid]);
      const record = {
        workload,
        previewQuality: PREVIEW_QUALITY,
        warmupIterations: WARMUP,
        measuredIterations: MEASURED_ATTEMPTS,
        machineBefore: beforeState,
        validity: classifyRun(beforeState, null, null, CPU_COUNT),
      };
      let coldFirstStroke = null;
      try {
        if (['brush', 'brush-large-tip', 'eraser'].includes(workload)) {
          await restoreBaselineCamera();
          await driveWorkload(page, box, workload, -1, scene.dragTarget);
          await restoreBaselineCamera();
          if ((await contentCanvasDigest(page)) !== baselineSceneFingerprint) {
            throw new Error('cold first stroke did not restore the fixture scene and camera');
          }
          await page.waitForTimeout(300);
          const coldTraces = new Map();
          await drainInteractionTraces(page, coldTraces, workload);
          coldFirstStroke =
            [...coldTraces.values()].find((trace) => trace.kind === 'pointer') ?? null;
          await page.evaluate(() => window.__varvePerf?.interactions?.reset?.());
        }
        // Warm-up is separated from measurement: JIT, font and shader
        // initialisation are one-time costs and must not enter the distribution.
        for (let i = 0; i < WARMUP; i++) {
          await restoreBaselineCamera();
          await driveWorkload(
            page,
            box,
            workload,
            i,
            scene.dragTarget,
            workload === 'single-drag' ? baselineSceneFingerprint : null,
          );
        }
        // A drag settles the node's selection box with its centre at the drag
        // point; the measured iterations re-resolve the drag target from the
        // current box so a drag never starts on a selection handle.
        if (FIXTURE) {
          const settled = await resolveDragTarget(page, scene.dragTarget);
          scene.dragTarget = settled;
          partial.fixtureDragTarget = settled;
        }
        await restoreBaselineCamera();
        if ((await contentCanvasDigest(page)) !== baselineSceneFingerprint) {
          throw new Error('warm-up did not restore the fixture scene and camera');
        }

        await page.evaluate(() => {
          const perf = window.__varvePerf;
          perf?.reset?.();
          perf?.interactions?.reset?.();
          perf?.nodeWork?.reset?.();
        });
        const measurementSeedOracle = await page.evaluate(async () =>
          window.__varvePerf?.forceFullRedraw?.(),
        );
        if (measurementSeedOracle?.authoritative !== true) {
          throw new Error('measurement baseline did not produce an authoritative full redraw');
        }
        await page.evaluate(() => window.__varvePerf?.nodeWork?.reset?.());

        const inputCountsAtStart = await page.evaluate(() => ({
          trusted: window.__varveQualificationInput?.trusted ?? 0,
          untrusted: window.__varveQualificationInput?.untrusted ?? 0,
        }));

        const collectedTraces = new Map();
        const heapSamples = [];
        for (let i = 0; i < MEASURED_ATTEMPTS; i++) {
          // Re-resolve from the settled selection box right before each drag so
          // the pointer never starts on a selection handle (a drag moves the
          // node's centre to the click point).
          if (FIXTURE && workload !== 'zoom') {
            scene.dragTarget = await resolveDragTarget(page, scene.dragTarget);
          }
          await driveWorkload(
            page,
            box,
            workload,
            i,
            scene.dragTarget,
            workload === 'single-drag' ? baselineSceneFingerprint : null,
          );
          await restoreBaselineCamera();
          if ((await contentCanvasDigest(page)) !== baselineSceneFingerprint) {
            throw new Error(`gesture ${i} did not restore the original scene/camera`);
          }
          // Forced GC is a benchmark-only capability (--expose-gc) and is never
          // available in production; sampling after it isolates retained heap
          // from collectable garbage.
          const heap = await page.evaluate(() => {
            if (typeof globalThis.gc !== 'function') return null;
            globalThis.gc();
            return performance.memory?.usedJSHeapSize ?? null;
          });
          if (heap !== null) heapSamples.push(heap);
          await drainInteractionTraces(page, collectedTraces, workload);
        }

        // Event Timing and the final authoritative frame can arrive after the
        // last input task. Allow the bounded browser ring to settle before the
        // runner classifies missing evidence.
        await page.waitForTimeout(300);
        await drainInteractionTraces(page, collectedTraces, workload);

        const measured = await page.evaluate(() => {
          const perf = window.__varvePerf;
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
              const disposition = frame.causalRelation ?? frame.disposition ?? 'unspecified';
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
            rendererQualification: {
              requested: perf?.getFrames?.(1)?.at(-1)?.requestedRenderer ?? null,
              actual: perf?.getFrames?.(120)?.at(-1)?.actualDrawingPath ?? null,
            },
            trustedInput: window.__varveQualificationInput ?? null,
          };
        });
        measured.rendererQualification.frameSummary = summarizeRendererFrames(
          measured.frames ?? [],
        );
        measured.trustedInput = {
          ...measured.trustedInput,
          measuredTrusted: (measured.trustedInput?.trusted ?? 0) - inputCountsAtStart.trusted,
          measuredUntrusted: (measured.trustedInput?.untrusted ?? 0) - inputCountsAtStart.untrusted,
        };
        const allCollectedTraces = [...collectedTraces.values()];
        const expectedTraceKinds = MEASUREMENT_TRACE_KINDS[workload] ?? null;
        const measuredTraces = expectedTraceKinds
          ? allCollectedTraces.filter((trace) => expectedTraceKinds.includes(trace.kind))
          : allCollectedTraces;
        const measuredTraceKeys = new Set(
          measuredTraces.map((trace) => `${trace.sessionId ?? 'session'}:${trace.id}`),
        );
        const traceSummary = summarizeRunnerTraces(measuredTraces);
        Object.assign(record, measured, traceSummary, {
          allTraceCount: allCollectedTraces.length,
          measurementTraceKinds: expectedTraceKinds ?? ['all-observed'],
          heapSamples,
          coldFirstStroke,
          status: 'ok',
          scenePixelsSha256: baselineSceneFingerprint,
          rawSamples: allCollectedTraces.map((trace) => ({
            id: trace.id,
            sessionId: trace.sessionId,
            kind: trace.kind,
            measurementSelected: measuredTraceKeys.has(
              `${trace.sessionId ?? 'session'}:${trace.id}`,
            ),
            inputToCommitMs: trace.inputToCommitMs ?? null,
            inputToNextPaintMs: trace.inputToNextPaintMs ?? null,
            timestampSource: trace.timestampSource ?? null,
            presentationEvidence: trace.presentationEvidence ?? null,
            initialQueueDelayMs: trace.initialQueueDelayMs ?? null,
            spans: (trace.spans ?? []).map((span) => ({
              name: span.name,
              durationMs: span.durationMs,
              queueDelayMs: span.attributes?.queueDelayMs ?? null,
              eventSequenceId: span.attributes?.eventSequenceId ?? null,
            })),
          })),
        });
        const pathCounts = record.rendererQualification?.frameSummary?.actualPathCounts ?? {};
        const expectedPaths =
          RENDERER_MODE === 'webgl2'
            ? ['webgl2', 'webgl2-mixed']
            : RENDERER_MODE === 'canvas2d-worker'
              ? ['canvas2d-worker']
              : ['canvas2d-main'];
        record.rendererModeVerified = expectedPaths.some((path) => (pathCounts[path] ?? 0) > 0);
        if (!record.rendererModeVerified) {
          record.status = 'renderer-path-lost';
          record.error = `measured frames did not use requested mode ${RENDERER_MODE}`;
        }
        record.machineAfter = captureMachineState([process.pid, server?.pid, browserPid]);
        const evidence = performanceEvidence(
          measuredTraces,
          {
            ...partial,
            ...record,
            fixture: partial.fixture,
            sceneNodeCount: partial.sceneNodeCount,
          },
          MIN_WARM_SAMPLES,
        );
        record.evidence = {
          ...evidence,
          collectedTraceCount: measuredTraces.length,
          allCollectedTraceCount: allCollectedTraces.length,
          requiredWarmSamples: MIN_WARM_SAMPLES,
        };
        record.performanceOutcome = evidence.performanceOutcome;
        record.promotionEligible = evidence.promotionEligible;
        record.promotionBlockers = evidence.promotionBlockers;
        record.runtimeErrors = [...partial.runtimeErrors];
        const reportedRenderer = String(partial.webglRuntimeEvidence?.glRenderer ?? '');
        const softwareRenderer =
          partial.webglRuntimeEvidence?.softwareRendering === true ||
          /(swiftshader|llvmpipe|lavapipe|softpipe|swrast|software raster)/i.test(reportedRenderer);
        record.rendererExecution = {
          reportedRenderer: reportedRenderer || null,
          hardwareExecution: 'unknown',
          compatibilityOnly: softwareRenderer,
        };
        const evidenceForValidity = {
          insufficientSamples: evidence.insufficientSamples,
          presentationUnavailable: evidence.presentationUnavailable,
          thresholdBreaches: evidence.thresholdBreaches,
          softwareRenderer,
          instrumentationError:
            partial.runtimeErrors.length > 0 ||
            (record.interactionBreakdown?.instrumentationErrors ?? 0) > 0 ||
            (record.interactionBreakdown?.missingPresentation ?? 0) > 0,
        };
        record.validity = worstValidity(
          classifyRun(beforeState, partial.identity, null, CPU_COUNT),
          classifyRun(record.machineAfter, partial.identity, evidenceForValidity, CPU_COUNT),
        );
        if (softwareRenderer) record.validity = worstValidity(record.validity, 'software_renderer');
        if ((record.trustedInput?.measuredUntrusted ?? 0) > 0) {
          record.validity = worstValidity(record.validity, 'instrumentation_error');
        }
        if (!record.rendererModeVerified) {
          record.validity = worstValidity(record.validity, 'instrumentation_error');
        }
        if (record.runtimeErrors.length > 0) {
          record.status = 'runtime-error';
          record.error = `benchmark page emitted ${record.runtimeErrors.length} console or page error(s)`;
          record.performanceOutcome = 'invalid-run';
          record.promotionEligible = false;
          record.promotionBlockers = [
            ...new Set([...(record.promotionBlockers ?? []), 'runtime-errors']),
          ];
        }

        // Measurement availability and measured performance are separate:
        // valid slow traces remain usable for choosing a baseline target.
        const traceFailure = measuredTraceFailure(
          workload,
          measuredTraces.length,
          record.interactionBreakdown?.missingPresentation ?? 0,
        );
        if (traceFailure) {
          record.status = traceFailure.status;
          record.error = traceFailure.error;
        }
        if (record.validity !== 'valid' || record.status !== 'ok') exitCode = 1;
      } catch (error) {
        // One failed workload must not lose the others.
        record.status = 'failed';
        record.error = error instanceof Error ? error.message : String(error);
      }
      partial.workloads.push(record);
      const inputToCommit = record.interactions?.inputToCommit;
      const inputToCommitP95 = inputToCommit?.count
        ? `${inputToCommit.p95.toFixed(1)}ms (${inputToCommit.count} samples)`
        : 'n/a (0 samples)';
      const summary = record.interactions
        ? `commit p95 ${inputToCommitP95}, ${record.traceCount} traces`
        : '';
      console.log(`  ${workload}: ${record.status}${summary}`);
    }
  }
  const terminationReason = PREFLIGHT_ONLY
    ? rendererAvailable
      ? 'preflight completed'
      : 'requested renderer unavailable'
    : rendererAvailable
      ? 'completed'
      : 'requested renderer unavailable';
  flush(terminationReason);
} catch (error) {
  partial.errors.push(error instanceof Error ? error.message : String(error));
  partial.errorStack = error instanceof Error ? (error.stack ?? null) : null;
  flush('aborted');
  exitCode = 1;
} finally {
  await browser?.close();
  server?.kill();
}

process.exit(exitCode);
