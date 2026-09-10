#!/usr/bin/env node

/**
 * Write a small, exact-source report for one CI job or matrix cell.
 *
 * Job conclusions are necessary but not sufficient certification evidence:
 * the aggregator also needs to know which source tree ran, which plan was in
 * force, and which matrix/shard identity produced the result. This file is
 * intentionally dependency-free so every runner can write the report even
 * when an earlier product command failed.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXECUTION_REPORT_SCHEMA = 1;

function gitValue(args, root) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

export function checkedOutIdentity(root = process.cwd()) {
  return {
    commitSha: gitValue(['rev-parse', '--verify', 'HEAD^{commit}'], root),
    treeSha: gitValue(['rev-parse', '--verify', 'HEAD^{tree}'], root),
  };
}

export function parseList(value) {
  if (Array.isArray(value))
    return value
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean);
  return String(value ?? '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeExecutionStatus(value) {
  const status = String(value ?? '').toLowerCase();
  if (status === 'success' || status === 'passed') return 'success';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  if (status === 'incomplete' || status === 'queued' || status === 'in_progress')
    return 'incomplete';
  return 'failure';
}

function workflowMetadata(env = process.env) {
  return {
    repository: env.GITHUB_REPOSITORY ?? null,
    runId: env.GITHUB_RUN_ID ?? null,
    runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
    event: env.GITHUB_EVENT_NAME ?? null,
    ref: env.GITHUB_REF ?? null,
    workflow: env.GITHUB_WORKFLOW ?? null,
  };
}

function runnerMetadata(env = process.env) {
  return {
    os: env.RUNNER_OS ?? process.platform,
    arch: env.RUNNER_ARCH ?? process.arch,
    name: env.RUNNER_NAME ?? null,
  };
}

export function createExecutionReport({
  root = process.cwd(),
  plan = null,
  category,
  profile = undefined,
  candidateMode = undefined,
  status = process.env.VARVE_CI_STATUS ?? 'success',
  declaredLanes = [],
  laneOutcomes = [],
  shard = null,
  matrix = process.env.VARVE_CI_MATRIX ?? process.env.RUNNER_OS ?? process.platform,
  commitSha = plan?.commitSha ?? process.env.VARVE_CI_COMMIT_SHA ?? null,
  treeSha = plan?.treeSha ?? process.env.VARVE_CI_TREE_SHA ?? null,
  planHash = plan?.planHash ?? process.env.VARVE_CI_PLAN_HASH ?? null,
  policyHash = plan?.policyHash ?? process.env.VARVE_CI_POLICY_HASH ?? null,
  env = process.env,
  startedAt = new Date().toISOString(),
  durationMs = null,
} = {}) {
  if (!category) throw new Error('execution report category is required');
  const effectiveProfile =
    profile ?? plan?.profile ?? env.VARVE_VALIDATION_PROFILE ?? 'integration';
  const effectiveCandidateMode =
    candidateMode ?? plan?.candidateMode ?? env.VARVE_CI_CANDIDATE_MODE ?? null;
  const identity = checkedOutIdentity(root);
  const normalizedOutcomes = laneOutcomes.map((outcome) => ({
    lane: outcome.lane,
    argv: Array.isArray(outcome.argv) ? [...outcome.argv] : [],
    status: normalizeExecutionStatus(outcome.status),
    exitCode: outcome.exitCode ?? null,
    signal: outcome.signal ?? null,
    timedOut: outcome.timedOut === true,
    durationMs: Number.isFinite(outcome.durationMs) ? outcome.durationMs : null,
  }));
  const declared = parseList(declaredLanes);
  const executed = normalizedOutcomes.length
    ? normalizedOutcomes
        .filter((outcome) => outcome.status === 'success')
        .map((outcome) => outcome.lane)
    : normalizeExecutionStatus(status) === 'success'
      ? declared
      : [];
  return {
    schema: EXECUTION_REPORT_SCHEMA,
    category,
    profile: effectiveProfile,
    candidateMode: effectiveCandidateMode,
    status: normalizeExecutionStatus(status),
    source: {
      commitSha: identity.commitSha,
      treeSha: identity.treeSha,
      plannedCommitSha: commitSha,
      plannedTreeSha: treeSha,
      planHash,
      policyHash,
    },
    workflow: workflowMetadata(env),
    runner: runnerMetadata(env),
    matrix: String(matrix ?? 'default'),
    shard: shard ? String(shard) : null,
    declaredLanes: declared,
    executedLanes: [...new Set(executed.filter(Boolean))],
    laneOutcomes: normalizedOutcomes,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
  };
}

export function writeExecutionReport(report, output) {
  if (!output) throw new Error('execution report output path is required');
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  // The report is written only after a complete JSON document exists. A CI
  // cancellation can still leave no report, which is deliberately incomplete
  // evidence rather than a partial green record.
  renameSync(temporary, output);
  return output;
}

function value(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}

function main() {
  const args = process.argv.slice(2);
  const planPath = value(args, '--plan');
  const plan = planPath ? JSON.parse(readFileSync(planPath, 'utf8')) : null;
  const report = createExecutionReport({
    plan,
    category: value(args, '--category'),
    status: value(args, '--status') ?? process.env.VARVE_CI_STATUS,
    declaredLanes: value(args, '--lanes'),
    shard: value(args, '--shard'),
    matrix: value(args, '--matrix'),
  });
  const output = value(args, '--output');
  writeExecutionReport(report, output);
  console.log(
    `CI execution report: ${report.status} ${report.category} ${report.matrix}${report.shard ? ` shard ${report.shard}` : ''}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`CI execution report failed: ${error.message}`);
    process.exitCode = 1;
  }
}
