#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
/**
 * Host-local native driver orchestrator. The driver performs OS-level input
 * and emits strict JSONL evidence; this process never invents interactions.
 * See docs/perf/webgl2-qualification.md for the event protocol.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  memoryPlateau,
  validateBenchmarkEvent,
  validateCycleEvent,
  validateHardwareExecutionEvidence,
  validateNavigationEvent,
  validatePresentationEvidence,
} from './nativeQualification.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? 'true'];
  }),
);
const MODE = args.get('mode') ?? 'cycles';
const RENDERER = args.get('renderer') ?? 'webgl2';
const FIXTURE = args.get('fixture') ?? null;
const WORKLOAD = args.get('workload') ?? null;
const BLOCK = Number(args.get('block') ?? 0);
const SCENARIO_PATH = args.get('scenario') ? resolve(args.get('scenario')) : null;
const DRIVER = args.get('driver') ? resolve(args.get('driver')) : null;
const BINARY = args.get('binary') ? resolve(args.get('binary')) : null;
const OUT = resolve(
  args.get('out') ??
    join(
      ROOT,
      'reports',
      'perf',
      `native-webgl2-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    ),
);
const TARGET_CYCLES = Number(args.get('cycles') ?? 100);
const TARGET_INTERACTIONS = Number(args.get('interactions') ?? 120);
const WARMUP_INTERACTIONS = 10;
const DURATION_MS = Number(args.get('duration-ms') ?? 60 * 60 * 1000);

function captureClockCorrelation(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    verified: value.verified === true,
    sourceClockId: value.sourceClockId ?? null,
    targetClockId: value.targetClockId ?? null,
    offsetMs: Number.isFinite(value.offsetMs) ? value.offsetMs : null,
    uncertaintyMs: Number.isFinite(value.uncertaintyMs) ? value.uncertaintyMs : null,
  };
}

function captureHardwareEvidence(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    source: value.source ?? null,
    submissionIdentity: value.submissionIdentity ?? null,
    executionIdentity: value.executionIdentity ?? null,
    deviceProfileId: value.deviceProfileId ?? null,
    softwareRenderer: typeof value.softwareRenderer === 'boolean' ? value.softwareRenderer : null,
  };
}

function shortDiagnosticText(value) {
  if (typeof value !== 'string') return null;
  return (
    [...value]
      .filter((character) => {
        const point = character.codePointAt(0) ?? 0;
        return point > 0x1f && (point < 0x7f || point > 0x9f);
      })
      .join('')
      .trim()
      .slice(0, 160) || null
  );
}

function captureWebviewGraphics(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    source: shortDiagnosticText(value.source),
    backend: shortDiagnosticText(value.backend),
    vendor: shortDiagnosticText(value.vendor),
    renderer: shortDiagnosticText(value.renderer),
    deviceProfileId: shortDiagnosticText(value.deviceProfileId),
    softwareRenderer: typeof value.softwareRenderer === 'boolean' ? value.softwareRenderer : null,
  };
}

function captureNativeVulkan(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    discovery: ['unavailable', 'discovered', 'runtime-loadable', 'device-usable'].includes(
      value.discovery,
    )
      ? value.discovery
      : 'unknown',
    executionVerified: value.executionVerified === true,
    deviceProfileId: shortDiagnosticText(value.deviceProfileId),
  };
}

function capturePhaseTimings(value) {
  if (!value || typeof value !== 'object') return null;
  const fields = [
    'scenePreparationMs',
    'replayMs',
    'queueingMs',
    'gpuSubmitMs',
    'gpuExecutionMs',
    'copyCompositeMs',
    'presentationWaitMs',
  ];
  const timings = Object.fromEntries(
    fields
      .filter((field) => Number.isFinite(value[field]) && value[field] >= 0)
      .map((field) => [field, value[field]]),
  );
  return Object.keys(timings).length ? timings : null;
}

function captureThrottlingEvidence(value) {
  if (!value || typeof value !== 'object') return null;
  const capture = (component) => {
    const reading = value[component];
    return {
      status: ['clear', 'throttled'].includes(reading?.status) ? reading.status : 'unavailable',
      source: shortDiagnosticText(reading?.source),
    };
  };
  return { cpu: capture('cpu'), gpu: capture('gpu') };
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function loadScenario() {
  if (!SCENARIO_PATH || !existsSync(SCENARIO_PATH)) return null;
  const scenario = JSON.parse(readFileSync(SCENARIO_PATH, 'utf8'));
  const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
  const viewport = scenario?.viewport;
  const camera = scenario?.camera;
  const valid =
    scenario?.fixtureId === FIXTURE &&
    scenario?.gestureId === WORKLOAD &&
    hash(scenario?.fixtureSha256) &&
    Array.isArray(scenario?.assetSha256s) &&
    scenario.assetSha256s.every(hash) &&
    hash(scenario?.gestureSequenceSha256) &&
    Number.isInteger(viewport?.width) &&
    viewport.width > 0 &&
    Number.isInteger(viewport?.height) &&
    viewport.height > 0 &&
    Number.isFinite(viewport?.dpr) &&
    viewport.dpr > 0 &&
    Number.isFinite(camera?.zoom) &&
    camera.zoom > 0 &&
    Number.isFinite(camera?.panX) &&
    Number.isFinite(camera?.panY) &&
    Number.isFinite(camera?.rotation) &&
    typeof scenario?.theme === 'string' &&
    scenario.theme.length > 0;
  if (!valid)
    throw new Error(
      'benchmark scenario must provide matching fixture/gesture ids, SHA-256 asset/gesture hashes, viewport/DPR, camera, and theme',
    );
  return {
    sha256: sha256(SCENARIO_PATH),
    fixtureId: scenario.fixtureId,
    fixtureSha256: scenario.fixtureSha256,
    assetSha256s: scenario.assetSha256s,
    gestureId: scenario.gestureId,
    gestureSequenceSha256: scenario.gestureSequenceSha256,
    viewport: { width: viewport.width, height: viewport.height, dpr: viewport.dpr },
    camera: {
      zoom: camera.zoom,
      panX: camera.panX,
      panY: camera.panY,
      rotation: camera.rotation,
    },
    theme: scenario.theme,
  };
}

function processTree(pid) {
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,rss=,pcpu='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((parts) => parts.length === 4 && parts.every(Number.isFinite))
    .map(([processId, parentId, rssKb, cpuPercent]) => ({
      processId,
      parentId,
      rssKb,
      cpuPercent,
    }));
  const ids = new Set([pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (ids.has(row.parentId) && !ids.has(row.processId)) {
        ids.add(row.processId);
        changed = true;
      }
    }
  }
  const selected = rows.filter((row) => ids.has(row.processId));
  const competingHeavyProcessCount = rows.filter(
    (row) => !ids.has(row.processId) && (row.rssKb >= 768 * 1024 || row.cpuPercent >= 25),
  ).length;
  return {
    pids: selected.map((row) => row.processId),
    rssKb: selected.length ? selected.reduce((sum, row) => sum + row.rssKb, 0) : null,
    competingHeavyProcessCount,
  };
}

function hostState() {
  const mem = readFileSync('/proc/meminfo', 'utf8');
  const available = Number(mem.match(/MemAvailable:\s+(\d+)/)?.[1] ?? NaN);
  const load = readFileSync('/proc/loadavg', 'utf8').split(/\s+/).map(Number)[0] ?? null;
  const memoryPsi = existsSync('/proc/pressure/memory')
    ? Number(
        readFileSync('/proc/pressure/memory', 'utf8').match(/^some\s+.*?avg10=([\d.]+)/m)?.[1] ??
          NaN,
      )
    : null;
  const cpuPsi = existsSync('/proc/pressure/cpu')
    ? Number(
        readFileSync('/proc/pressure/cpu', 'utf8').match(/^some\s+.*?avg10=([\d.]+)/m)?.[1] ?? NaN,
      )
    : null;
  const cpuCount = Number(execFileSync('nproc', [], { encoding: 'utf8' }).trim()) || null;
  const thermalMaxC = (() => {
    try {
      const zones = execFileSync('sh', ['-c', 'ls /sys/class/thermal/thermal_zone*'], {
        encoding: 'utf8',
      })
        .trim()
        .split('\n')
        .filter(Boolean);
      const values = zones
        .map((zone) => Number(readFileSync(`${zone}/temp`, 'utf8').trim()))
        .filter(Number.isFinite)
        .map((value) => (value > 1000 ? value / 1000 : value));
      return values.length ? Math.max(...values) : null;
    } catch {
      return null;
    }
  })();
  const frequency = (path) => {
    try {
      const value = Number(readFileSync(path, 'utf8').trim());
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  };
  const currentKHz = frequency('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq');
  const maxKHz = frequency('/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq');
  return {
    load1: Number.isFinite(load) ? load : null,
    cpuCount,
    contended: Number.isFinite(load) && cpuCount !== null && load > cpuCount * 1.5,
    memAvailableKb: Number.isFinite(available) ? available : null,
    memoryPressureAvg10: Number.isFinite(memoryPsi) ? memoryPsi : null,
    cpuPressureAvg10: Number.isFinite(cpuPsi) ? cpuPsi : null,
    memoryPressure:
      (Number.isFinite(available) && available < 1024 * 1024) ||
      (Number.isFinite(memoryPsi) && memoryPsi > 1),
    cpuPressure: Number.isFinite(cpuPsi) ? cpuPsi : null,
    thermalMaxC,
    cpuFrequencyFraction:
      currentKHz !== null && maxKHz !== null && maxKHz > 0 ? currentKHz / maxKHz : null,
  };
}

function unsupported(reason) {
  const result = {
    schemaVersion: 1,
    status: 'unsupported',
    qualificationEligible: false,
    reason,
    generatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.error(`native qualification unavailable: ${reason}`);
  console.error(`result: ${OUT}`);
  process.exitCode = 2;
}

function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (percent) =>
    sorted.length ? sorted[Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1)] : null;
  return {
    count: sorted.length,
    p50: at(50),
    p95: at(95),
    p99: at(99),
    max: sorted.at(-1) ?? null,
  };
}

async function main() {
  if (process.platform !== 'linux')
    return unsupported('native Linux process-tree monitor is currently Linux-only');
  if (!['cycles', 'navigation', 'benchmark'].includes(MODE)) {
    throw new Error('--mode must be cycles, benchmark, or navigation');
  }
  if (!['webgl2', 'canvas2d-main', 'canvas2d-worker'].includes(RENDERER)) {
    throw new Error('--renderer must be webgl2, canvas2d-main, or canvas2d-worker');
  }
  if (!DRIVER || !existsSync(DRIVER)) {
    return unsupported(
      'no host-local OS-input driver is available; pass --driver=/path/to/adapter',
    );
  }
  if (!BINARY || !existsSync(BINARY)) {
    return unsupported(
      'a release Tauri binary is required through --binary=/path/to/varve-desktop',
    );
  }
  if (!BINARY.includes('/release/')) {
    return unsupported('debug binaries are excluded; use a release Tauri build');
  }
  if (MODE === 'cycles' && (!Number.isInteger(TARGET_CYCLES) || TARGET_CYCLES < 100)) {
    throw new Error('--cycles must be an integer >= 100');
  }
  if (MODE === 'benchmark') {
    if (
      !Number.isInteger(TARGET_INTERACTIONS) ||
      TARGET_INTERACTIONS < 100 ||
      TARGET_INTERACTIONS > 1000
    ) {
      throw new Error('--interactions must be an integer from 100 to 1000');
    }
    if (!FIXTURE || !WORKLOAD || !Number.isInteger(BLOCK) || BLOCK < 1 || BLOCK > 12) {
      throw new Error('benchmark mode requires --fixture, --workload, and --block=1..12');
    }
    if (!SCENARIO_PATH)
      throw new Error('benchmark mode requires --scenario=/path/to/frozen-scenario.json');
  }
  if (MODE === 'cycles' && RENDERER !== 'webgl2') {
    throw new Error(
      'open-interact-close resource cycles currently exercise --renderer=webgl2 only',
    );
  }
  if (MODE === 'navigation' && (!Number.isFinite(DURATION_MS) || DURATION_MS < 60 * 60 * 1000)) {
    throw new Error('the qualification navigation soak requires --duration-ms >= 3600000');
  }
  if (MODE === 'navigation' && RENDERER !== 'webgl2') {
    throw new Error('the native navigation soak currently qualifies the WebGL2 path only');
  }
  const scenario = MODE === 'benchmark' ? loadScenario() : null;

  const profileDir = mkdtempSync(join(tmpdir(), 'varve-webgl2-native-profile-'));
  const state = {
    schemaVersion: 1,
    status: 'running',
    mode: MODE,
    renderer: RENDERER,
    fixture: FIXTURE,
    workload: WORKLOAD,
    block: MODE === 'benchmark' ? BLOCK : null,
    scenario,
    startedAt: new Date().toISOString(),
    source: {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      dirty:
        execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim()
          .length > 0,
      binaryFile: basename(BINARY),
      binarySha256: sha256(BINARY),
      driverFile: basename(DRIVER),
    },
    host: {
      platform: process.platform,
      arch: process.arch,
      sessionType: process.env.XDG_SESSION_TYPE ?? 'unknown',
      wayland: Boolean(process.env.WAYLAND_DISPLAY),
    },
    isolatedProfile: basename(profileDir),
    targetCycles: MODE === 'cycles' ? TARGET_CYCLES : null,
    targetDurationMs: MODE === 'navigation' ? DURATION_MS : null,
    targetInteractions: MODE === 'benchmark' ? TARGET_INTERACTIONS : null,
    warmupInteractions: MODE === 'benchmark' ? WARMUP_INTERACTIONS : null,
    completedCycles: 0,
    nativeInteractions: 0,
    authoritativePresentationSamples: 0,
    presentationUnavailableSamples: 0,
    maxGpuTextureBytes: 0,
    maxGpuTextureEntries: 0,
    processTreeRssKb: [],
    applicationCacheBytes: [],
    events: [],
    invalidEvents: [],
    machineState: [],
    blockers: [],
  };
  const save = () => {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(state, null, 2));
  };
  const driverArgs = [
    '--varve-binary',
    BINARY,
    '--varve-mode',
    MODE,
    '--varve-renderer',
    RENDERER,
    '--varve-profile',
    profileDir,
    '--varve-output-protocol',
    'jsonl-v1',
    ...(MODE === 'cycles'
      ? ['--varve-cycles', String(TARGET_CYCLES)]
      : MODE === 'benchmark'
        ? [
            '--varve-interactions',
            String(TARGET_INTERACTIONS),
            '--varve-warmup',
            String(WARMUP_INTERACTIONS),
            '--varve-fixture',
            FIXTURE,
            '--varve-workload',
            WORKLOAD,
            '--varve-block',
            String(BLOCK),
            '--varve-scenario',
            SCENARIO_PATH,
            '--varve-scenario-sha256',
            scenario.sha256,
          ]
        : ['--varve-duration-ms', String(DURATION_MS)]),
  ];
  const child = spawn(DRIVER, driverArgs, {
    cwd: ROOT,
    env: {
      ...process.env,
      XDG_DATA_HOME: profileDir,
      XDG_CONFIG_HOME: join(profileDir, 'config'),
      VARVE_NATIVE_QUALIFICATION: '1',
      VARVE_NATIVE_QUALIFICATION_MODE: MODE,
      VARVE_NATIVE_QUALIFICATION_RENDERER: RENDERER,
      VARVE_NATIVE_QUALIFICATION_FIXTURE: FIXTURE ?? '',
      VARVE_NATIVE_QUALIFICATION_WORKLOAD: WORKLOAD ?? '',
      VARVE_NATIVE_QUALIFICATION_BLOCK: String(BLOCK),
      VARVE_NATIVE_QUALIFICATION_WARMUP: String(WARMUP_INTERACTIONS),
      VARVE_NATIVE_QUALIFICATION_SCENARIO_SHA256: scenario?.sha256 ?? '',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const startMono = process.hrtime.bigint();
  let expectedIndex = 1;
  let lastNavigationEventAt = Date.now();
  let stopping = false;
  let timedOut = false;
  let requestedStop = null;
  let targetReached = false;
  let targetStopTimer = null;
  let runTimeoutTimer = null;
  const stopDriver = (signal = 'SIGTERM') => {
    if (stopping) return;
    stopping = true;
    child.kill(signal);
  };
  const stopAfterTarget = (reason) => {
    if (targetReached) return;
    targetReached = true;
    requestedStop = reason;
    targetStopTimer = setTimeout(() => stopDriver(), 10_000);
    targetStopTimer.unref();
  };
  const durationTimer =
    MODE === 'navigation'
      ? setTimeout(() => {
          timedOut = true;
          requestedStop = 'navigation-duration-complete';
          stopDriver();
        }, DURATION_MS)
      : null;
  if (MODE !== 'navigation') {
    runTimeoutTimer = setTimeout(
      () => {
        timedOut = true;
        requestedStop = 'native-driver-timeout';
        stopDriver();
      },
      2 * 60 * 60 * 1000,
    );
    runTimeoutTimer.unref();
  }

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    try {
      const event = JSON.parse(line);
      const blockers =
        MODE === 'cycles'
          ? validateCycleEvent(event, expectedIndex)
          : MODE === 'benchmark'
            ? validateBenchmarkEvent(event, expectedIndex, {
                renderer: RENDERER,
                fixture: FIXTURE,
                workload: WORKLOAD,
                block: BLOCK,
              })
            : validateNavigationEvent(event, expectedIndex, RENDERER);
      if (blockers.length > 0) {
        state.invalidEvents.push({
          type: event?.type ?? null,
          index: event?.index ?? null,
          fixture: event?.fixture ?? null,
          workload: event?.workload ?? null,
          block: event?.block ?? null,
          blockers,
          at: new Date().toISOString(),
        });
        state.blockers.push(...blockers);
        save();
        return;
      }
      expectedIndex++;
      state.nativeInteractions++;
      if (MODE === 'cycles') state.completedCycles++;
      if (MODE === 'navigation') {
        const now = Date.now();
        if (now - lastNavigationEventAt > 65_000) {
          state.blockers.push('navigation-input-gap-over-65-seconds');
        }
        lastNavigationEventAt = now;
      }
      state.maxGpuTextureBytes = Math.max(state.maxGpuTextureBytes, event.gpuTextureBytes ?? 0);
      state.maxGpuTextureEntries = Math.max(
        state.maxGpuTextureEntries,
        event.gpuTextureEntries ?? 0,
      );
      const tree = processTree(child.pid);
      if (tree.rssKb !== null) state.processTreeRssKb.push(tree.rssKb);
      if (Number.isFinite(event.applicationCacheBytes))
        state.applicationCacheBytes.push(event.applicationCacheBytes);
      else state.blockers.push('application-cache-residency-unavailable');
      state.machineState.push({ ...hostState(), at: new Date().toISOString() });
      const presentation = validatePresentationEvidence(event);
      if (presentation.authoritative) state.authoritativePresentationSamples++;
      else state.presentationUnavailableSamples++;
      state.events.push({
        type: event.type,
        index: event.index,
        fixture: event.fixture ?? FIXTURE,
        workload: event.workload ?? WORKLOAD,
        block: event.block ?? (MODE === 'benchmark' ? BLOCK : null),
        phases: event.phases ?? null,
        foreground: event.foreground ?? null,
        inputSource: event.input.source,
        inputTrusted: event.input.trusted,
        inputIdentity: event.input.identity,
        inputClockId: event.input.clockId ?? null,
        inputMonotonicTimestampMs: event.input.monotonicTimestampMs ?? null,
        frameChanged: event.frame.changed,
        frameIdentity: event.frame.identity,
        presentationClockTrust: event.presentation?.clockTrust ?? 'unavailable',
        presentationClockId: event.presentation?.clockId ?? null,
        presentationMonotonicTimestampMs: event.presentation?.monotonicTimestampMs ?? null,
        presentationClockCorrelation: captureClockCorrelation(event.presentation?.clockCorrelation),
        declaredPresentationSource: event.presentation?.source ?? null,
        declaredPresentationUncertaintyMs: event.presentation?.uncertaintyMs ?? null,
        declaredInputToPresentationMs: event.presentation?.inputToPresentationMs ?? null,
        phaseTimingsMs: capturePhaseTimings(event.phaseTimingsMs),
        webviewGraphics: captureWebviewGraphics(event.webviewGraphics),
        nativeVulkan: captureNativeVulkan(event.nativeVulkan),
        throttlingEvidence: captureThrottlingEvidence(event.throttlingEvidence),
        rendererPath: event.rendererPath ?? 'unknown',
        hardwareExecution: event.hardwareExecution ?? 'unknown',
        hardwareExecutionEvidence: captureHardwareEvidence(event.hardwareExecutionEvidence),
        gpuSubmissionIdentity: event.gpuSubmissionIdentity ?? null,
        gpuSubmittedItems: event.gpuSubmittedItems ?? null,
        inputToPresentationMs: presentation.authoritative
          ? presentation.measuredInputToPresentationMs
          : null,
        presentationUncertaintyMs: presentation.authoritative
          ? presentation.totalUncertaintyMs
          : null,
        validatedPresentationSource: presentation.authoritative
          ? event.presentation.source
          : 'unavailable',
        gpuTextureBytes: event.gpuTextureBytes ?? null,
        gpuTextureEntries: event.gpuTextureEntries ?? null,
        applicationCacheBytes: event.applicationCacheBytes ?? null,
        processTreeRssKb: tree.rssKb,
        processTreePids: tree.pids,
        competingHeavyProcessCount: tree.competingHeavyProcessCount,
        at: new Date().toISOString(),
      });
      if (state.machineState.at(-1).memoryPressure)
        state.blockers.push('memory-pressure-during-native-run');
      if (state.machineState.at(-1).contended)
        state.blockers.push('host-load-above-contention-limit');
      if (state.machineState.at(-1).thermalMaxC > 90)
        state.blockers.push('host-thermal-limit-exceeded');
      if (state.machineState.at(-1).thermalMaxC === null)
        state.blockers.push('host-thermal-measurement-unavailable');
      if (
        state.machineState.at(-1).cpuPressure !== null &&
        state.machineState.at(-1).cpuPressure > 5
      ) {
        state.blockers.push('host-cpu-pressure-above-contention-limit');
      }
      if (tree.competingHeavyProcessCount > 0) {
        state.blockers.push('competing-heavy-processes-detected');
      }
      if (state.nativeInteractions % 10 === 0) save();
      if (MODE === 'cycles' && state.completedCycles >= TARGET_CYCLES)
        stopAfterTarget('cycle-target-reached');
      if (MODE === 'benchmark' && state.nativeInteractions >= TARGET_INTERACTIONS) {
        stopAfterTarget('interaction-target-reached');
      }
    } catch (error) {
      state.invalidEvents.push({
        blockers: ['invalid-jsonl-event'],
        detail: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
        at: new Date().toISOString(),
      });
      state.blockers.push('invalid-jsonl-event');
      save();
    }
  });

  process.on('SIGINT', () => stopDriver());
  process.on('SIGTERM', () => stopDriver());
  save();
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolveExit({ code, signal }));
  });
  if (durationTimer) clearTimeout(durationTimer);
  if (targetStopTimer) clearTimeout(targetStopTimer);
  if (runTimeoutTimer) clearTimeout(runTimeoutTimer);
  const elapsedMs = Number(process.hrtime.bigint() - startMono) / 1e6;
  state.elapsedMs = elapsedMs;
  state.driverExit = exitCode;
  state.requestedStop = requestedStop;
  state.completedAt = new Date().toISOString();

  if (MODE === 'cycles') {
    state.processTreeMemoryPlateau = memoryPlateau(state.processTreeRssKb);
    state.applicationCachePlateau = memoryPlateau(state.applicationCacheBytes, {
      absoluteAllowance: 8 * 1024 * 1024,
      unit: 'bytes',
    });
    if (state.processTreeRssKb.length < state.completedCycles) {
      state.blockers.push('process-tree-memory-samples-incomplete');
    }
    if (state.applicationCacheBytes.length < state.completedCycles) {
      state.blockers.push('application-cache-samples-incomplete');
    }
    if (state.completedCycles < TARGET_CYCLES)
      state.blockers.push('fewer-than-100-open-interact-close-cycles');
    if (!state.processTreeMemoryPlateau.passed)
      state.blockers.push(state.processTreeMemoryPlateau.reason);
    if (!state.applicationCachePlateau.passed)
      state.blockers.push(state.applicationCachePlateau.reason);
  } else if (MODE === 'navigation') {
    state.processTreeMemoryPlateau = memoryPlateau(state.processTreeRssKb);
    state.applicationCachePlateau = memoryPlateau(state.applicationCacheBytes, {
      absoluteAllowance: 8 * 1024 * 1024,
      unit: 'bytes',
    });
    if (!timedOut || elapsedMs < DURATION_MS || requestedStop !== 'navigation-duration-complete') {
      state.blockers.push('60-minute-navigation-soak-incomplete');
    }
    if (state.nativeInteractions < 100)
      state.blockers.push('fewer-than-100-native-navigation-interactions');
    if (state.processTreeRssKb.length < 40)
      state.blockers.push('process-tree-memory-samples-incomplete');
    if (state.applicationCacheBytes.length < 40)
      state.blockers.push('application-cache-samples-incomplete');
    if (!state.processTreeMemoryPlateau.passed)
      state.blockers.push(state.processTreeMemoryPlateau.reason);
    if (!state.applicationCachePlateau.passed)
      state.blockers.push(state.applicationCachePlateau.reason);
    state.authoritativePresentationAvailable = state.authoritativePresentationSamples >= 100;
    if (!state.authoritativePresentationAvailable)
      state.blockers.push('authoritative-presentation-correlation-unavailable');
  } else {
    if (state.nativeInteractions < TARGET_INTERACTIONS) {
      state.blockers.push('fewer-than-requested-native-benchmark-interactions');
    }
    state.authoritativePresentationAvailable = state.authoritativePresentationSamples >= 100;
    if (!state.authoritativePresentationAvailable)
      state.blockers.push('authoritative-presentation-correlation-unavailable');
  }
  if (timedOut && MODE !== 'navigation') state.blockers.push('native-driver-run-timed-out');
  if (state.source.dirty) state.blockers.push('dirty-source-tree');
  state.blockers = [...new Set(state.blockers.filter(Boolean))];
  const expectedSignalStop =
    exitCode.signal === 'SIGTERM' &&
    (requestedStop === 'navigation-duration-complete' ||
      requestedStop === 'cycle-target-reached' ||
      requestedStop === 'interaction-target-reached');
  state.status =
    state.blockers.length === 0 && (exitCode.code === 0 || expectedSignalStop)
      ? 'passed'
      : 'inconclusive';
  state.statusScope =
    MODE === 'cycles'
      ? 'resource-cycle lifecycle and memory only; not GPU execution or latency qualification'
      : MODE === 'benchmark'
        ? 'one native paired-comparison cell; not a promotion decision by itself'
        : 'native navigation input, hardware execution, presentation, and resource evidence';
  state.qualificationEligible = false;
  state.hardwareExecution = state.events.some(
    (event) => validateHardwareExecutionEvidence(event).length === 0,
  )
    ? 'driver-reported-hardware'
    : RENDERER === 'webgl2'
      ? 'unknown'
      : 'not-applicable-canvas2d-api';
  state.inputToPresentationMs = distribution(
    state.events.map((event) => event.inputToPresentationMs),
  );
  state.presentationUncertaintyMs = distribution(
    state.events.map((event) => event.presentationUncertaintyMs),
  );
  save();
  console.log(`native qualification ${state.status}: ${OUT}`);
  if (state.blockers.length > 0) console.log(`blockers: ${state.blockers.join(', ')}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
