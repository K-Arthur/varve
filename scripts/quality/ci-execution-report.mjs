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
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { redactSensitive } from '../ci/failure-manifest.mjs';
import { CERTIFIED_BROWSER_POLICY } from './browser-execution-policy.mjs';
import { browserCaseId, inventoryCoverageErrors, inventoryErrors } from './browser-inventory.mjs';

export const EXECUTION_REPORT_SCHEMA = 1;

const BROWSER_STATUSES = new Set(['expected', 'unexpected', 'flaky', 'skipped']);
const ATTEMPT_STATUSES = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
const COUNT_KEYS = ['expected', 'unexpected', 'flaky', 'skipped'];

export function browserLane(lane) {
  return lane?.startsWith('e2e:') || lane === 'website-e2e';
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Stable across source line movement; retain Playwright's own source-specific ID too. */
function browserCases(suites, parents = [], collected = []) {
  if (!Array.isArray(suites)) throw new Error('suites must be an array');
  for (const suite of suites) {
    if (!Array.isArray(suite.specs)) throw new Error('suite specs must be an array');
    const titles = [...parents, suite.title];
    for (const spec of suite.specs) {
      if (
        typeof spec.file !== 'string' ||
        typeof spec.title !== 'string' ||
        !Array.isArray(spec.tests)
      )
        throw new Error('invalid browser spec');
      for (const test of spec.tests) {
        if (
          typeof test.projectName !== 'string' ||
          !BROWSER_STATUSES.has(test.status) ||
          !Array.isArray(test.results)
        )
          throw new Error('invalid browser case');
        const titlePath = [...titles, spec.title];
        collected.push({
          caseId: browserCaseId(spec.file, titlePath, test.projectName),
          playwrightSpecId: spec.id ?? null,
          file: spec.file.replaceAll('\\', '/'),
          titlePath,
          project: test.projectName,
          line: spec.line ?? null,
          expectedStatus: test.expectedStatus,
          status: test.status,
          annotations: (test.annotations ?? [])
            .filter((entry) => ['skip', 'fixme'].includes(entry.type))
            .map((entry) => ({
              type: entry.type,
              description: redactSensitive(String(entry.description ?? '')).slice(0, 1000),
            })),
          attempts: test.results.map((result) => ({
            retry: result.retry,
            status: result.status,
            durationMs: result.duration,
            startedAt: result.startTime ?? null,
            // Do not copy credential-bearing stdout, stderr or error text into receipts.
            errorFingerprints: (result.errors ?? []).map((error) =>
              digest(String(error.message ?? '')),
            ),
          })),
        });
      }
    }
    browserCases(suite.suites ?? [], titles, collected);
  }
  return collected;
}

function browserCaseHistoryErrors(report) {
  const errors = [];
  if (!/^[a-f0-9]{64}$/.test(report?.sha256 ?? '')) errors.push('missing report digest');
  const stats = report?.stats;
  if (!stats || !COUNT_KEYS.every((key) => Number.isSafeInteger(stats[key]) && stats[key] >= 0))
    errors.push('invalid browser counts');
  else if (stats.unexpected || stats.flaky) errors.push('unexpected or flaky browser cases');
  if (
    report?.runner?.workers !== CERTIFIED_BROWSER_POLICY.workers ||
    report?.runner?.updateSnapshots !== CERTIFIED_BROWSER_POLICY.updateSnapshots ||
    report?.runner?.failOnFlakyTests !== CERTIFIED_BROWSER_POLICY.failOnFlakyTests ||
    report?.runner?.trace !== CERTIFIED_BROWSER_POLICY.trace
  )
    errors.push('browser execution policy drift');
  if (
    !Array.isArray(report?.runner?.projects) ||
    !report.runner.projects.length ||
    report.runner.projects.some((project) => project?.retries !== CERTIFIED_BROWSER_POLICY.retries)
  )
    errors.push('browser retry policy drift');
  if (!Number.isSafeInteger(report?.globalErrorCount) || report.globalErrorCount !== 0)
    errors.push('browser runner errors');
  if (!Array.isArray(report?.cases) || report.cases.length === 0)
    errors.push('missing or empty case history');
  else {
    if (report.historySha256 !== digest(JSON.stringify(report.cases)))
      errors.push('case history digest mismatch');
    const counts = Object.fromEntries(COUNT_KEYS.map((key) => [key, 0]));
    const ids = new Set();
    for (const test of report.cases) {
      if (!test || typeof test !== 'object') {
        errors.push('invalid case history entry');
        continue;
      }
      if (
        !BROWSER_STATUSES.has(test.status) ||
        !/^[a-f0-9]{64}$/.test(test.caseId ?? '') ||
        ids.has(test.caseId)
      )
        errors.push('invalid or duplicate case identity');
      ids.add(test.caseId);
      if (test.status in counts) counts[test.status]++;
      if (
        !Array.isArray(test.attempts) ||
        test.attempts.some(
          (attempt) => attempt?.retry !== 0 || !ATTEMPT_STATUSES.has(attempt?.status),
        )
      )
        errors.push('invalid or retried case attempt');
      if (
        test.status === 'expected' &&
        test.attempts?.some((attempt) => attempt?.status !== test.expectedStatus)
      )
        errors.push('case expectation mismatch');
      if (test.status !== 'skipped' && test.attempts?.length !== 1)
        errors.push('incomplete or repeated case history');
    }
    if (stats && COUNT_KEYS.some((key) => counts[key] !== stats[key]))
      errors.push('case/count mismatch');
  }
  return [...new Set(errors)];
}

/** Certification always requires the planned inventory, including for reviewed captures. */
export function browserReportErrors(report) {
  const errors = browserCaseHistoryErrors(report);
  if (report?.reviewOnly === true || report?.certified === false)
    errors.push('review-only browser report cannot certify');
  errors.push(
    ...inventoryCoverageErrors(report?.inventory, report?.cases, {
      complete: report?.shard == null,
    }),
  );
  return [...new Set(errors)];
}

/** Selected baseline reviews retain strict history but never establish lane coverage. */
export function browserReviewReportErrors(report) {
  const errors = browserCaseHistoryErrors({
    ...report,
    runner: { ...report?.runner, updateSnapshots: 'none' },
  });
  if (!['none', 'changed'].includes(report?.runner?.updateSnapshots))
    errors.push('browser execution policy drift');
  if (report?.reviewOnly !== true || report?.certified !== false)
    errors.push('missing review-only browser provenance');
  return [...new Set(errors)];
}

/** Keep failed/missing evidence as data so cancellation cannot fabricate a green receipt. */
export function collectBrowserEvidence(
  descriptors = [],
  { root = process.cwd(), inventory = null, reviewOnly = false } = {},
) {
  const reports = [];
  const errors = [];
  for (const descriptor of descriptors) {
    try {
      const bytes = readFileSync(resolve(root, descriptor.path));
      const json = JSON.parse(bytes.toString('utf8'));
      if (!Array.isArray(json.errors)) throw new Error('runner errors must be an array');
      const report = {
        ...(reviewOnly ? { reviewOnly: true, certified: false } : {}),
        lane: descriptor.lane,
        path: descriptor.path,
        sha256: digest(bytes),
        stats: json.stats,
        runner: {
          workers: json.config?.workers,
          updateSnapshots: json.config?.updateSnapshots,
          failOnFlakyTests: json.config?.failOnFlakyTests,
          trace: json.config?.argv?.includes('--trace=retain-on-failure')
            ? 'retain-on-failure'
            : null,
          projects: json.config?.projects?.map((project) => ({
            name: project.name,
            retries: project.retries,
          })),
        },
        globalErrorCount: json.errors.length,
        cases: browserCases(json.suites),
        shard: json.config?.shard
          ? `${json.config.shard.current}/${json.config.shard.total}`
          : null,
        // A complete, unsharded lane can be owned by one browser matrix cell
        // without claiming that Playwright itself used --shard. Keep the two
        // identities separate so per-case coverage remains complete.
        executionShard: descriptor.executionShard ?? null,
        inventory:
          descriptor.inventory ??
          (descriptor.inventoryPath
            ? JSON.parse(readFileSync(resolve(root, descriptor.inventoryPath), 'utf8'))
            : inventory),
      };
      report.historySha256 = digest(JSON.stringify(report.cases));
      reports.push(report);
      const reportErrors = reviewOnly
        ? browserReviewReportErrors(report)
        : browserReportErrors(report);
      errors.push(...reportErrors.map((error) => `${descriptor.lane}: ${error}`));
    } catch (error) {
      // Do not expose an untrusted JSON value or its parser excerpt in logs.
      errors.push(
        `${descriptor.lane}: missing or malformed browser report (${error.code ?? error.name})`,
      );
    }
  }
  return {
    schema: 1,
    ...(reviewOnly ? { reviewOnly: true, certified: false } : {}),
    reports,
    errors: [...new Set(errors)],
  };
}

export function browserEvidenceErrors(evidence, requiredLanes = []) {
  if (!requiredLanes.length) return [];
  if (
    evidence?.schema !== 1 ||
    !Array.isArray(evidence?.reports) ||
    !Array.isArray(evidence?.errors)
  )
    return ['missing browser execution evidence'];
  const errors = [...evidence.errors];
  if (evidence.reviewOnly === true || evidence.certified === false)
    errors.push('review-only browser evidence cannot certify');
  for (const lane of requiredLanes) {
    const reports = evidence.reports.filter((report) => report?.lane === lane);
    if (!reports.length) errors.push(`${lane}: missing browser report`);
    for (const report of reports)
      errors.push(...browserReportErrors(report).map((error) => `${lane}: ${error}`));
  }
  return [...new Set(errors)];
}

function gitValue(args, root) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  // Preserve leading whitespace: porcelain status uses it to encode whether
  // a tracked path changed in the index or worktree.
  return result.stdout.trimEnd();
}

