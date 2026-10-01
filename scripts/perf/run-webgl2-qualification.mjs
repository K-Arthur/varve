#!/usr/bin/env node
/**
 * Paired, balanced qualification driver. It chooses the slow target from a
 * Canvas2D-only screen, then compares WebGL2 with the faster verified
 * Canvas2D path for each exact fixture/gesture cell.
 *
 * This drives Chromium for portable correctness/benefit screening. It does
 * not claim Tauri/WebKitGTK, physical GPU, or physical presentation evidence.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideQualification, pairedP95, qualificationWorkload } from './qualificationAnalysis.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? 'true'];
  }),
);
if (args.has('help') || args.has('h')) {
  process.stdout.write(`Usage: node scripts/perf/run-webgl2-qualification.mjs [options]

Options:
  --fixtures=<id,id,...>     Documents to compare (default: 1k, 10k, raster, mixed)
  --workloads=<name,...>     Gestures to compare (default: pan, zoom, single-drag)
  --blocks=3|6|9|12          Paired blocks, extended in groups of three
  --iterations=<count>       Requested measured gestures per cell (minimum 100)
  --warmup=<count>           Warmup gestures per cell (default: 10)
  --headed                   Use a visible local browser for GPU screening
  --base=<url>               Use an existing production preview
  --outdir=<path>            Evidence output directory
  --help, -h                 Show this help without building or launching a browser

Headless Chromium may select a software renderer. Headed results are browser
screening only and do not qualify Tauri/WebKitGTK timing or physical display
presentation.
`);
  process.exit(0);
}
const FIXTURES = (args.get('fixtures') ?? 'vector-1k,flat-10k,raster-heavy,mixed-raster-vector')
  .split(',')
  .filter(Boolean);
const WORKLOADS = (args.get('workloads') ?? 'pan,zoom,single-drag').split(',').filter(Boolean);
const BLOCKS = Number(args.get('blocks') ?? 12);
const ITERATIONS = Number(args.get('iterations') ?? 120);
const WARMUP = Number(args.get('warmup') ?? 10);
const OUTDIR = resolve(
  args.get('outdir') ??
    join(tmpdir(), `varve-webgl2-qualification-${new Date().toISOString().replace(/[:.]/g, '-')}`),
);
const EXTERNAL_BASE = args.get('base') ?? null;
const HEADED = args.get('headed') === 'true';
const RESULTS = [];

if (!Number.isInteger(BLOCKS) || BLOCKS < 3 || BLOCKS > 12 || BLOCKS % 3 !== 0) {
  throw new Error('--blocks must be 3, 6, 9, or 12');
}

function command(cmd, cmdArgs, options = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: options.timeout ?? 15 * 60 * 1000,
    env: process.env,
  });
  if (result.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} failed (${result.status})`);
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });
}

async function waitForServer(base) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {
      // Vite preview is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`production preview did not start at ${base}`);
}

function cellId(fixture, workload) {
  return `${fixture}/${workload}`;
}

function validRun(result) {
  const record = result?.workloads?.[0];
  return Boolean(
    record?.status === 'ok' &&
      record.validity === 'valid' &&
      record.rendererModeVerified === true &&
      (record.trustedInput?.measuredUntrusted ?? 0) === 0 &&
      (record.trustedInput?.measuredTrusted ?? 0) >= 100 &&
      result.identity?.dirty === false &&
      Number.isFinite(record.interactions?.inputToCommit?.p95) &&
      record.interactions.inputToCommit.count >= 100,
  );
}

function needsMoreBlocks(comparisons, slowTarget) {
  for (const [id, stats] of Object.entries(comparisons)) {
    if (stats.validPairCount < 3) return true;
    if (id === slowTarget) {
      const interval = stats.improvementInterval95;
      if (interval.lower95 === null || interval.upper95 === null) return true;
      if (interval.lower95 < 20 && interval.upper95 >= 20) return true;
    } else {
      const interval = stats.regressionInterval95;
      if (interval.lower95 === null || interval.upper95 === null) return true;
      if (interval.lower95 <= 5 && interval.upper95 > 5) return true;
    }
  }
  return false;
}

function currentComparisons(comparisonRuns, baselineScreen) {
  return Object.fromEntries(
    [...comparisonRuns.entries()].map(([id, pairs]) => {
      const stats = pairedP95(
        pairs.map(({ block, canvas2d, webgl2 }) => ({
          block,
          canvas2d: qualificationWorkload(canvas2d),
          webgl2: qualificationWorkload(webgl2),
        })),
      );
      return [id, { ...stats, baselineMode: baselineScreen.get(id)?.selected }];
    }),
  );
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rendererCostSummary() {
  return Object.fromEntries(
    ['canvas2d-main', 'canvas2d-worker', 'webgl2'].map((mode) => {
      const rows = RESULTS.filter((run) => run.mode === mode)
        .map((run) => ({ cost: run.result?.startupAndBundleCost, run }))
        .filter(({ cost }) => Boolean(cost));
      const acceptedRows = rows
        .filter(({ run }) => {
          const workload = run.result?.workloads?.[0];
          return (
            run.result?.identity?.dirty === false &&
            workload?.status === 'ok' &&
            workload.rendererModeVerified === true &&
            ['valid', 'software_renderer'].includes(workload.validity)
          );
        })
        .map(({ cost }) => cost);
      const medianField = (selector) => median(acceptedRows.map(selector));
      const chunkNames = [
        ...new Set(
          acceptedRows.flatMap((row) =>
            (row.likelyRendererChunks ?? []).map((chunk) => chunk.resource),
          ),
        ),
      ].sort();
      const rendererChunkBytes = (row, field) =>
        (row.likelyRendererChunks ?? []).reduce(
          (sum, chunk) => sum + (Number.isFinite(chunk[field]) ? chunk[field] : 0),
          0,
        );
      return [
        mode,
        {
          acceptedRunCount: acceptedRows.length,
          softwareCompatibilityRunCount: RESULTS.filter(
            (run) =>
              run.mode === mode &&
              run.result?.workloads?.[0]?.validity === 'software_renderer' &&
              run.result?.identity?.dirty === false,
          ).length,
          status:
            acceptedRows.length > 0
              ? 'measured-browser-resource-cost'
              : 'unavailable-no-accepted-runs',
          domContentLoadedMsMedian: medianField((row) => row.startup?.domContentLoadedMs),
          loadMsMedian: medianField((row) => row.startup?.loadMs),
          homeHeapBytesMedian: medianField((row) => row.homeHeapBytes),
          editorOpenHeapBytesMedian: medianField((row) => row.editorOpenHeapBytes),
          homeScriptEncodedBytesMedian: medianField((row) => row.homeScriptEncodedBytes),
          editorAddedScriptEncodedBytesMedian: medianField(
            (row) => row.editorAddedScriptEncodedBytes,
          ),
          editorAddedScriptDecodedBytesMedian: medianField(
            (row) => row.editorAddedScriptDecodedBytes,
          ),
          likelyRendererChunkEncodedBytesMedian: medianField((row) =>
            rendererChunkBytes(row, 'encodedBytes'),
          ),
          likelyRendererChunkDecodedBytesMedian: medianField((row) =>
            rendererChunkBytes(row, 'decodedBytes'),
          ),
          likelyRendererChunks: chunkNames,
          scope:
            'Chromium page startup/heap and scripts loaded for each requested path; not a build with the WebGL2 module removed, native idle RSS, or packaged archive size',
        },
      ];
    }),
  );
}

function preliminaryBenefitLabel(stats) {
  const interval = stats?.improvementInterval95;
  if (
    stats?.validPairCount < 3 ||
    !interval ||
    interval.lower95 === null ||
    interval.upper95 === null
  ) {
    return 'insufficient-valid-pairs';
  }
  if (interval.upper95 < 20) return 'no-20-percent-benefit-signal';
  if (interval.lower95 >= 20) return '20-percent-target-benefit-signal';
  return 'uncertainty-overlaps-20-percent';
}

async function startPreview() {
  if (EXTERNAL_BASE) return { base: EXTERNAL_BASE, stop: () => {} };
  command('pnpm', ['--dir', 'apps/desktop', 'exec', 'vite', 'build']);
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(
    'pnpm',
    [
      '--dir',
      'apps/desktop',
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    { cwd: ROOT, stdio: 'inherit', env: process.env },
  );
  await waitForServer(base);
  return { base, stop: () => child.kill('SIGTERM') };
}

async function runCell({ base, fixture, workload, mode, block, stage }) {
  const id = `${stage}-b${block}-${fixture}-${workload}-${mode}`;
  const resultPath = resolve(OUTDIR, `${id}.json`);
  const snapshotPath = resolve(OUTDIR, `${id}.png`);
  const commandArgs = [
    resolve(ROOT, 'scripts/perf/run-production-workload.mjs'),
    `--base=${base}`,
    `--mode=${mode}`,
    `--fixture=${fixture}`,
    `--workloads=${workload}`,
    `--iterations=${ITERATIONS}`,
    `--warmup=${WARMUP}`,
    `--out=${resultPath}`,
    `--snapshot=${snapshotPath}`,
  ];
  if (HEADED) commandArgs.push('--headed');
  console.log(`\nqualification: ${stage} block ${block} · ${fixture} · ${workload} · ${mode}`);
  const child = spawnSync(process.execPath, commandArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: 60 * 60 * 1000,
    env: process.env,
  });
  let result = null;
  try {
    result = JSON.parse(readFileSync(resultPath, 'utf8'));
  } catch {
    result = { status: 'missing-result', runnerExitCode: child.status };
  }
  const run = {
    id,
    stage,
    block,
    fixture,
    workload,
    mode,
    resultPath,
    snapshotPath,
    browserMode: HEADED ? 'headed' : 'headless',
    runnerExitCode: child.status,
    valid: validRun(result),
    result,
  };
  RESULTS.push(run);
  writeFileSync(resolve(OUTDIR, 'progress.json'), JSON.stringify(RESULTS, null, 2));
  return run;
}

function baselineP95(run) {
  return run?.result?.workloads?.[0]?.interactions?.inputToCommit?.p95 ?? null;
}

async function main() {
  mkdirSync(OUTDIR, { recursive: true });
  const preview = await startPreview();
  try {
    const baselineScreen = new Map();
    // Do not inspect WebGL results until this complete Canvas2D-only screen
    // identifies both the best verified Canvas2D path and the slowest target.
    for (const fixture of FIXTURES) {
      for (const workload of WORKLOADS) {
        const cell = cellId(fixture, workload);
        const screen = [];
        for (let block = 1; block <= 3; block++) {
          const modes =
            block % 2 === 1
              ? ['canvas2d-main', 'canvas2d-worker']
              : ['canvas2d-worker', 'canvas2d-main'];
          for (const mode of modes) {
            screen.push(
              await runCell({
                base: preview.base,
                fixture,
                workload,
                mode,
                block,
                stage: 'baseline-screen',
              }),
            );
          }
        }
        const eligible = ['canvas2d-main', 'canvas2d-worker']
          .map((mode) => {
            const runs = screen.filter((run) => run.mode === mode && run.valid);
            const p95Values = runs
              .map(baselineP95)
              .filter(Number.isFinite)
              .sort((a, b) => a - b);
            const medianP95 = p95Values.length ? p95Values[Math.floor(p95Values.length / 2)] : null;
            return { mode, runs, medianP95 };
          })
          .filter(
            (candidate) => candidate.runs.length >= 3 && Number.isFinite(candidate.medianP95),
          );
        if (eligible.length === 0) {
          baselineScreen.set(cell, { eligible: false, runs: screen, selected: null, p95Ms: null });
          continue;
        }
        eligible.sort((a, b) => a.medianP95 - b.medianP95);
        baselineScreen.set(cell, {
          eligible: true,
          runs: screen,
          validScreenRunsByMode: Object.fromEntries(
            eligible.map((candidate) => [candidate.mode, candidate.runs.length]),
          ),
          selected: eligible[0].mode,
          p95Ms: eligible[0].medianP95,
          selectedRunIds: eligible[0].runs.map((run) => run.id),
        });
      }
    }

    const slowTarget =
      [...baselineScreen.entries()]
        .filter(([, screen]) => screen.eligible)
        .sort((a, b) => b[1].p95Ms - a[1].p95Ms)[0]?.[0] ?? null;
    const primaryWorkloads = FIXTURES.flatMap((fixture) =>
      WORKLOADS.map((workload) => cellId(fixture, workload)),
    );
    const baselineUnavailableCells = primaryWorkloads.filter(
      (id) => !baselineScreen.get(id)?.eligible,
    );
    const report = {
      schemaVersion: 1,
      source: 'Chromium production browser; not Tauri/WebKitGTK hardware qualification',
      browserMode: HEADED ? 'headed' : 'headless',
      baselineScreen: Object.fromEntries(baselineScreen),
      primaryWorkloads,
      baselineUnavailableCells,
      slowTarget,
      pairedComparisons: {},
      nativePresentationAvailable: false,
      hardwareExecution: 'unknown',
      correctnessReport:
        'run focused correctness workflow separately; no native parity claim from this driver',
      memorySoakPassed: false,
      rendererModuleCosts: rendererCostSummary(),
      generatedAt: new Date().toISOString(),
    };
    writeFileSync(resolve(OUTDIR, 'baseline-screen.json'), JSON.stringify(report, null, 2));
    if (!slowTarget) {
      report.preliminaryBenefitScreen = {
        measuredOnlyAfterCanvas2dSelectedSlowTarget: false,
        target: null,
        initialValidPairedBlocks: 0,
        targetLabel: 'no-valid-Canvas2d-baseline-cell',
        interpretation:
          'No WebGL2 result was examined because the Canvas2D-only screen produced no eligible baseline.',
      };
      report.decision = {
        outcome: 'inconclusive',
        blockers: [
          'no-valid-Canvas2D-baseline-cell',
          ...baselineUnavailableCells.map((id) => `canvas2d-baseline-unavailable:${id}`),
        ],
      };
      writeFileSync(resolve(OUTDIR, 'qualification.json'), JSON.stringify(report, null, 2));
      return;
    }

    const comparisonRuns = new Map();
    const cells = FIXTURES.flatMap((fixture) =>
      WORKLOADS.map((workload) => ({
        fixture,
        workload,
        id: cellId(fixture, workload),
        baselineMode: baselineScreen.get(cellId(fixture, workload))?.selected ?? null,
      })),
    );
    for (let block = 1; block <= BLOCKS; block++) {
      for (const [cellIndex, cell] of cells.entries()) {
        if (!cell.baselineMode) continue;
        const orderCanvasFirst = (block + cellIndex) % 2 === 0;
        const runModes = orderCanvasFirst
          ? [cell.baselineMode, 'webgl2']
          : ['webgl2', cell.baselineMode];
        const byMode = {};
        for (const mode of runModes) {
          byMode[mode] = await runCell({
            base: preview.base,
            fixture: cell.fixture,
            workload: cell.workload,
            mode,
            block,
            stage: 'paired',
          });
        }
        const pairs = comparisonRuns.get(cell.id) ?? [];
        pairs.push({
          block,
          canvas2d: byMode[cell.baselineMode],
          webgl2: byMode.webgl2,
        });
        comparisonRuns.set(cell.id, pairs);
      }
      if (block >= 3 && block % 3 === 0) {
        const interim = currentComparisons(comparisonRuns, baselineScreen);
        if (!needsMoreBlocks(interim, slowTarget)) break;
      }
    }

    const comparisons = currentComparisons(comparisonRuns, baselineScreen);
    const firstThreeBlockComparisons = currentComparisons(
      new Map([...comparisonRuns.entries()].map(([id, pairs]) => [id, pairs.slice(0, 3)])),
      baselineScreen,
    );
    const targetStats = comparisons[slowTarget];
    const earlyTargetStats = firstThreeBlockComparisons[slowTarget];
    const others = Object.entries(comparisons)
      .filter(([id]) => id !== slowTarget)
      .map(([id, stats]) => ({ id, ...stats }));
    report.pairedComparisons = comparisons;
    report.targetStatistics = targetStats;
    report.preliminaryBenefitScreen = {
      measuredOnlyAfterCanvas2dSelectedSlowTarget: true,
      target: slowTarget,
      initialValidPairedBlocks: earlyTargetStats?.validPairCount ?? 0,
      targetLabel: preliminaryBenefitLabel(earlyTargetStats),
      targetStatistics: earlyTargetStats ?? null,
      interpretation:
        'Browser input-to-commit screening only; not native input-to-display evidence.',
    };
    report.rendererModuleCosts = rendererCostSummary();
    report.decision = decideQualification({
      slowTarget: targetStats,
      otherWorkloads: others,
      correctnessPassed: false,
      memoryPassed: false,
    });
    report.decision.outcome = 'inconclusive';
    report.decision.blockers = [
      ...new Set([
        ...(report.decision.blockers ?? []),
        ...baselineUnavailableCells.map((id) => `canvas2d-baseline-unavailable:${id}`),
        'native-tauri-webkitgtk-not-run',
        'physical-gpu-execution-unknown',
        'authoritative-input-to-presentation-unavailable',
        'open-close-memory-cycles-and-60-minute-soak-not-run',
      ]),
    ];
    report.promotionCriteria = {
      targetImprovementPercent: 20,
      otherWorkloadMaximumRegressionPercent: 5,
      measuredBoundary:
        'trusted browser input to application frame commit; not physical display presentation',
      threeInitialBlocks: 3,
      maximumBlocks: 12,
      chosenSlowTargetBeforeWebGL: slowTarget,
    };
    writeFileSync(resolve(OUTDIR, 'qualification.json'), JSON.stringify(report, null, 2));
    console.log(`\nqualification decision: ${report.decision.outcome}`);
    console.log(`slow target: ${slowTarget}; results: ${resolve(OUTDIR, 'qualification.json')}`);
  } finally {
    preview.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
