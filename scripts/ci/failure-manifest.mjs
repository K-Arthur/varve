#!/usr/bin/env node

/** Machine-readable failure classification shared by CI debug and triage tooling. */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const TEST_ID_PATTERNS = [
  /(?:tests?\/[^\s:()]+\.(?:ts|tsx|js|mjs)(?::\d+)?(?:\s|\)|$))/g,
  /(?:[\w/-]+\.spec\.[jt]sx?(?:\s|\)|$))/g,
  /(?:[\w/-]+\.test\.[jt]sx?(?:\s|\)|$))/g,
];

const FIRST_ERROR_PATTERNS = [
  /(?:^|\n)\s*(?:error|fatal|failed|failure|assert(?:ion)?error|typeerror|referenceerror|panicked)[^\n]*/im,
  /(?:^|\n).*tim(?:e|ed)[ -]?out[^\n]*/im,
  /(?:^|\n).*out of memory|ENOMEM|JavaScript heap out of memory[^\n]*/im,
];

function textOf(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join('\n');
  if (value && typeof value === 'object') return Object.values(value).map(textOf).join('\n');
  return '';
}

export function classifyFailure({ jobName = '', stepName = '', conclusion = '', text = '' } = {}) {
  const haystack = `${jobName}\n${stepName}\n${text}`;
  if (
    /billing|spending limit|runner .*not acquired|actions outage|service unavailable/i.test(
      haystack,
    )
  ) {
    return { category: 'github-runner-or-billing-infrastructure', retryWithoutCode: false };
  }
  if (/cancelled|canceled/i.test(conclusion) || /cancelled|canceled/i.test(stepName)) {
    return { category: 'cancellation', retryWithoutCode: false };
  }
  if (/timed?[ -]?out|timeout|exceeded.*time/i.test(haystack)) {
    return {
      category: 'timeout',
      retryWithoutCode: /setup|download|install|network/i.test(haystack),
    };
  }
  if (/out of memory|ENOMEM|heap out of memory|oom-kill/i.test(haystack)) {
    return { category: 'resource-exhaustion', retryWithoutCode: false };
  }
  if (/snapshot|screenshot|visual regression|baseline|pixel diff/i.test(haystack)) {
    return { category: 'visual-regression-review-required', retryWithoutCode: false };
  }
  if (
    /install|download|fetch|resolve|cache|dependency|ENOENT|EACCES|EPERM|403|404/i.test(haystack)
  ) {
    return { category: 'dependency-cache-or-setup-failure', retryWithoutCode: true };
  }
  if (/assert|expect\(|test failed|playwright|vitest|cargo test|clippy/i.test(haystack)) {
    return { category: 'product-or-test-regression', retryWithoutCode: false };
  }
  return { category: 'unknown-requires-triage', retryWithoutCode: false };
}

function testIds(text) {
  const ids = new Set();
  for (const pattern of TEST_ID_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) ids.add(match[0].trim().replace(/[),]$/, ''));
  }
  return [...ids].sort();
}

function firstUsefulError(text) {
  for (const pattern of FIRST_ERROR_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[0]) return match[0].trim().slice(0, 1000);
  }
  return text.trim().split(/\r?\n/).find(Boolean)?.slice(0, 1000) ?? '';
}

function reproductionCommand(jobName, ids) {
  const firstPath = ids.find((id) => /\.(?:spec|test)\.[jt]sx?(?::\d+)?$/.test(id));
  if (firstPath) {
    const file = firstPath.replace(/:\d+$/, '');
    if (/\.spec\.[jt]sx?$/.test(file))
      return `pnpm exec playwright test ${file} --project=chromium --reporter=list`;
    return `pnpm exec vitest run ${file}`;
  }
  if (/website/i.test(jobName)) return 'pnpm test:website:e2e';
  if (/rust|cargo/i.test(jobName)) return 'cargo test --workspace --all-targets';
  if (/visual/i.test(jobName)) return 'pnpm e2e:visual';
  if (/e2e|playwright/i.test(jobName)) return 'pnpm e2e:all';
  if (/js/i.test(jobName)) return 'pnpm typecheck && pnpm test';
  return null;
}