export function checkedOutIdentity(root = process.cwd()) {
  const status = gitValue(['status', '--porcelain=v1', '--untracked-files=all'], root);
  const dirtyPaths = status
    .split(/\r?\n/)
    .filter(Boolean)
    .map((entry) => redactSensitive(entry.slice(3)).slice(0, 500));
  return {
    clean: dirtyPaths.length === 0,
    dirtyPathCount: dirtyPaths.length,
    dirtyPaths: dirtyPaths.slice(0, 50),
    commitSha: gitValue(['rev-parse', '--verify', 'HEAD^{commit}'], root),
    treeSha: gitValue(['rev-parse', '--verify', 'HEAD^{tree}'], root),
  };
}

/** Fail a cheap validation job before dependent integration lanes start. */
export function assertCleanSource(root = process.cwd()) {
  const identity = checkedOutIdentity(root);
  if (!identity.clean) {
    const paths = identity.dirtyPaths.length ? `: ${identity.dirtyPaths.join(', ')}` : '';
    throw new Error(`execution source is not clean${paths}`);
  }
  return identity;
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
  browserReports = [],
  browserEvidence = null,
  shard = null,
  matrix = process.env.VARVE_CI_MATRIX ?? process.env.RUNNER_OS ?? process.platform,
  commitSha = plan?.commitSha ?? process.env.VARVE_CI_COMMIT_SHA ?? null,
  treeSha = plan?.treeSha ?? process.env.VARVE_CI_TREE_SHA ?? null,
  planHash = plan?.planHash ?? process.env.VARVE_CI_PLAN_HASH ?? null,
  policyHash = plan?.policyHash ?? process.env.VARVE_CI_POLICY_HASH ?? null,
  env = process.env,
  startedAt = new Date().toISOString(),
  durationMs = null,
  readSource = checkedOutIdentity,
} = {}) {
  if (!category) throw new Error('execution report category is required');
  const effectiveProfile =
    profile ?? plan?.profile ?? env.VARVE_VALIDATION_PROFILE ?? 'integration';
  const effectiveCandidateMode =
    candidateMode ?? plan?.candidateMode ?? env.VARVE_CI_CANDIDATE_MODE ?? null;
  const identity = readSource(root);
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
  const requiredBrowserLanes = [
    ...new Set(
      [...declared, ...normalizedOutcomes.map((outcome) => outcome.lane)].filter(browserLane),
    ),
  ];
  let inventory = null;
  if (env.VARVE_CI_BROWSER_INVENTORY) {
    try {
      inventory = JSON.parse(readFileSync(resolve(root, env.VARVE_CI_BROWSER_INVENTORY), 'utf8'));
    } catch {
      /* Missing evidence is retained as a blocking receipt error. */
    }
  }
  const playwright = browserEvidence ?? collectBrowserEvidence(browserReports, { root, inventory });
  const evidenceErrors = browserEvidenceErrors(playwright, requiredBrowserLanes);
  if (identity.clean !== true) evidenceErrors.push('execution source is not clean');
  for (const browser of playwright.reports ?? []) {
    const expectedInventorySource = {
      commitSha: identity.commitSha,
      treeSha: identity.treeSha,
      policyHash,
      ...(browser.lane === 'e2e:demo-dist' ? {} : { planHash }),
    };
    evidenceErrors.push(...inventoryErrors(browser.inventory, expectedInventorySource));
    if (browser.inventory?.lane !== browser.lane)
      evidenceErrors.push('browser inventory lane mismatch');
    if ((browser.executionShard ?? browser.shard) !== (shard ? String(shard) : null))
      evidenceErrors.push('browser inventory shard mismatch');
  }
  for (const outcome of normalizedOutcomes) {
    if (browserLane(outcome.lane) && browserEvidenceErrors(playwright, [outcome.lane]).length)
      outcome.status = 'failure';
  }
  const executionStatus =
    normalizeExecutionStatus(status) === 'success' && evidenceErrors.length
      ? 'failure'
      : normalizeExecutionStatus(status);
  const executed = normalizedOutcomes.length
    ? normalizedOutcomes
        .filter((outcome) => outcome.status === 'success')
        .map((outcome) => outcome.lane)
    : executionStatus === 'success'
      ? declared
      : [];
  return {
    schema: EXECUTION_REPORT_SCHEMA,
    category,
    profile: effectiveProfile,
    candidateMode: effectiveCandidateMode,
    status: executionStatus,
    playwright: requiredBrowserLanes.length ? { ...playwright, errors: evidenceErrors } : null,
    source: {
      clean: identity.clean === true,
      dirtyPathCount: Number.isSafeInteger(identity.dirtyPathCount)
        ? identity.dirtyPathCount
        : identity.clean === true
          ? 0
          : null,
      dirtyPaths: Array.isArray(identity.dirtyPaths) ? identity.dirtyPaths.slice(0, 50) : [],
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
  if (args.includes('--assert-clean')) {
    const identity = assertCleanSource();
    console.log(`CI source is clean: ${identity.commitSha}`);
    return;
  }
  const planPath = value(args, '--plan');
  const plan = planPath ? JSON.parse(readFileSync(planPath, 'utf8')) : null;
  const report = createExecutionReport({
    plan,
    category: value(args, '--category'),
    status: value(args, '--status') ?? process.env.VARVE_CI_STATUS,
    declaredLanes: value(args, '--lanes'),
    shard: value(args, '--shard'),
    matrix: value(args, '--matrix'),
    browserReports: args
      .flatMap((arg, index) => {
        if (arg !== '--playwright-report') return [];
        const descriptor = args[index + 1] ?? '';
        const separator = descriptor.indexOf('=');
        if (separator < 1) throw new Error('--playwright-report requires lane=path');
        return [{ lane: descriptor.slice(0, separator), path: descriptor.slice(separator + 1) }];
      })
      .map((descriptor) => {
        const inventories = args.flatMap((arg, index) =>
          arg === '--playwright-inventory' ? [args[index + 1] ?? ''] : [],
        );
        const match = inventories.find((entry) => entry.startsWith(`${descriptor.path}=`));
        const assignedShards = args.flatMap((arg, index) =>
          arg === '--playwright-shard' ? [args[index + 1] ?? ''] : [],
        );
        const shardAssignment = assignedShards.find((entry) =>
          entry.startsWith(`${descriptor.lane}=`),
        );
        return {
          ...descriptor,
          ...(match ? { inventoryPath: match.slice(descriptor.path.length + 1) } : {}),
          ...(shardAssignment
            ? { executionShard: shardAssignment.slice(descriptor.lane.length + 1) }
            : {}),
        };
      }),
  });
  const output = value(args, '--output');
  writeExecutionReport(report, output);
  if (report.playwright?.errors.length) {
    console.error(`Browser execution evidence rejected: ${report.playwright.errors.join('; ')}`);
    process.exitCode = 1;
  }
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
