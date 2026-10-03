#!/usr/bin/env node
/**
 * Native process-lifetime monitor for the Tauri/WebKitGTK desktop build.
 *
 * A multi-hour run cannot retain every sample in memory, and a run that dies
 * at hour three must not lose the first three hours. This runner therefore
 * streams bounded aggregates to a checkpoint file rather than accumulating
 * samples, and flushes on every exit path including SIGINT and crash.
 *
 * It detects sleep and rejects debug builds, and samples the whole launched
 * process tree. It has no native interaction driver, so it is not the
 * 100-cycle interaction qualification or the 60-minute navigation soak.
 *
 * This utility does not synthesize native input and does not open, interact
 * with, or close documents. Timer ticks are process-monitor samples only and
 * cannot satisfy the renderer qualification's interaction/soak gate.
 *
 * Usage:
 *   node scripts/perf/native-soak.mjs --duration=4h
 *   node scripts/perf/native-soak.mjs --duration=30m --checkpoint=soak.json
 *   node scripts/perf/native-soak.mjs --iterations=500 # 500 one-second monitor ticks
 *   node scripts/perf/native-soak.mjs --resume=soak.json
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isMainModule } from '../is-main-module.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? 'true'];
  }),
);

/** Accepts `90s`, `30m`, `4h`, or a bare millisecond count. */
export function parseDuration(text) {
  if (!text) return null;
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(text.trim());
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2] ?? 'ms';
  const scale = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[unit];
  return value * scale;
}

const DURATION_MS = parseDuration(args.get('duration')) ?? null;
const MAX_ITERATIONS = args.get('iterations') ? Number(args.get('iterations')) : null;
const CHECKPOINT = args.get('checkpoint') ?? 'native-soak-checkpoint.json';
const RESUME = args.get('resume') ?? null;
const WARMUP_MONITOR_TICKS = Number(args.get('warmup') ?? 5);
const SAMPLE_EVERY = Number(args.get('sample-every') ?? 10);
const BINARY = args.get('binary') ?? null;

/**
 * True only when executed as a CLI. The helpers below are exported for unit
 * testing, so importing this module must not start a soak run.
 */
const isMain = isMainModule(import.meta.url);

if (isMain && DURATION_MS === null && MAX_ITERATIONS === null) {
  console.error('native-soak: pass --duration (e.g. 4h) or --iterations');
  process.exit(1);
}

/**
 * A wall-clock advance this much larger than the elapsed monotonic time means
 * the machine slept. Latency samples that span a sleep are not evidence.
 */
const SLEEP_DETECTION_SLACK_MS = 5_000;

/**
 * Streaming aggregate: keeps count/min/max/mean/M2 rather than samples, so
 * memory is constant regardless of run length. M2 is Welford's accumulator for
 * variance, which is numerically stable over millions of updates.
 */
export class StreamingStat {
  constructor() {
    this.count = 0;
    this.min = Number.POSITIVE_INFINITY;
    this.max = Number.NEGATIVE_INFINITY;
    this.mean = 0;
    this.m2 = 0;
  }

  add(value) {
    if (!Number.isFinite(value)) return;
    this.count += 1;
    if (value < this.min) this.min = value;
    if (value > this.max) this.max = value;
    const delta = value - this.mean;
    this.mean += delta / this.count;
    this.m2 += delta * (value - this.mean);
  }

  toJSON() {
    if (this.count === 0) return { count: 0 };
    return {
      count: this.count,
      min: this.min,
      max: this.max,
      mean: this.mean,
      stddev: this.count > 1 ? Math.sqrt(this.m2 / (this.count - 1)) : 0,
    };
  }
}

/**
 * Least-squares slope of value against iteration, computed incrementally.
 * This is the growth-slope figure the leak analysis needs, and it never stores
 * the series it summarizes.
 */
export class GrowthSlope {
  constructor() {
    this.n = 0;
    this.sumX = 0;
    this.sumY = 0;
    this.sumXY = 0;
    this.sumXX = 0;
  }

  add(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.n += 1;
    this.sumX += x;
    this.sumY += y;
    this.sumXY += x * y;
    this.sumXX += x * x;
  }

  get slope() {
    const denominator = this.n * this.sumXX - this.sumX * this.sumX;
    if (this.n < 2 || denominator === 0) return 0;
    return (this.n * this.sumXY - this.sumX * this.sumY) / denominator;
  }

