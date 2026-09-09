#!/usr/bin/env node

/** Stable CI certification aggregator.  Deliberate skips are data, not green by accident. */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CI_CATEGORIES, CI_CATEGORY_LANES } from './validation-policy.mjs';

export const REQUIRED_CI_JOBS = Object.freeze({
  changes: 'pipeline',
  'pipeline-validate': 'pipeline',
  'attribution-check': null,
  rust: 'rust',
  wasm: 'wasm',
  js: 'js',
  'website-e2e': 'website',
  e2e: 'e2e',
  'e2e-visual': 'visual',
  'desktop-e2e': 'desktop',
  models: 'models',
  bench: 'bench',
});

function statusOf(value) {
  if (typeof value === 'string') return value;
  return value?.result ?? value?.conclusion ?? null;
}

function jobSelected(job, category, categories, profile) {
  if (category === null) return false;
  if (profile === 'candidate') return true;
  if (job === 'e2e') return Boolean(categories.e2e);
  if (job === 'e2e-visual') return Boolean(categories.visual);
  return Boolean(categories[category]);
}

function laneBelongsToCategory(lane, category) {
  if (category === 'pipeline')
    return lane === 'pipeline-validate' || lane === 'ci-tools' || lane === 'policy';
  if (category === 'js')
    return (
      lane.startsWith('js-unit:') ||
      lane.startsWith('typecheck:') ||
      lane === 'lint:all' ||
      lane === 'audit:tokens'
    );
  if (category === 'rust')
    return lane.startsWith('rust-test:') || lane.startsWith('rust-clippy:') || lane === 'cargo-fmt';
  if (category === 'website') return lane === 'website-unit' || lane === 'website-e2e';
  if (category === 'e2e') return lane.startsWith('e2e:') && lane !== 'e2e:visual';
  if (category === 'visual') return lane === 'e2e:visual';
  if (category === 'desktop') return lane === 'desktop-native';
  if (category === 'models') return lane === 'models';
  if (category === 'bench') return lane.startsWith('bench:');
  return lane === 'wasm';
}

function expectedLanes(plan, category) {
  const selected = (plan.selectedLanes ?? []).filter((lane) =>
    laneBelongsToCategory(lane, category),
  );
  return selected.length ? selected : [...(CI_CATEGORY_LANES[category] ?? [])];
}

function expectedReportCount(plan, category) {
  if (category === 'rust' || category === 'desktop') return 3;
  if (category === 'e2e') return Number(plan.e2eShardCount ?? 1);
  return 1;
}

function reportKey(report) {
  return `${report.category}:${report.matrix ?? 'default'}:${report.shard ?? 'single'}`;
}

function readJsonReports(directory) {
  if (!directory || !existsSync(directory)) return [];
  const reports = [];
  const visit = (path) => {
    const entry = statSync(path);
    if (entry.isDirectory()) {
      for (const child of readdirSync(path)) visit(join(path, child));
    } else if (path.endsWith('.json')) {
      try {
        reports.push(JSON.parse(readFileSync(path, 'utf8')));
      } catch {
        reports.push({ schema: null, invalidPath: path });
      }
    }
  };
  visit(directory);
  return reports;
}

export function validateExecutionEvidence({
  reports = [],
  plan = {},
  profile = plan.profile ?? 'integration',
  candidateMode = plan.candidateMode ?? null,
  workflow = {},
} = {}) {
  const failures = [];
  const evidence = [];
  const selectedCategories = CI_CATEGORIES.filter(
    (category) => category === 'pipeline' || profile === 'candidate' || plan.categories?.[category],
  );
  for (const category of selectedCategories) {
    const categoryReports = reports.filter((report) => report?.category === category);
    const expectedCount = expectedReportCount(plan, category);
    const expected = new Set(expectedLanes(plan, category));
    const valid = [];
    const seen = new Set();
    for (const report of categoryReports) {
      const source = report?.source ?? {};
      const identityErrors = [];
      if (report?.schema !== 1) identityErrors.push('schema mismatch');
      if (report?.profile !== profile) identityErrors.push('profile mismatch');
      if (profile === 'candidate' && report?.candidateMode !== candidateMode)
        identityErrors.push('candidate mode mismatch');
      if (source.commitSha !== plan.commitSha) identityErrors.push('commit SHA mismatch');
      if (plan.treeSha && source.treeSha !== plan.treeSha) identityErrors.push('tree SHA mismatch');
      if (source.plannedCommitSha && source.plannedCommitSha !== plan.commitSha)
        identityErrors.push('planned commit SHA mismatch');
      if (source.planHash !== plan.planHash) identityErrors.push('plan hash mismatch');
      if (source.policyHash !== plan.policyHash) identityErrors.push('policy hash mismatch');
      if (workflow.repository && report?.workflow?.repository !== workflow.repository)
        identityErrors.push('workflow repository mismatch');
      if (workflow.runId && String(report?.workflow?.runId) !== String(workflow.runId))
        identityErrors.push('workflow run mismatch');
      if (report?.status !== 'success')
        identityErrors.push(`execution status ${report?.status ?? 'missing'}`);
      if (identityErrors.length) {
        failures.push({
          job: category,
          category,
          reason: `invalid execution receipt (${identityErrors.join(', ')})`,
          report: report?.invalidPath ?? reportKey(report ?? {}),
        });
        continue;
      }
      const key = reportKey(report);
      if (seen.has(key)) {
        failures.push({ job: category, category, reason: `duplicate execution receipt ${key}` });
        continue;
      }
      seen.add(key);
      valid.push(report);
    }
    if (valid.length < expectedCount) {
      failures.push({
        job: category,
        category,
        reason: `missing execution receipts (${valid.length}/${expectedCount})`,
      });
    }
    const covered = new Set(valid.flatMap((report) => report.executedLanes ?? []));
    for (const lane of expected) {
      if (!covered.has(lane))
        failures.push({ job: category, category, reason: `lane '${lane}' was not executed` });
    }
    if (category === 'e2e') {
      const shards = new Set(valid.map((report) => report.shard).filter(Boolean));
      for (let shard = 1; shard <= expectedCount; shard += 1) {
        if (!shards.has(`${shard}/${expectedCount}`))
          failures.push({
            job: category,
            category,
            reason: `missing shard ${shard}/${expectedCount}`,
          });
      }
    }
    evidence.push({
      category,
      expectedCount,
      reports: valid.map(reportKey),
      coveredLanes: [...covered],
    });
  }
  return { passed: failures.length === 0, failures, evidence };
}

