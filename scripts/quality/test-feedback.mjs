#!/usr/bin/env node

/** Diagnostic timing/outcome summaries. These never grant a test or release pass. */
import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[a-f0-9]{64}$/;
const CASE_STATUSES = new Set(['expected', 'unexpected', 'flaky', 'skipped']);
const MAX_FILES = 10000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function percentile(values, fraction) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
}

function sourceKey(report) {
  const { source, workflow, runner } = report;
  return JSON.stringify([
    workflow.repository,
    source.commitSha,
    source.treeSha,
    source.policyHash,
    report.profile,
    runner?.os ?? null,
    runner?.arch ?? null,
  ]);
}

function cellKey(report) {
  return JSON.stringify([
    sourceKey(report),
    report.workflow.runId,
    report.category,
    report.matrix,
    report.shard ?? null,
  ]);
}

function validReceipt(report) {
  return (
    report?.schema === 1 &&
    typeof report.category === 'string' &&
    typeof report.profile === 'string' &&
    typeof report.matrix === 'string' &&
    /^[a-f0-9]{40}$/.test(report.source?.commitSha ?? '') &&
    /^[a-f0-9]{40}$/.test(report.source?.treeSha ?? '') &&
    SHA.test(report.source?.policyHash ?? '') &&
    typeof report.workflow?.repository === 'string' &&
    /^[1-9]\d*$/.test(String(report.workflow?.runId ?? '')) &&
    /^[1-9]\d*$/.test(String(report.workflow?.runAttempt ?? '')) &&
    Number.isSafeInteger(Number(report.workflow.runAttempt))
  );
}

function collectCases(report) {
  const cases = [];
  let malformed = 0;
  const browsers = report.playwright?.reports ?? [];
  if (!Array.isArray(browsers)) return { cases, malformed: 1 };
  for (const browser of browsers) {
    if (!Array.isArray(browser?.cases)) {
      malformed++;
      continue;
    }
    for (const test of browser.cases) {
      if (
        !SHA.test(test?.caseId ?? '') ||
        typeof test.file !== 'string' ||
        typeof test.project !== 'string' ||
        !CASE_STATUSES.has(test.status) ||
        !Array.isArray(test.attempts) ||
        test.attempts.some(
          (attempt) =>
            !Number.isFinite(attempt?.durationMs) ||
            attempt.durationMs < 0 ||
            !Number.isSafeInteger(attempt.retry) ||
            attempt.retry < 0,
        )
      ) {
        malformed++;
        continue;
      }
      cases.push({
        caseId: test.caseId,
        file: test.file,
        project: test.project,
        status: test.status,
        durationMs: test.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0),
        attemptCount: test.attempts.length,
      });
    }
  }
  return { cases, malformed };
}

/** Keep separate source/runner identities separate; a differing outcome alone is not a flake diagnosis. */
export function buildTestFeedback(reports, { limit = 20 } = {}) {
  if (!Array.isArray(reports)) throw new Error('execution receipts must be an array');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error('limit must be an integer from 1 to 100');
  const cells = new Map();
  const histories = new Map();
  let invalidReceipts = 0;
  let invalidCases = 0;
  const conflicts = new Set();
  for (const report of reports) {
    if (!validReceipt(report)) {
      invalidReceipts++;
      continue;
    }
    const key = cellKey(report);
    const attempt = Number(report.workflow.runAttempt);
    const cell = cells.get(key);
    if (cell?.attempt === attempt) conflicts.add(key);
    if (!cell || attempt > cell.attempt) {
      cells.set(key, { report, attempt });
      conflicts.delete(key);
    }
    const collected = collectCases(report);
    invalidCases += collected.malformed;
    for (const test of collected.cases) {
      const historyKey = JSON.stringify([sourceKey(report), test.caseId]);
      const history = histories.get(historyKey) ?? { ...test, outcomes: new Set(), samples: 0 };
      history.outcomes.add(test.status);
      history.samples++;
      histories.set(historyKey, history);
    }
  }
  const selected = [...cells.entries()].filter(([key]) => !conflicts.has(key));
  const caseSamples = [];
  const cellTimings = selected.map(([, { report, attempt }]) => {
    const { cases } = collectCases(report);
    caseSamples.push(...cases);
    const duration = report.durationMs;
    return {
      category: report.category,
      matrix: report.matrix,
      shard: report.shard ?? null,
      runId: String(report.workflow.runId),
      attempt,
      status: report.status,
      commitSha: report.source.commitSha,
      measuredLaneMs: Number.isFinite(duration) && duration >= 0 ? duration : null,
      browserWorkMs: cases.reduce((sum, test) => sum + test.durationMs, 0),
      cases: cases.length,
      skipped: cases.filter((test) => test.status === 'skipped').length,
      unexpected: cases.filter((test) => test.status === 'unexpected').length,
      retried: cases.filter((test) => test.attemptCount > 1).length,
    };
  });
  const durations = caseSamples
    .filter((test) => test.status !== 'skipped')
    .map((test) => test.durationMs);
  const shardGroups = new Map();
  for (const cell of cellTimings) {
    if (!/^[1-9]\d*\/[1-9]\d*$/.test(cell.shard ?? '')) continue;
    const groupKey = JSON.stringify([cell.commitSha, cell.runId, cell.category, cell.matrix]);
    const group = shardGroups.get(groupKey) ?? [];
    group.push(cell);
    shardGroups.set(groupKey, group);
  }
  const shardBalance = [...shardGroups.values()].map((group) => {
    const totals = new Set(group.map((cell) => Number(cell.shard.split('/')[1])));
    const total = [...totals][0];
    const indices = new Set(group.map((cell) => Number(cell.shard.split('/')[0])));
    const complete =
      totals.size === 1 && indices.size === total && [...indices].every((index) => index <= total);
    const work = group.map((cell) => cell.browserWorkMs);
    const min = Math.min(...work);
    const max = Math.max(...work);
    return {
      commitSha: group[0].commitSha,
      runId: group[0].runId,
      category: group[0].category,
      observedShards: group.length,
      expectedShards: totals.size === 1 ? total : null,
      complete,
      minBrowserWorkMs: min,
      maxBrowserWorkMs: max,
      maxToMinRatio: min > 0 ? max / min : null,
    };
  });
  const divergences = [...histories.values()]
    .filter((history) => history.outcomes.has('expected') && history.outcomes.has('unexpected'))
    .map(({ outcomes, samples, caseId, file, project }) => ({
      caseId,
      file,
      project,
      outcomes: [...outcomes].sort(),
      samples,
      classification: 'needs-runtime-environment-investigation',
    }));
  return {
    schema: 1,
    certifying: false,
    interpretation:
      'Diagnostic observations only; no retries, skips, quarantine, or release approval are authorized.',
    receiptCount: reports.length,
    selectedCellCount: selected.length,
    invalidReceipts,
    invalidCases,
    conflictingCells: conflicts.size,
    caseSamples: caseSamples.length,
    caseDurationMs: {
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      total: durations.reduce((sum, duration) => sum + duration, 0),
    },
    cells: cellTimings,
    shardBalance,
    slowestCases: [...caseSamples].sort((a, b) => b.durationMs - a.durationMs).slice(0, limit),
    divergentOutcomes: divergences.slice(0, limit),
    divergentOutcomeCount: divergences.length,
  };
}