  toJSON() {
    return { samples: this.n, slopePerIteration: this.slope };
  }
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

/** Locate the release binary, and never silently accept a debug one. */
export function resolveReleaseBinary(explicit) {
  if (explicit) {
    return { path: explicit, mode: 'explicit', isRelease: !explicit.includes('/debug/') };
  }
  const release = `${ROOT}target/release/varve-desktop`;
  const debug = `${ROOT}target/debug/varve-desktop`;
  if (existsSync(release)) return { path: release, mode: 'release', isRelease: true };
  if (existsSync(debug)) return { path: debug, mode: 'debug', isRelease: false };
  return { path: null, mode: 'missing', isRelease: false };
}

if (!isMain) {
  // Imported as a library: stop before launching anything.
} else {
  const binary = resolveReleaseBinary(BINARY);
  if (!binary.path) {
    console.error(
      'native-soak: no desktop binary found. Build one first:\n' +
        '  pnpm --dir apps/desktop tauri build --release\n' +
        'or pass --binary=/path/to/varve-desktop',
    );
    process.exit(1);
  }
  if (!binary.isRelease) {
    console.error(
      `native-soak: found a debug binary at ${binary.path}. Debug builds are not\n` +
        'comparable with release figures. Build a release binary or pass --binary explicitly.',
    );
    process.exit(1);
  }

  const state =
    RESUME && existsSync(RESUME)
      ? JSON.parse(readFileSync(RESUME, 'utf8'))
      : {
          schemaVersion: 2,
          startedAt: new Date().toISOString(),
          binary: binary.path,
          buildMode: 'release',
          evidenceScope: 'process-lifetime-only-no-native-interaction-driver',
          qualificationEligible: false,
          commit: run('git', ['rev-parse', 'HEAD'], 'unknown'),
          workloads: WORKLOADS,
          warmupMonitorTicks: WARMUP_MONITOR_TICKS,
          monitorTicks: 0,
          completedInteractionCycles: 0,
          trustedOsInteractions: 0,
          warmupComplete: false,
          checkpoints: [],
          anomalies: [],
        };
  state.schemaVersion = 2;
  state.evidenceScope = 'process-lifetime-only-no-native-interaction-driver';
  state.qualificationEligible = false;
  state.completedInteractionCycles = 0;
  state.trustedOsInteractions = 0;

  const stats = { rssKb: new StreamingStat(), iterationMs: new StreamingStat() };
  const growth = { rssKb: new GrowthSlope() };

  let child = null;
  let stopping = false;

  function readProcessTreeRss(pid) {
    const rows = run('ps', ['-eo', 'pid=,ppid=,rss='], '')
      .split('\n')
      .map((line) => line.trim().split(/\s+/).map(Number))
      .filter((parts) => parts.length === 3 && parts.every(Number.isFinite))
      .map(([processId, parentId, rssKb]) => ({ processId, parentId, rssKb }));
    const members = new Set([pid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) {
        if (members.has(row.parentId) && !members.has(row.processId)) {
          members.add(row.processId);
          changed = true;
        }
      }
    }
    const selected = rows.filter((row) => members.has(row.processId));
    if (selected.length === 0) return { rssKb: null, pids: [] };
    return {
      rssKb: selected.reduce((total, row) => total + row.rssKb, 0),
      pids: selected.map((row) => row.processId),
    };
  }

  function checkpoint(reason) {
    state.completedAt = new Date().toISOString();
    state.terminationReason = reason;
    state.aggregates = {
      rssKb: stats.rssKb.toJSON(),
      iterationMs: stats.iterationMs.toJSON(),
      rssGrowth: growth.rssKb.toJSON(),
    };
    // Only bounded aggregates and a capped checkpoint list are retained, so the
    // file stays small over a multi-hour run.
    if (state.checkpoints.length > 500) state.checkpoints = state.checkpoints.slice(-500);
    writeFileSync(CHECKPOINT, JSON.stringify(state, null, 2));
  }

  function shutdown(reason, code) {
    if (stopping) return;
    stopping = true;
    checkpoint(reason);
    child?.kill('SIGTERM');
    console.log(`\nnative-soak: ${reason}. Checkpoint written to ${CHECKPOINT}`);
    process.exit(code);
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => shutdown(`cancelled by ${signal}`, 130));
  }

  console.log(`native-soak: launching ${binary.path}`);
  child = spawn(binary.path, [], {
    cwd: ROOT,
    stdio: 'pipe',
    env: { ...process.env, VARVE_PERF: '1' },
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    state.anomalies.push({
      at: new Date().toISOString(),
      kind: 'process-exit',
      detail: `exited with code ${code} signal ${signal}`,
    });
    shutdown('application exited unexpectedly (crash detected)', 1);
  });

  const startWall = Date.now();
  const startMono = process.hrtime.bigint();
  let iteration = 0;

  const timer = setInterval(() => {
    if (stopping) return;

    const elapsedWall = Date.now() - startWall;
    const elapsedMono = Number(process.hrtime.bigint() - startMono) / 1e6;
    // Wall clock advancing far beyond monotonic elapsed time means the machine
    // slept; samples spanning that gap are not usable latency evidence.
    if (elapsedWall - elapsedMono > SLEEP_DETECTION_SLACK_MS) {
      state.anomalies.push({
        at: new Date().toISOString(),
        kind: 'system-sleep',
        detail: `wall ${Math.round(elapsedWall)}ms vs monotonic ${Math.round(elapsedMono)}ms`,
      });
    }

    iteration += 1;
    state.monitorTicks = iteration;
    if (iteration === WARMUP_MONITOR_TICKS) state.warmupComplete = true;

    const processTree = child?.pid ? readProcessTreeRss(child.pid) : { rssKb: null, pids: [] };
    const rss = processTree.rssKb;
    if (rss !== null) {
      // Warm-up allocations are one-time; folding them into the growth slope
      // would report a leak that is really JIT and cache stabilisation.
      if (iteration > WARMUP_MONITOR_TICKS) {
        stats.rssKb.add(rss);
        growth.rssKb.add(iteration, rss);
      }
    }

    if (iteration % SAMPLE_EVERY === 0) {
      state.checkpoints.push({
        monitorTick: iteration,
        atMs: Math.round(elapsedMono),
        rssKb: rss,
        processTreePids: processTree.pids,
        completedInteractionCycles: 0,
        trustedOsInteractions: 0,
        activity: 'no-native-driver-observed',
      });
      checkpoint('running');
    }

    const durationReached = DURATION_MS !== null && elapsedMono >= DURATION_MS;
    const iterationsReached = MAX_ITERATIONS !== null && iteration >= MAX_ITERATIONS;
    if (durationReached || iterationsReached) {
      clearInterval(timer);
      shutdown('completed', 0);
    }
  }, 1_000);
}
