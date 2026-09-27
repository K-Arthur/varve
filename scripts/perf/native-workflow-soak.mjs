#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
/**
 * Run repeated open/edit/navigate/brush/save/close workflows in the real
 * Tauri/WebKitGTK app through WDIO. Pointer and wheel events are DOM-synthetic;
 * this records native-app lifecycle evidence, not trusted OS input or
 * input-to-photon latency.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryPlateau } from './nativeQualification.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function parseArguments(argv) {
  return new Map(
    argv.map((argument) => {
      const [key, ...tail] = argument.replace(/^--/, '').split('=');
      return [key, tail.join('=') || 'true'];
    }),
  );
}

export function validateWorkflowEvents(events, targetCycles) {
  const blockers = [];
  if (events.length !== targetCycles)
    blockers.push(`completed-${events.length}-of-${targetCycles}-cycles`);
  events.forEach((event, index) => {
    if (event?.schemaVersion !== 1 || event?.type !== 'cycleComplete') {
      blockers.push(`cycle-${index + 1}-event-invalid`);
    }
    if (event?.index !== index + 1) blockers.push(`cycle-${index + 1}-sequence-invalid`);
    for (const phase of ['open', 'interact', 'save', 'close']) {
      if (event?.phases?.[phase] !== 'completed')
        blockers.push(`cycle-${index + 1}-${phase}-missing`);
    }
    if (event?.input?.source !== 'webdriver-dom-synthetic' || event?.input?.trusted !== false) {
      blockers.push(`cycle-${index + 1}-input-source-not-labeled-synthetic`);
    }
    if (
      event?.webview?.visible !== true ||
      !(event?.webview?.width > 0) ||
      !(event?.webview?.height > 0)
    ) {
      blockers.push(`cycle-${index + 1}-hidden-or-zero-size-webview`);
    }
    if (event?.pixels?.changed !== true || event?.pixels?.before === event?.pixels?.after) {
      blockers.push(`cycle-${index + 1}-artwork-pixels-did-not-change`);
    }
    if (
      typeof event?.screenshot?.path !== 'string' ||
      !Number.isFinite(event?.screenshot?.bytes) ||
      event.screenshot.bytes <= 1024
    ) {
      blockers.push(`cycle-${index + 1}-screenshot-evidence-missing`);
    }
  });
  return [...new Set(blockers)];
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function processTree(rootPid) {
  let rows;
  try {
    rows = execFileSync('ps', ['-eo', 'pid=,ppid=,rss='], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/).map(Number))
      .filter((values) => values.length === 3 && values.every(Number.isFinite))
      .map(([pid, ppid, rssKb]) => ({ pid, ppid, rssKb }));
  } catch {
    return { pids: [], rssKb: null };
  }
  const pids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (pids.has(row.ppid) && !pids.has(row.pid)) {
        pids.add(row.pid);
        changed = true;
      }
    }
  }
  const selected = rows.filter((row) => pids.has(row.pid));
  return {
    pids: selected.map((row) => row.pid),
    rssKb: selected.length ? selected.reduce((total, row) => total + row.rssKb, 0) : null,
  };
}

function hostSnapshot() {
  try {
    const memory = readFileSync('/proc/meminfo', 'utf8');
    const availableKb = Number(memory.match(/^MemAvailable:\s+(\d+)/m)?.[1] ?? NaN);
    const load1 = Number(readFileSync('/proc/loadavg', 'utf8').split(/\s+/)[0]);
    const pressure = existsSync('/proc/pressure/memory')
      ? Number(
          readFileSync('/proc/pressure/memory', 'utf8').match(/^some\s+.*?avg10=([\d.]+)/m)?.[1] ??
            NaN,
        )
      : null;
    return {
      memAvailableKb: Number.isFinite(availableKb) ? availableKb : null,
      load1: Number.isFinite(load1) ? load1 : null,
      memoryPressureAvg10: Number.isFinite(pressure) ? pressure : null,
    };
  } catch {
    return { memAvailableKb: null, load1: null, memoryPressureAvg10: null };
  }
}

function readEvents(path, seen) {
  if (!existsSync(path)) return seen;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines.slice(seen)) {
    try {
      seen += 1;
      const event = JSON.parse(line);
      event.screenshot = {
        ...event.screenshot,
        exists: typeof event.screenshot?.path === 'string' && existsSync(event.screenshot.path),
      };
      return { seen, event };
    } catch {
      seen += 1;
      return { seen, event: null };
    }
  }
  return seen;
}

async function run() {
  const args = parseArguments(process.argv.slice(2));
  if (args.has('help')) {
    console.log(
      'Usage: node scripts/perf/native-workflow-soak.mjs --binary=PATH [--cycles=100] [--out=FILE.json]',
    );
    return;
  }
  if (process.platform !== 'linux') {
    throw new Error('native workflow soak currently supports Linux Tauri/WebKitGTK only');
  }

  const targetCycles = Number(args.get('cycles') ?? 100);
  if (!Number.isInteger(targetCycles) || targetCycles < 1) {
    throw new Error('--cycles must be a positive integer');
  }
  const binary = resolve(
    args.get('binary') ??
      process.env.VARVE_DESKTOP_BINARY ??
      'apps/desktop/src-tauri/target/debug/varve-desktop',
  );
  if (!existsSync(binary)) throw new Error(`Tauri binary does not exist: ${binary}`);
  const out = resolve(
    args.get('out') ?? `native-fluidity-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  mkdirSync(dirname(out), { recursive: true });

  const runDir = mkdtempSync(join(tmpdir(), 'varve-native-fluidity-'));
  const eventsPath = join(runDir, 'cycles.jsonl');
  const screenshots = join(runDir, 'screenshots');
  const profile = join(runDir, 'profile');
  mkdirSync(profile, { recursive: true });
  const state = {
    schemaVersion: 1,
    status: 'running',
    targetCycles,
    completedCycles: 0,
    qualificationEligible: false,
    evidenceScope: 'tauri-webkitgtk-app-workflows-with-dom-synthetic-input',
    presentationEvidence: 'unavailable; no input-to-photon claim',
    source: {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      dirty:
        execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim()
          .length > 0,
      binary,
      binarySha256: sha256(binary),
      buildMode: binary.includes('/release/') ? 'release' : 'debug-or-custom',
    },
    host: {
      platform: process.platform,
      arch: process.arch,
      sessionType: process.env.XDG_SESSION_TYPE ?? 'unknown',
    },
    isolatedProfile: profile,
    screenshotsDirectory: screenshots,
    processTreeSnapshots: [],
    hostSnapshots: [],
    cycles: [],
    anomalies: [],
    blockers: [],
  };
  const save = () => writeFileSync(out, JSON.stringify(state, null, 2));
  let child;
  let lastCompletedAt = Date.now();
  let wallAtStart = Date.now();
  let monoAtStart = process.hrtime.bigint();
  let seen = 0;
  let pendingError = null;
  let stdoutTail = '';
  const cycleSnapshots = new Map();
  const consumeEvidence = () => {
    while (true) {
      const result = readEvents(eventsPath, seen);
      if (typeof result !== 'object' || result === null || !('seen' in result)) return;
      seen = result.seen;
      if (!result.event) {
        state.anomalies.push({ kind: 'malformed-cycle-event', line: seen });
        continue;
      }
      const event = result.event;
      const snapshot = {
        cycle: event.index,
        at: new Date().toISOString(),
        processTree: processTree(child.pid),
        host: hostSnapshot(),
      };
      cycleSnapshots.set(event.index, snapshot);
      state.cycles.push(event);
      state.completedCycles = state.cycles.length;
      lastCompletedAt = Date.now();
      save();
    }
  };

  try {
    child = spawn('pnpm', ['exec', 'wdio', 'run', 'wdio.conf.ts'], {
      cwd: ROOT,
      env: {
        ...process.env,
        VARVE_DESKTOP_BINARY: binary,
        VARVE_WDIO_SPECS: './tests/wdio/native-fluidity-cycle.e2e.ts',
        VARVE_NATIVE_FLUIDITY_CYCLES: String(targetCycles),
        VARVE_NATIVE_FLUIDITY_EVENTS: eventsPath,
        VARVE_NATIVE_FLUIDITY_SCREENSHOTS: screenshots,
        XDG_DATA_HOME: join(profile, 'data'),
        XDG_CONFIG_HOME: join(profile, 'config'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => {
      stdoutTail = `${stdoutTail}${chunk}`.slice(-16_000);
    });
    child.stderr.on('data', (chunk) => {
      stdoutTail = `${stdoutTail}${chunk}`.slice(-16_000);
    });
    child.on('error', (error) => {
      pendingError = error;
    });

    let exit = null;
    child.once('exit', (code, signal) => {
      exit = { code, signal };
    });
    while (!exit) {
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 1000));
      if (pendingError) throw pendingError;
      const wall = Date.now();
      const mono = process.hrtime.bigint();
      const wallDelta = wall - wallAtStart;
      const monoDelta = Number(mono - monoAtStart) / 1e6;
      if (wallDelta - monoDelta > 5000) {
        state.anomalies.push({
          kind: 'system-sleep',
          at: new Date().toISOString(),
          driftMs: wallDelta - monoDelta,
        });
        wallAtStart = wall;
        monoAtStart = mono;
      }

      consumeEvidence();
      if (Date.now() - lastCompletedAt > 180_000) {
        state.anomalies.push({
          kind: 'workflow-stalled',
          afterCycle: state.completedCycles,
          idleMs: Date.now() - lastCompletedAt,
        });
        child.kill('SIGTERM');
        throw new Error('native workflow did not complete a cycle within 180 seconds');
      }
    }

    consumeEvidence();
    state.processTreeSnapshots = [...cycleSnapshots.values()].map(
      (snapshot) => snapshot.processTree,
    );
    state.hostSnapshots = [...cycleSnapshots.values()].map((snapshot) => snapshot.host);
    const eventBlockers = validateWorkflowEvents(state.cycles, targetCycles);
    state.blockers.push(...eventBlockers);
    for (const event of state.cycles) {
      if (!event.screenshot?.exists)
        state.blockers.push(`cycle-${event.index}-screenshot-file-missing`);
    }
    if (exit.code !== 0) state.blockers.push(`wdio-exited-${exit.code ?? exit.signal}`);
    if (state.anomalies.length > 0) state.blockers.push('environment-or-workflow-anomaly-observed');
    const rssValues = state.processTreeSnapshots.map((snapshot) => snapshot?.rssKb);
    state.memoryPlateau = memoryPlateau(rssValues);
    if (targetCycles >= 100 && state.memoryPlateau.passed !== true) {
      state.blockers.push(state.memoryPlateau.reason ?? 'memory-plateau-not-demonstrated');
    }
    state.status = state.blockers.length === 0 ? 'completed-synthetic-workflows' : 'inconclusive';
    state.qualificationEligible = false;
    state.completedAt = new Date().toISOString();
    state.wdioOutputTail = stdoutTail;
    save();
    if (state.status !== 'completed-synthetic-workflows') process.exitCode = 1;
  } catch (error) {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 2000));
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    state.status = 'failed';
    state.error = error instanceof Error ? error.message : String(error);
    state.completedCycles = state.cycles.length;
    state.wdioOutputTail = stdoutTail;
    state.completedAt = new Date().toISOString();
    save();
    process.exitCode = 1;
  } finally {
    rmSync(profile, { recursive: true, force: true });
    console.log(
      `native-workflow-soak: ${state.status}; ${state.completedCycles}/${targetCycles} cycles; evidence ${out}`,
    );
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  run().catch((error) => {
    console.error(
      `native-workflow-soak: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
