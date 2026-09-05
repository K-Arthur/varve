#!/usr/bin/env node

/** Canonical exact-SHA CI planner.  No package manager is required to classify paths. */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildPlan } from './affected-plan.mjs';
import {
  CI_CATEGORIES,
  computePolicyHash,
  deriveCiCategories,
  impactFlags,
  POLICY_VERSION,
  promisedLanesForCategories,
  selectedCiLanes,
  sha256,
} from './validation-policy.mjs';

function git(args, cwd = process.cwd()) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout;
}

function parseArgs(args) {
  const flags = {
    base: null,
    head: 'HEAD',
    profile: 'integration',
    output: null,
    githubOutput: process.env.GITHUB_OUTPUT ?? null,
    validateOutput: args.includes('--validate-output'),
    planFile: null,
    forceFull: args.includes('--force-full'),
  };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--base') flags.base = args[++i];
    else if (args[i] === '--head') flags.head = args[++i];
    else if (args[i] === '--profile') flags.profile = args[++i];
    else if (args[i] === '--output') flags.output = args[++i];
    else if (args[i] === '--github-output') flags.githubOutput = args[++i];
    else if (args[i] === '--plan-file') flags.planFile = args[++i];
  }
  return flags;
}

function changedFiles(base, head, root = process.cwd()) {
  if (!base || base === head) return [];
  return git(
    [
      'diff',
      '--name-only',
      '-z',
      '--find-renames=50%',
      '--find-copies=50%',
      '--diff-filter=ACDMRTUXB',
      base,
      head,
    ],
    root,
  )
    .split('\0')
    .filter(Boolean);
}

function writeOutput(path, values) {
  if (!path) return;
  const lines = [];
  for (const [key, value] of Object.entries(values)) lines.push(`${key}=${value}`);
  writeFileSync(path, `${lines.join('\n')}\n`, { flag: 'a' });
}

export function buildCiPlan({
  base,
  head = 'HEAD',
  profile = 'integration',
  root = process.cwd(),
  planner = buildPlan,
  forceFull = false,
} = {}) {
  const resolvedHead = git(['rev-parse', '--verify', `${head}^{commit}`], root).trim();
  const resolvedBase = base
    ? git(['rev-parse', '--verify', `${base}^{commit}`], root).trim()
    : null;
  const files = changedFiles(resolvedBase, resolvedHead, root);
  const plan = planner(files);
  const categories = deriveCiCategories(plan, files);
  const flags = impactFlags(plan, files);
  if (forceFull) {
    flags.globalImpact = true;
    flags.integrationRequired = true;
    flags.releaseCandidateRequired = true;
    for (const category of CI_CATEGORIES) categories[category] = true;
  }
  const selectedLanes = selectedCiLanes(
    { ...plan, globalImpact: flags.globalImpact },
    categories,
    profile,
  );
  const deferredLanes =
    profile === 'integration'
      ? promisedLanesForCategories(categories, 'candidate').filter(
          (lane) => !selectedLanes.includes(lane),
        )
      : [];
  const policyHash = computePolicyHash({ root });
  const result = {
    schema: 1,
    profile,
    commitSha: resolvedHead,
    baseSha: resolvedBase,
    files,
    fileHash: sha256(files.join('\0')),
    plan,
    flags,
    globalImpact: flags.globalImpact,
    integrationRequired: flags.integrationRequired,
    releaseCandidateRequired: flags.releaseCandidateRequired,
    localFullRequested: flags.localFullRequested,
    categories: Object.fromEntries(CI_CATEGORIES.map((name) => [name, Boolean(categories[name])])),
    e2eShards: selectedLanes.includes('e2e:all') ? [1, 2, 3, 4, 5, 6, 7, 8] : [1],
    docs: files.some((file) => file.startsWith('docs/') || file.endsWith('.md')),
    e2eShardCount: selectedLanes.includes('e2e:all') ? 8 : 1,
    selectedLanes,
    deferredLanes,
    policyVersion: POLICY_VERSION,
    policyHash,
    generatedAt: new Date().toISOString(),
  };
  result.planHash = sha256(
    JSON.stringify({
      commitSha: result.commitSha,
      baseSha: result.baseSha,
      fileHash: result.fileHash,
      categories: result.categories,
      selectedLanes: result.selectedLanes,
      policyHash,
    }),
  );
  return result;
}

export function validateCiPlan(value, { expectedHead = null, expectedPolicyHash = null } = {}) {
  const errors = [];
  if (value?.schema !== 1) errors.push('schema must be 1');
  if (!value?.commitSha) errors.push('commitSha is required');
  if (expectedHead && value?.commitSha !== expectedHead)
    errors.push('commitSha does not match the checked-out SHA');
  if (expectedPolicyHash && value?.policyHash !== expectedPolicyHash)
    errors.push('policy hash mismatch');
  for (const category of CI_CATEGORIES) {
    if (typeof value?.categories?.[category] !== 'boolean')
      errors.push(`category ${category} is not boolean`);
  }
  if (!Array.isArray(value?.selectedLanes)) errors.push('selectedLanes must be an array');
  return errors;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.validateOutput) {
    const path = flags.planFile ?? process.env.VARVE_CI_PLAN ?? 'ci-plan.json';
    const value = JSON.parse(readFileSync(path, 'utf8'));
    const errors = validateCiPlan(value);
    if (errors.length) throw new Error(`CI plan invalid: ${errors.join('; ')}`);
    console.log(`CI plan valid: ${value.commitSha} (${value.policyHash})`);
    return;
  }
  const plan = buildCiPlan(flags);
  if (flags.output) writeFileSync(flags.output, `${JSON.stringify(plan, null, 2)}\n`);
  writeOutput(flags.githubOutput, {
    js: String(plan.categories.js),
    rust: String(plan.categories.rust),
    wasm: String(plan.categories.wasm),
    website: String(plan.categories.website),
    e2e: String(plan.categories.e2e),
    visual: String(plan.categories.visual),
    desktop: String(plan.categories.desktop),
    models: String(plan.categories.models),
    bench: String(plan.categories.bench),
    full: String(plan.globalImpact),
    global: String(plan.globalImpact),
    integration: String(plan.integrationRequired),
    candidate: String(plan.releaseCandidateRequired),
    e2e_shards: JSON.stringify(plan.e2eShards),
    e2e_shard_count: String(plan.e2eShardCount),
    docs: String(plan.docs),
    plan_hash: plan.planHash,
    policy_hash: plan.policyHash,
    commit_sha: plan.commitSha,
  });
  console.log(JSON.stringify(plan, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`ci-plan failed: ${error.message}`);
    process.exitCode = 2;
  }
}

export { changedFiles, parseArgs };
