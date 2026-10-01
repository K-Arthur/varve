#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
/**
 * Native Linux paired qualification. Canvas-only screening selects the
 * baseline path and slow target before any WebGL2 comparison is launched.
 * This runner only accepts OS-input and correlated presentation evidence
 * collected by run-native-qualification.mjs on the host under test.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeNativeCell,
  decideQualification,
  summarizeNativeRun,
} from './nativePairedAnalysis.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? 'true'];
  }),
);
const DRIVER = args.get('driver') ? resolve(args.get('driver')) : null;
const BINARY = args.get('binary') ? resolve(args.get('binary')) : null;
const SCENARIOS_PATH = args.get('scenarios') ? resolve(args.get('scenarios')) : null;
const SCENARIOS = (args.get('fixtures') ?? 'vector-1k,flat-10k,raster-heavy,mixed-raster-vector')
  .split(',')
  .filter(Boolean);
const WORKLOADS = (args.get('workloads') ?? 'pan,zoom,single-drag').split(',').filter(Boolean);
const MAX_BLOCKS = Number(args.get('blocks') ?? 12);
const INTERACTIONS = Number(args.get('interactions') ?? 120);
const OUTDIR = resolve(
  args.get('outdir') ??
    join(tmpdir(), `varve-webgl2-native-${new Date().toISOString().replace(/[:.]/g, '-')}`),
);
const RESULT_PATH = resolve(OUTDIR, 'qualification.json');
const SCREEN_BLOCKS = 3;
const RENDERERS = ['canvas2d-main', 'canvas2d-worker'];
const CELLS = SCENARIOS.flatMap((fixture) => WORKLOADS.map((workload) => ({ fixture, workload })));

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeResult(result) {
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  writeFileSync(resolve(OUTDIR, 'progress.json'), JSON.stringify(result, null, 2));
}

function parseScenarioMap() {
  if (!SCENARIOS_PATH || !existsSync(SCENARIOS_PATH)) return null;
  const map = JSON.parse(readFileSync(SCENARIOS_PATH, 'utf8'));
  const normalized = {};
  for (const { fixture, workload } of CELLS) {
    const path = map?.[fixture]?.[workload];
    if (typeof path !== 'string') throw new Error(`scenario map is missing ${fixture}/${workload}`);
    const resolved = resolve(dirname(SCENARIOS_PATH), path);
    const scenario = JSON.parse(readFileSync(resolved, 'utf8'));
    const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
    if (
      scenario?.fixtureId !== fixture ||
      scenario?.gestureId !== workload ||
      !hash(scenario?.fixtureSha256) ||
      !hash(scenario?.gestureSequenceSha256) ||
      !Array.isArray(scenario?.assetSha256s) ||
      scenario.assetSha256s.some((item) => !hash(item))
    ) {
      throw new Error(`frozen scenario metadata or hashes do not match ${fixture}/${workload}`);
    }
    normalized[`${fixture}/${workload}`] = { path: resolved, sha256: hashFile(resolved) };
  }
  return normalized;
}

function reportRunKey(fixture, workload, stage, block, renderer) {
  return `${stage}-b${block}-${fixture}-${workload}-${renderer}`;
}

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function recordRun(result, metadata) {
  result.runs.push(metadata);
  writeResult(result);
}

function runCell(result, scenarioMap, cell, renderer, block, stage) {
  const id = reportRunKey(cell.fixture, cell.workload, stage, block, renderer);
  const reportPath = resolve(OUTDIR, `${id}.json`);
  const scenario = scenarioMap[`${cell.fixture}/${cell.workload}`];
  const command = [
    resolve(ROOT, 'scripts/perf/run-native-qualification.mjs'),
    '--mode=benchmark',
    `--renderer=${renderer}`,
    `--fixture=${cell.fixture}`,
    `--workload=${cell.workload}`,
    `--block=${block}`,
    `--interactions=${INTERACTIONS}`,
    `--scenario=${scenario.path}`,
    `--binary=${BINARY}`,
    `--driver=${DRIVER}`,
    `--out=${reportPath}`,
  ];
  console.log(
    `native qualification: ${stage} block ${block} · ${cell.fixture}/${cell.workload} · ${renderer}`,
  );
  const child = spawnSync(process.execPath, command, {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: 60 * 60 * 1000,
    env: process.env,
  });
  const report = loadJson(reportPath);
  const summary = report
    ? summarizeNativeRun(report, {
        renderer,
        fixture: cell.fixture,
        workload: cell.workload,
        block,
      })
    : { valid: false, p95: null, blockers: ['native-run-report-missing'], identity: null };
  recordRun(result, {
    id,
    stage,
    fixture: cell.fixture,
    workload: cell.workload,
    renderer,
    block,
    reportPath,
    reportSha256: existsSync(reportPath) ? hashFile(reportPath) : null,
    runnerExitCode: child.status,
    runnerSignal: child.signal,
    timeout: child.error?.code === 'ETIMEDOUT',
    valid: summary.valid,
    p95Ms: summary.p95,
    sampleCount: summary.sampleCount ?? 0,
    blockers: summary.blockers,
    identity: summary.identity,
    report,
  });
  return result.runs.at(-1);
}

function sameIdentity(left, right) {
  return (
    left?.commit === right?.commit &&
    left?.binarySha256 === right?.binarySha256 &&
    left?.scenarioSha256 === right?.scenarioSha256 &&
    JSON.stringify(left?.host) === JSON.stringify(right?.host)
  );
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const center = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[center] : (sorted[center - 1] + sorted[center]) / 2;
}

function selectBaseline(screen, cell) {
  const modes = RENDERERS.map((renderer) => {
    const runs = screen.filter(
      (run) =>
        run.fixture === cell.fixture && run.workload === cell.workload && run.renderer === renderer,
    );
    const valid = runs.filter((run) => run.valid);
    return {
      renderer,
      validBlockCount: valid.length,
      medianRunP95Ms: median(valid.map((run) => run.p95Ms)),
      runIds: valid.map((run) => run.id),
      unavailableReasons: runs.filter((run) => !run.valid).flatMap((run) => run.blockers),
    };
  }).filter((mode) => mode.validBlockCount >= SCREEN_BLOCKS);
  if (!modes.length)
    return {
      selected: null,
      candidates: RENDERERS.map((renderer) => ({ renderer, status: 'unavailable' })),
    };
  const selected = modes.slice().sort((a, b) => a.medianRunP95Ms - b.medianRunP95Ms)[0];
  const referenceRun = screen.find((run) => run.id === selected.runIds[0]);
  const identityMismatch = modes.some((mode) =>
    mode.runIds.some((id) => {
      const run = screen.find((candidate) => candidate.id === id);
      return !sameIdentity(referenceRun?.identity, run?.identity);
    }),
  );
  return {
    selected: identityMismatch ? null : selected.renderer,
    medianRunP95Ms: identityMismatch ? null : selected.medianRunP95Ms,
    identityMismatch,
    candidates: modes,
  };
}

function needsMoreBlocks(cells, slowCellId) {
  for (const [id, stats] of Object.entries(cells)) {
    if (stats.validPairCount < 3) return true;
    const interval = id === slowCellId ? stats.improvementInterval95 : stats.regressionInterval95;
    if (!interval || interval.lower95 === null || interval.upper95 === null) return true;
    if (id === slowCellId && interval.lower95 < 20 && interval.upper95 >= 20) return true;
    if (id !== slowCellId && interval.lower95 <= 5 && interval.upper95 > 5) return true;
  }
  return false;
}

function currentCellComparisons(baselines, pairedRuns) {
  return Object.fromEntries(
    CELLS.map((cell) => {
      const id = `${cell.fixture}/${cell.workload}`;
      const baselineRenderer = baselines[id]?.selected;
      const cellRuns = pairedRuns[id] ?? [];
      const pairs = cellRuns.map(({ block, canvasRun, webglRun }) => ({
        block,
        canvas2d: canvasRun?.report ?? null,
        webgl2: webglRun?.report ?? null,
      }));
      return [
        id,
        baselineRenderer
          ? analyzeNativeCell({
              id,
              fixture: cell.fixture,
              workload: cell.workload,
              baselineRenderer,
              pairs,
            })
          : {
              id,
              fixture: cell.fixture,
              workload: cell.workload,
              baselineRenderer: null,
              validPairCount: 0,
              rejectedBlocks: [{ blockers: ['no-valid-canvas2d-baseline'] }],
            },
      ];
    }),
  );
}

async function main() {
  const result = {
    schemaVersion: 1,
    status: 'inconclusive',
    qualificationEligible: false,
    generatedAt: new Date().toISOString(),
    configuration: {
      fixtures: SCENARIOS,
      workloads: WORKLOADS,
      maxBlocks: MAX_BLOCKS,
      screenBlocks: SCREEN_BLOCKS,
      interactions: INTERACTIONS,
      warmups: 10,
    },
    source: { commit: null, dirty: null },
    binary: {
      file: BINARY ? BINARY.split('/').at(-1) : null,
      sha256: BINARY && existsSync(BINARY) ? hashFile(BINARY) : null,
    },
    scenarioMapSha256:
      SCENARIOS_PATH && existsSync(SCENARIOS_PATH) ? hashFile(SCENARIOS_PATH) : null,
    runs: [],
    baselineScreen: {},
    slowTarget: null,
    comparisons: {},
    performanceDecision: null,
    promotionDecision: null,
    blockers: [],
  };
  mkdirSync(OUTDIR, { recursive: true });
  try {
    result.source.commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    result.source.dirty =
      execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim()
        .length > 0;
  } catch {
    result.source.dirty = true;
  }
  if (
    !Number.isInteger(MAX_BLOCKS) ||
    MAX_BLOCKS < SCREEN_BLOCKS ||
    MAX_BLOCKS > 12 ||
    MAX_BLOCKS % 3 !== 0
  ) {
    throw new Error('--blocks must be 3, 6, 9, or 12');
  }
  if (!Number.isInteger(INTERACTIONS) || INTERACTIONS < 100 || INTERACTIONS > 1000) {
    throw new Error('--interactions must be an integer from 100 to 1000');
  }
  if (!SCENARIOS.length || !WORKLOADS.length)
    throw new Error('at least one fixture and workload are required');
  if (result.source.dirty) result.blockers.push('source-tree-must-be-clean-for-native-comparison');
  if (!BINARY || !existsSync(BINARY) || !BINARY.includes('/release/')) {
    result.blockers.push('clean-release-tauri-binary-unavailable');
  }
  if (!DRIVER || !existsSync(DRIVER))
    result.blockers.push('host-local-os-input-driver-unavailable');
  if (!SCENARIOS_PATH || !existsSync(SCENARIOS_PATH))
    result.blockers.push('frozen-scenario-map-unavailable');
  if (result.blockers.length) {
    writeResult(result);
    console.log(`native paired qualification inconclusive: ${result.blockers.join(', ')}`);
    console.log(`result: ${RESULT_PATH}`);
    process.exitCode = 2;
    return;
  }

  const scenarioMap = parseScenarioMap();
  const baselineIds = new Set();
  for (let block = 1; block <= SCREEN_BLOCKS; block++) {
    for (let cellIndex = 0; cellIndex < CELLS.length; cellIndex++) {
      const cell = CELLS[cellIndex];
      const order = (block + cellIndex) % 2 === 0 ? RENDERERS : [...RENDERERS].reverse();
      for (const renderer of order) {
        const run = runCell(result, scenarioMap, cell, renderer, block, 'canvas-screen');
        baselineIds.add(run.id);
      }
    }
  }
  const screenRuns = result.runs.filter((run) => baselineIds.has(run.id));
  for (const cell of CELLS) {
    const id = `${cell.fixture}/${cell.workload}`;
    result.baselineScreen[id] = selectBaseline(screenRuns, cell);
    if (!result.baselineScreen[id].selected)
      result.blockers.push(`canvas-baseline-unavailable:${id}`);
  }
  const eligibleCells = CELLS.filter(
    (cell) => result.baselineScreen[`${cell.fixture}/${cell.workload}`]?.selected,
  );
  if (eligibleCells.length !== CELLS.length) {
    result.blockers.push('baseline-screen-incomplete; webgl2-results-not-run');
    writeResult(result);
    console.log(`native paired qualification inconclusive: ${result.blockers.join(', ')}`);
    console.log(`result: ${RESULT_PATH}`);
    process.exitCode = 2;
    return;
  }
  const slow = eligibleCells
    .slice()
    .sort(
      (left, right) =>
        result.baselineScreen[`${right.fixture}/${right.workload}`].medianRunP95Ms -
        result.baselineScreen[`${left.fixture}/${left.workload}`].medianRunP95Ms,
    )[0];
  const slowCellId = `${slow.fixture}/${slow.workload}`;
  result.slowTarget = {
    id: slowCellId,
    selection: 'slowest median p95 from Canvas2D-only three-block screen',
  };
  const pairedRuns = Object.fromEntries(
    CELLS.map((cell) => [`${cell.fixture}/${cell.workload}`, []]),
  );
  for (let block = 1; block <= SCREEN_BLOCKS; block++) {
    for (let cellIndex = 0; cellIndex < CELLS.length; cellIndex++) {
      const cell = CELLS[cellIndex];
      const id = `${cell.fixture}/${cell.workload}`;
      const baselineRenderer = result.baselineScreen[id].selected;
      const pair = {};
      const order =
        (block + cellIndex) % 2 === 0 ? [baselineRenderer, 'webgl2'] : ['webgl2', baselineRenderer];
      for (const renderer of order) {
        const run = runCell(result, scenarioMap, cell, renderer, block, 'paired');
        pair[renderer === 'webgl2' ? 'webglRun' : 'canvasRun'] = run;
      }
      pairedRuns[id].push({ block, canvasRun: pair.canvasRun, webglRun: pair.webglRun });
    }
  }

  let comparisons = currentCellComparisons(result.baselineScreen, pairedRuns);
  for (
    let nextBlock = 4;
    nextBlock <= MAX_BLOCKS && needsMoreBlocks(comparisons, slowCellId);
    nextBlock += 3
  ) {
    const finalBlock = Math.min(nextBlock + 2, MAX_BLOCKS);
    for (let block = nextBlock; block <= finalBlock; block++) {
      for (let cellIndex = 0; cellIndex < CELLS.length; cellIndex++) {
        const cell = CELLS[cellIndex];
        const id = `${cell.fixture}/${cell.workload}`;
        const baselineRenderer = result.baselineScreen[id].selected;
        const order =
          (block + cellIndex) % 2 === 0
            ? [baselineRenderer, 'webgl2']
            : ['webgl2', baselineRenderer];
        const pair = {};
        for (const renderer of order) {
          const run = runCell(result, scenarioMap, cell, renderer, block, 'paired');
          pair[renderer === 'webgl2' ? 'webglRun' : 'canvasRun'] = run;
        }
        pairedRuns[id].push({ block, canvasRun: pair.canvasRun, webglRun: pair.webglRun });
      }
    }
    comparisons = currentCellComparisons(result.baselineScreen, pairedRuns);
  }
  result.comparisons = comparisons;
  const slowStats = comparisons[slowCellId];
  const other = Object.entries(comparisons)
    .filter(([id]) => id !== slowCellId)
    .map(([id, stats]) => ({ id, ...stats }));
  result.performanceDecision = decideQualification({
    slowTarget: slowStats,
    otherWorkloads: other,
    correctnessPassed: true,
    memoryPassed: true,
  });
  result.promotionDecision = decideQualification({
    slowTarget: slowStats,
    otherWorkloads: other,
    correctnessPassed: false,
    memoryPassed: false,
  });
  result.blockers.push('correctness-reference-and-interaction-gates-not-attached');
  result.blockers.push('100-cycle-and-60-minute-resource-soaks-not-attached');
  result.blockers.push('packaged-appimage-and-dmabuf-override-checks-not-attached');
  result.blockers.push('startup-and-module-cost-comparison-not-part-of-native-latency-run');
  result.blockers = [...new Set(result.blockers)];
  result.status =
    result.performanceDecision.outcome === 'benefit-thresholds-met-pending-native-evidence'
      ? 'native-performance-thresholds-met-with-other-gates-pending'
      : result.performanceDecision.outcome;
  result.qualificationEligible = false;
  writeResult(result);
  console.log(`native paired qualification ${result.status}: ${RESULT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