function readReports(directory) {
  const reports = [];
  let bytes = 0;
  const visit = (path, depth = 0) => {
    if (depth > 24) throw new Error('receipt directory depth exceeds diagnostic bound');
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('receipt directory contains a symlink');
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) visit(child, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        if (reports.length >= MAX_FILES) throw new Error('receipt count exceeds diagnostic bound');
        if (statSync(child).size > MAX_FILE_BYTES)
          throw new Error('receipt bytes exceed diagnostic bound');
        const buffer = readFileSync(child);
        bytes += buffer.length;
        if (buffer.length > MAX_FILE_BYTES || bytes > 128 * 1024 * 1024)
          throw new Error('receipt bytes exceed diagnostic bound');
        try {
          reports.push(JSON.parse(buffer.toString('utf8')));
        } catch {
          throw new Error('receipt JSON is malformed');
        }
      }
    }
  };
  visit(resolve(directory));
  return reports;
}

export function feedbackMarkdown(report) {
  const seconds = (value) => (value == null ? 'unmeasured' : `${(value / 1000).toFixed(1)}s`);
  const lines = [
    '### Test feedback diagnostics',
    '',
    'These observations do not certify a release or authorize skipping tests.',
    '',
    `Selected cells: ${report.selectedCellCount}; case samples: ${report.caseSamples}.`,
    `Case p50: ${seconds(report.caseDurationMs.p50)}; p95: ${seconds(report.caseDurationMs.p95)}; summed browser work: ${seconds(report.caseDurationMs.total)}.`,
    `Malformed receipts/cases: ${report.invalidReceipts}/${report.invalidCases}; ambiguous cells: ${report.conflictingCells}; divergent outcomes needing investigation: ${report.divergentOutcomeCount}.`,
    '',
    '| Category | Observed/expected shards | Complete | Max/min browser work |',
    '| --- | --- | --- | --- |',
    ...report.shardBalance.map(
      (group) =>
        `| ${group.category.replaceAll('|', '\\|')} | ${group.observedShards}/${group.expectedShards ?? '?'} | ${group.complete} | ${group.maxToMinRatio?.toFixed(2) ?? 'unmeasured'} |`,
    ),
    '',
    'Longest measured cases are retained in the diagnostic JSON artifact.',
    '',
  ];
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 && !(args.length === 2 && args[1] === '--summary'))
      throw new Error('usage: test-feedback.mjs <execution-receipt-directory> [--summary]');
    const report = buildTestFeedback(readReports(args[0]));
    if (args.includes('--summary')) {
      if (!process.env.GITHUB_STEP_SUMMARY) throw new Error('GITHUB_STEP_SUMMARY is required');
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, feedbackMarkdown(report));
    }
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    // Never print parser excerpts or untrusted artifact payloads.
    console.error(error.code ? `test feedback failed (${error.code})` : error.message);
    process.exitCode = 1;
  }
}
