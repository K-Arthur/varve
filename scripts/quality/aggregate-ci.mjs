#!/usr/bin/env node

/** Stable CI certification aggregator.  Deliberate skips are data, not green by accident. */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

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

export function aggregateCertification({
  needs = {},
  categories = {},
  profile = 'integration',
  selectedLanes = [],
  deferredLanes = [],
  commitSha = null,
  policyVersion = null,
  policyHash = null,
} = {}) {
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
  return {
    schema: 1,
    profile,
    commitSha,
    policyVersion,
    policyHash,
    passed: failures.length === 0,
    jobs,
    failures,
    selectedLanes: [...selectedLanes],
    deferredLanes: [...deferredLanes],
  };
}

export function formatSummary(result) {
  const lines = [
    `CI / certification: ${result.passed ? 'PASS' : 'FAIL'}`,
    `Profile: ${result.profile}`,
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
  const result = aggregateCertification({
    needs,
    categories: plan.categories,
    profile: plan.profile ?? 'integration',
    selectedLanes: plan.selectedLanes ?? [],
    deferredLanes: plan.deferredLanes ?? [],
    commitSha: plan.commitSha ?? null,
    policyVersion: plan.policyVersion ?? null,
    policyHash: plan.policyHash ?? null,
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
