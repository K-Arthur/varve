#!/usr/bin/env node

/**
 * Render the Object Selection parity table from a benchmark results.json.
 *
 * Input shape (written by the quality E2E spec once real-model inference is
 * wired): an array of rows, one per corpus fixture:
 *   { caseId, modelId, executionProvider, coldStartMs, promptP50Ms,
 *     promptP95Ms, peakRssBytes, metrics: { iou, dice, boundaryF } }
 * The corpus and metrics live in @varve/engine
 * (packages/engine/src/segmentation/quality) — see
 * docs/quality/object-selection-parity.md.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const inputPath = resolve(argument('--input', 'results.json'));
const raw = JSON.parse(await readFile(inputPath, 'utf8'));
const results = Array.isArray(raw) ? raw : raw.results;
if (!Array.isArray(results)) throw new Error(`${inputPath} is not a benchmark report`);

const format = (value, digits = 3) => (typeof value === 'number' ? value.toFixed(digits) : '—');
const rows = results.map((result) => {
  const metrics = result.metrics ?? {};
  const status = result.ok ? 'pass' : `error: ${result.error ?? 'unknown'}`;
  return `| ${result.caseId} | ${result.category ?? '—'} | ${result.modelId ?? '—'} | ${result.executionProvider ?? '—'} | ${format(result.coldStartMs, 0)} | ${format(result.promptP50Ms, 0)} | ${format(result.promptP95Ms, 0)} | ${format(metrics.iou)} | ${format(metrics.dice)} | ${format(metrics.boundaryF)} | ${status} |`;
});

const averages = results
  .filter((result) => result.ok)
  .reduce(
    (acc, result) => {
      const metrics = result.metrics ?? {};
      acc.iou += metrics.iou ?? 0;
      acc.dice += metrics.dice ?? 0;
      acc.boundaryF += metrics.boundaryF ?? 0;
      acc.promptP50Ms += result.promptP50Ms ?? 0;
      acc.count++;
      return acc;
    },
    { iou: 0, dice: 0, boundaryF: 0, promptP50Ms: 0, count: 0 },
  );

const header = [
  '| caseId | category | model | provider | cold load ms | prompt p50 ms | prompt p95 ms | IoU | Dice | boundary F | status |',
  '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
];
if (averages.count > 0) {
  header.push(
    `| **mean (${averages.count} cases)** | | | | | ${format(averages.promptP50Ms / averages.count, 0)} | | ${format(averages.iou / averages.count)} | ${format(averages.dice / averages.count)} | ${format(averages.boundaryF / averages.count)} | |`,
  );
}
console.log(header.join('\n'));
console.log(rows.join('\n'));