export function buildFailureManifest({
  run = {},
  jobs = [],
  failuresBySource = {},
  profile = 'integration',
  artifacts = [],
  knownFailureIds = [],
  knownFailures = [],
  now = new Date(),
} = {}) {
  const entries = [];
  for (const job of jobs) {
    const jobConclusion = job.conclusion ?? job.status;
    const source = failuresBySource[job.name] ?? failuresBySource[job.id] ?? [];
    const logText = textOf(source);
    const failedSteps = (job.steps ?? []).filter((step) =>
      ['failure', 'timed_out', 'cancelled', 'canceled'].includes(step.conclusion),
    );
    const failedJob = ['failure', 'timed_out', 'cancelled', 'canceled'].includes(jobConclusion);
    if (!failedJob && failedSteps.length === 0) continue;
    const steps = failedSteps.length
      ? failedSteps
      : [{ name: job.name, conclusion: job.conclusion }];
    for (const step of steps) {
      const classification = classifyFailure({
        jobName: job.name,
        stepName: step.name,
        conclusion: step.conclusion ?? job.conclusion,
        text: logText,
      });
      const ids = testIds(logText);
      const matchingKnownFailure = (knownFailures ?? []).find(
        (entry) =>
          entry?.testId &&
          ids.includes(entry.testId) &&
          entry?.signature &&
          logText.includes(entry.signature) &&
          Date.parse(entry.expiresAt) > now.getTime(),
      );
      entries.push({
        commitSha: run.head_sha ?? run.headSha ?? null,
        workflow: run.name ?? run.workflow ?? null,
        runId: run.id ?? run.runId ?? null,
        profile,
        failedJob: job.name,
        jobId: job.id ?? null,
        failedStep: step.name ?? null,
        conclusion: step.conclusion ?? job.conclusion ?? null,
        testIds: ids,
        category: classification.category,
        firstUsefulError: firstUsefulError(logText),
        localReproductionCommand: reproductionCommand(job.name, ids),
        artifacts: artifacts.filter(
          (artifact) =>
            String(artifact).includes(String(job.name ?? '')) ||
            String(artifact).includes(String(job.id ?? '')),
        ),
        retryWithoutCode: classification.retryWithoutCode,
        governedKnownFailure: Boolean(
          matchingKnownFailure || ids.some((id) => knownFailureIds.includes(id)),
        ),
        knownFailure: matchingKnownFailure
          ? {
              testId: matchingKnownFailure.testId,
              issue: matchingKnownFailure.issue,
              owner: matchingKnownFailure.owner,
            }
          : null,
      });
    }
  }
  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    commitSha: run.head_sha ?? run.headSha ?? null,
    workflow: run.name ?? run.workflow ?? null,
    runId: run.id ?? run.runId ?? null,
    profile,
    failures: entries,
  };
}

export function validateKnownFailures(entries, { now = new Date() } = {}) {
  const errors = [];
  for (const [index, entry] of (entries ?? []).entries()) {
    const prefix = `known-failure[${index}]`;
    for (const field of [
      'testId',
      'issue',
      'owner',
      'reason',
      'platforms',
      'createdAt',
      'expiresAt',
      'signature',
    ]) {
      if (!entry?.[field]) errors.push(`${prefix}: missing ${field}`);
    }
    if (entry?.expiresAt && Date.parse(entry.expiresAt) <= now.getTime())
      errors.push(`${prefix}: expired`);
    if (!Array.isArray(entry?.platforms) || entry.platforms.length === 0)
      errors.push(`${prefix}: platforms must be a non-empty array`);
  }
  return errors;
}

function main() {
  const args = process.argv.slice(2);
  const inputPath = args[args.indexOf('--input') + 1];
  const outputPath = args[args.indexOf('--output') + 1] ?? 'ci-failure-manifest.json';
  if (!inputPath) throw new Error('usage: failure-manifest.mjs --input <json> [--output <json>]');
  const input = JSON.parse(readFileSync(inputPath, 'utf8'));
  writeFileSync(outputPath, `${JSON.stringify(buildFailureManifest(input), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`failure-manifest failed: ${error.message}`);
    process.exitCode = 1;
  }
}
