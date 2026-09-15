#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
/**
 * Summarise a run from tests/e2e/canvas/background-removal-quality.spec.ts.
 *
 * This intentionally does not invent missing measurements. If a provider
 * falls back, the requested and actual method/model remain separate in the
 * report. The generated visual manifest points reviewers at the masks written
 * beside results.json by the Playwright benchmark.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const inputPath = resolve(argument('--input', 'results.json'));
const outputDir = resolve(argument('--output', resolve(inputPath, '..')));
const raw = JSON.parse(await readFile(inputPath, 'utf8'));
const results = Array.isArray(raw) ? raw : raw.results;
if (!Array.isArray(results)) throw new Error(`${inputPath} is not a benchmark report`);

const format = (value, digits = 3) => (typeof value === 'number' ? value.toFixed(digits) : '—');
const rows = results
  .map((result) => {
    const status = result.ok ? 'pass' : `error: ${result.error ?? 'unknown'}`;
    return `| ${result.caseId} | ${result.requestedMethod} | ${result.actualMethod ?? '—'} | ${result.modelId ?? '—'} | ${result.executionProvider ?? '—'} | ${format(result.coldStartMs, 0)} | ${format(result.warmP50Ms, 0)} | ${format(result.warmP95Ms, 0)} | ${format(result.iou)} | ${format(result.dice)} | ${format(result.boundaryFScore)} | ${format(result.maskMae)} | ${status} |`;
  })
  .join('\n');

const visualCases = [...new Set(results.map((result) => result.caseId))].map((caseId) => ({
  caseId,
  masks: results
    .filter((result) => result.caseId === caseId)
    .map((result) => `${caseId}-${result.requestedMethod}-mask.png`),
}));

let gitCommit = raw.gitCommit;
if (!gitCommit || gitCommit === 'working-tree') {
  try {
    gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    gitCommit = 'unknown';
  }
}

const report = `# Background-removal benchmark report\n\n- Generated: ${raw.generatedAt ?? new Date().toISOString()}\n- Git commit: ${gitCommit}\n- Runtime: ${raw.runtime ?? 'not recorded'}\n- Iterations: ${raw.iterations ?? 1} (first timing is cold; warm percentiles exclude it)\n- Device: ${results.find((result) => result.device)?.device ?? 'not recorded'}\n\nThe quality columns below are segmentation metrics unless a fixture explicitly declares a genuine alpha matte. Reference-model masks are useful for drift and relative comparisons, not absolute quality claims.\n\n| Case | Requested | Actual | Model | Provider | Cold ms | Warm p50 ms | Warm p95 ms | IoU | Dice | Boundary F | Mask MAE | Status |\n|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|\n${rows || '| — | — | — | — | — | — | — | — | — | — | — | — | no results |'}\n`;

await writeFile(resolve(outputDir, 'summary.md'), report);
await writeFile(
  resolve(outputDir, 'visual-report.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sourceResults: inputPath,
      reviewInstructions:
        'Inspect each listed mask against its source and ground truth where available. Review hair, fur, thin structures, holes, halos, and semi-transparent edges on white, black, and checkerboard backgrounds.',
      cases: visualCases,
    },
    null,
    2,
  )}\n`,
);
console.log(`Wrote ${resolve(outputDir, 'summary.md')}`);
console.log(`Wrote ${resolve(outputDir, 'visual-report.json')}`);