export function aggregateCertification({
  needs = {},
  categories = {},
  profile = 'integration',
  candidateMode = null,
  selectedLanes = [],
  deferredLanes = [],
  commitSha = null,
  policyVersion = null,
  policyHash = null,
  planHash = null,
  treeSha = null,
  e2eShardCount = 1,
  executionReports = null,
  workflow = {},
} = {}) {
  if (profile === 'candidate' && !['triage', 'final'].includes(candidateMode)) {
    throw new Error('candidate aggregation requires mode triage or final');
  }
  const jobs = [];
  const failures = [];
  for (const [job, category] of Object.entries(REQUIRED_CI_JOBS)) {
    const present = Object.hasOwn(needs, job);
    const status = present ? statusOf(needs[job]) : null;
    const selected = jobSelected(job, category, categories, profile) || category === 'pipeline';
    const deliberateSkip =
      (category === null && (!present || status === 'skipped')) ||
      (!selected && status === 'skipped');
    const acceptable = status === 'success' || deliberateSkip;
    const record = { job, category, status, selected, deliberateSkip, acceptable };
    jobs.push(record);
    if (!acceptable) {
      failures.push({
        ...record,
        reason: !present
          ? 'missing required evidence'
          : status === 'skipped'
            ? 'selected job was skipped'
            : `job concluded ${status ?? 'without a conclusion'}`,
      });
    }
  }
  const execution = Array.isArray(executionReports)
    ? validateExecutionEvidence({
        reports: executionReports,
        plan: {
          categories,
          profile,
          candidateMode,
          selectedLanes,
          commitSha,
          policyVersion,
          policyHash,
          planHash,
          treeSha,
          e2eShardCount,
        },
        profile,
        candidateMode,
        workflow,
      })
    : { passed: true, failures: [], evidence: [], deferred: true };
  failures.push(...execution.failures);
  return {
    schema: 1,
    profile,
    candidateMode,
    commitSha,
    policyVersion,
    policyHash,
    passed: failures.length === 0,
    certifiable: profile !== 'candidate' || candidateMode === 'final',
    jobs,
    failures,
    selectedLanes: [...selectedLanes],
    deferredLanes: [...deferredLanes],
    execution,
  };
}

export function formatSummary(result) {
  const lines = [
    `CI / certification: ${result.passed ? 'PASS' : 'FAIL'}`,
    `Profile: ${result.profile}`,
    result.candidateMode ? `Mode: ${result.candidateMode}` : '',
    `Certifiable: ${result.certifiable ? 'yes' : 'no'}`,
    '',
    'Jobs:',
    ...result.jobs.map(
      (job) =>
        `- ${job.job}: ${job.status ?? 'missing'}${job.deliberateSkip ? ' (deliberate skip)' : ''}`,
    ),
  ];
  if (result.selectedLanes.length)
    lines.push('', `Selected lanes: ${result.selectedLanes.join(', ')}`);
  if (result.deferredLanes.length) lines.push(`Deferred lanes: ${result.deferredLanes.join(', ')}`);
  if (result.failures.length) {
    lines.push(
      '',
      'Blocking evidence:',
      ...result.failures.map((failure) => `- ${failure.job}: ${failure.reason}`),
    );
  }
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const needsPath = args[args.indexOf('--needs') + 1] ?? process.env.VARVE_CI_NEEDS;
  const planPath = args[args.indexOf('--plan') + 1] ?? process.env.VARVE_CI_PLAN;
  if (!needsPath) throw new Error('usage: aggregate-ci.mjs --needs <json> [--plan <ci-plan.json>]');
  const needs = JSON.parse(readFileSync(needsPath, 'utf8'));
  const plan = planPath ? JSON.parse(readFileSync(planPath, 'utf8')) : {};
  const executionDir =
    args[args.indexOf('--execution-dir') + 1] ?? process.env.VARVE_CI_EXECUTION_DIR;
  const executionReports = executionDir ? readJsonReports(executionDir) : null;
  const result = aggregateCertification({
    needs,
    categories: plan.categories,
    profile: plan.profile ?? 'integration',
    candidateMode: plan.candidateMode ?? null,
    selectedLanes: plan.selectedLanes ?? [],
    deferredLanes: plan.deferredLanes ?? [],
    commitSha: plan.commitSha ?? null,
    treeSha: plan.treeSha ?? null,
    planHash: plan.planHash ?? null,
    e2eShardCount: plan.e2eShardCount ?? 1,
    policyVersion: plan.policyVersion ?? null,
    policyHash: plan.policyHash ?? null,
    executionReports,
    workflow: {
      repository: process.env.GITHUB_REPOSITORY ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null,
    },
  });
  const output = args[args.indexOf('--output') + 1] ?? 'ci-certification.json';
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  const summary = formatSummary(result);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, { flag: 'a' });
  process.exitCode = result.passed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`CI certification aggregation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
