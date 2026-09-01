#!/usr/bin/env node

/**
 * Canonical validation profiles and lane policy.
 *
 * This module is deliberately dependency-light.  It is consumed by the local
 * push driver, the CI plan job, release-candidate certification, and the
 * policy tests.  Path impact still comes from affected-plan.mjs; this module
 * owns what that impact means operationally.
 *
 * A policy hash is part of every push receipt and release-candidate evidence
 * file.  Changing a selection rule therefore invalidates old evidence instead
 * of silently making it validate a different contract.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const POLICY_VERSION = '2026-08-31.validation-profiles.v1';

/** Files whose contents define lane selection or execution semantics. */
export const POLICY_FILES = [
  'validation-impact.config.mjs',
  'scripts/quality/affected-plan.mjs',
  'scripts/quality/validation-lanes.mjs',
  'scripts/quality/validation-policy.mjs',
  'scripts/quality/push-plan.mjs',
  'scripts/quality/pre-push.mjs',
  'scripts/quality/commit-checkpoint.mjs',
  'scripts/quality/history-policy.mjs',
  'scripts/quality/validation-receipts.mjs',
  'scripts/quality/ci-plan.mjs',
  'scripts/quality/ci-run-lanes.mjs',
  'scripts/quality/aggregate-ci.mjs',
  'scripts/quality/ci-preflight.mjs',
  'scripts/quality/verify.mjs',
  'scripts/ci/failure-manifest.mjs',
  'scripts/release/certification.mjs',
  'scripts/release/verify-certification.mjs',
  'scripts/release/resume.mjs',
  'scripts/release/website-release-data-check.mjs',
  'scripts/release/write-artifact-provenance.mjs',
  'scripts/release/write-candidate-evidence.mjs',
  'scripts/validate-workflows.mjs',
  'justfile',
  'Cargo.toml',
  'apps/desktop/src-tauri/Cargo.toml',
  'playwright.config.ts',
  'playwright.website.config.ts',
  'playwright-onboarding.config.ts',
  'playwright.e2e-verify.config.ts',
  'vitest.config.ts',
  'vitest.bench.config.ts',
  'vitest.setup.ts',
  'vitest.mocks.ts',
  '.github/workflows/build.yml',
  '.github/workflows/ci-smoke.yml',
  '.github/workflows/ci-debug.yml',
  '.github/workflows/e2e-keyboard-nav.yml',
  '.github/workflows/model-validation.yml',
  '.github/workflows/quantize.yml',
  '.github/workflows/visual-baselines.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/release-candidate.yml',
  '.github/workflows/release.yml',
  '.github/workflows/website-deploy.yml',
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'apps/desktop/src-tauri/Cargo.lock',
];

export const PROFILE_NAMES = ['commit', 'push', 'integration', 'candidate'];

/**
 * CI categories are stable job contracts, not implementation details of a
 * particular matrix.  Every category has a consumer in ci.yml and in the
 * candidate workflow.
 */
export const CI_CATEGORIES = Object.freeze([
  'pipeline',
  'js',
  'rust',
  'wasm',
  'website',
  'e2e',
  'visual',
  'desktop',
  'models',
  'bench',
]);

export const CI_CATEGORY_LANES = Object.freeze({
  pipeline: ['pipeline-validate', 'ci-tools', 'policy'],
  js: ['js-unit:all', 'typecheck:all', 'lint:all'],
  rust: ['rust-test:all', 'rust-clippy:all', 'cargo-fmt'],
  wasm: ['wasm'],
  website: ['website-unit', 'website-e2e'],
  e2e: ['e2e:all'],
  visual: ['e2e:visual'],
  desktop: ['desktop-native'],
  models: ['models'],
  bench: ['bench:render'],
});

export const HEAVY_PUSH_LANES = Object.freeze([
  'js-unit:all',
  'typecheck:all',
  'rust-test:all',
  'rust-clippy:all',
  'e2e:all',
  'e2e:visual',
  'website-e2e',
  'desktop-native',
  'bench:render',
]);

// This is a CI orchestration contract rather than a local executable lane.
// Strict push mode may execute every product/certification lane, but it must
// not pretend that a local synthetic check-run graph is authoritative CI.
export const REMOTE_ONLY_PUSH_LANES = Object.freeze(['pipeline-validate']);

/** Fixed operational limits.  They are policy, not a wall-clock escape hatch. */
export const PUSH_LIMITS = Object.freeze({
  maxDirectTestFiles: 12,
  maxPackageTests: 3,
  maxPackageTypechecks: 6,
  maxRustCrates: 2,
  directMasterCommitThreshold: 50,
  maxLocalEstimatedSeconds: 12 * 60,
  receiptMaxAgeMs: 6 * 60 * 60 * 1000,
  maxBinaryAdditionBytes: 10 * 1024 * 1024,
});

export const LANE_COST_SECONDS = Object.freeze({
  'history:secrets': 3,
  'history:policy': 2,
  'format:changed': 20,
  'lint:changed': 30,
  'workflow-validate': 20,
  'action-pins': 10,
  'security-policy': 20,
  'release-version': 10,
  'product-truth': 20,
  'typecheck:e2e': 45,
  policy: 40,
  'audit:docs': 20,
  'audit:emoji': 10,
  'audit:tokens': 45,
  'js-unit:file': 45,
  'js-unit:package': 100,
  'typecheck:package': 80,
  'rust-test:crate': 120,
  'rust-clippy:crate': 120,
  'ci-tools': 120,
  'website-unit': 120,
  'js-unit:all': 900,
  'typecheck:all': 500,
  'rust-test:all': 900,
  'rust-clippy:all': 900,
  'e2e:all': 2400,
  'e2e:visual': 900,
  'website-e2e': 900,
  'desktop-native': 1800,
  'bench:render': 600,
  models: 120,
  wasm: 300,
});

/** Per-lane local ceilings. A timeout is a blocking failure, never a pass. */
export const PUSH_LANE_TIMEOUT_MS = Object.freeze({
  default: 5 * 60 * 1000,
  'history:secrets': 2 * 60 * 1000,
  'history:policy': 2 * 60 * 1000,
  'format:changed': 2 * 60 * 1000,
  'lint:changed': 2 * 60 * 1000,
  policy: 3 * 60 * 1000,
  'workflow-validate': 2 * 60 * 1000,
  'action-pins': 2 * 60 * 1000,
  'security-policy': 2 * 60 * 1000,
  'release-version': 2 * 60 * 1000,
  'product-truth': 2 * 60 * 1000,
  models: 3 * 60 * 1000,
});

const ROOT = process.cwd();

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Hash the exact policy inputs, including explicit missing-file markers. */
export function computePolicyHash({ root = ROOT, files = POLICY_FILES } = {}) {
  const parts = [`policy-version\0${POLICY_VERSION}`];
  for (const file of [...files].sort()) {
    const path = join(root, file);
    const content = existsSync(path) ? readFileSync(path) : '<missing>\n';
    parts.push(`${file}\0${content}`);
  }
  return sha256(parts.join('\0'));
}

function commandVersion(command, args = ['--version']) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  if (result.status !== 0) return null;
  return `${result.stdout ?? ''}`.trim().split(/\r?\n/)[0] || null;
}

/** Tool identity used in local receipts and candidate evidence. */
export function toolVersions({ root = ROOT } = {}) {
  let packageManager = null;
  let playwright = null;
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    packageManager = pkg.packageManager ?? null;
    const lock = JSON.parse(
      readFileSync(join(root, 'node_modules/playwright/package.json'), 'utf8'),
    );
    playwright = lock.version ?? null;
  } catch {
    // Receipts remain useful when dependencies are not installed; the null is
    // part of the identity and will not match an installed-tool receipt.
  }
  return {
    node: process.version,
    pnpm: commandVersion('pnpm'),
    rustc: commandVersion('rustc'),
    cargo: commandVersion('cargo'),
    just: commandVersion('just'),
    packageManager,
    playwright,
    platform: process.platform,
    arch: process.arch,
  };
}

function pathList(plan) {
  return Object.values(plan?.changed ?? {})
    .flat()
    .filter((path) => typeof path === 'string');
}

function hasPath(plan, predicate) {
  return pathList(plan).some(predicate);
}

/**
 * `full` remains a backwards-compatible affected-plan field.  These names are
 * the unambiguous profile vocabulary used by new callers.
 */
export function impactFlags(plan, files = pathList(plan)) {
  const globalImpact = Boolean(plan?.full || plan?.globalImpact);
  const hasProductPath = files.some(
    (path) =>
      !path.startsWith('docs/') &&
      !path.startsWith('.github/') &&
      !path.startsWith('scripts/') &&
      !path.endsWith('.md'),
  );
  return {
    globalImpact,
    integrationRequired: globalImpact || hasProductPath || Boolean(plan?.tiers?.[2]?.length),
    releaseCandidateRequired:
      globalImpact ||
      hasPath(plan, (path) =>
        /^(packages\/scene|packages\/engine|packages\/editor|packages\/platform|crates\/|apps\/desktop|tests\/e2e|playwright\.config|\.github\/workflows|scripts\/release|pnpm-lock|Cargo\.lock)/.test(
          path,
        ),
      ),
    localFullRequested: false,
  };
}

/** Derive CI categories once; local and remote consumers use this result. */
export function deriveCiCategories(plan, files = pathList(plan)) {
  const flags = impactFlags(plan, files);
  const tierLanes = Object.values(plan?.tiers ?? {}).flat();
  const directBrowser = Boolean(
    (plan?.directE2eFiles ?? []).some((file) => !file.startsWith('tests/e2e/visual/')) ||
      tierLanes.some((lane) => lane.startsWith('e2e:file:') && !lane.includes('/visual/')),
  );
  const hasFile = (predicate) => files.some(predicate);
  const category = {
    pipeline: true,
    js: Boolean(plan?.changed?.js?.length || plan?.changed?.app?.length),
    rust: Boolean(plan?.changed?.rust?.length),
    wasm: hasFile((path) => path.includes('wasm') || path.startsWith('crates/varve-wasm/')),
    website:
      hasFile((path) => path.startsWith('apps/website/') || path.startsWith('scripts/website/')) ||
      tierLanes.includes('website-e2e') ||
      tierLanes.includes('website-unit'),
    e2e:
      directBrowser ||
      Boolean(
        plan?.tiers?.[4]?.some(
          (lane) => lane.startsWith('e2e:') && lane !== 'e2e:visual' && !lane.includes('/visual/'),
        ),
      ),
    visual:
      Boolean(plan?.tiers?.[4]?.includes('e2e:visual')) ||
      (plan?.directE2eFiles ?? []).some((file) => file.startsWith('tests/e2e/visual/')) ||
      (plan?.e2eDomains ?? []).includes('visual'),
    desktop: hasFile((path) => path.startsWith('apps/desktop/') || path.startsWith('tests/wdio/')),
    models: hasFile(
      (path) =>
        path.startsWith('models/') ||
        path.includes('/models/') ||
        path.startsWith('scripts/models/'),
    ),
    bench: Boolean(
      plan?.tiers?.[4]?.some((lane) => lane.startsWith('bench:')) || plan?.benchDomains?.length,
    ),
  };

  if (flags.globalImpact) {
    for (const name of CI_CATEGORIES) category[name] = true;
  }
  // Browser, visual, and desktop jobs consume the WASM artifact. This
  // dependency is a contract of the job graph, not a path regex; it does not
  // imply that the full Rust workspace lane is required for every browser edit.
  if (category.e2e || category.visual || category.desktop) {
    category.wasm = true;
  }
  // A website source file is both a JS package change and a website change;
  // website jobs must not be hidden behind an unrelated package classification.
  if (category.website) category.js = true;
  return category;
}

export function promisedLanesForCategories(categories, profile = 'integration') {
  const lanes = new Set(['pipeline-validate']);
  const candidateCategories =
    profile === 'candidate'
      ? Object.fromEntries(CI_CATEGORIES.map((name) => [name, true]))
      : categories;
  for (const category of CI_CATEGORIES) {
    if (!candidateCategories?.[category]) continue;
    for (const lane of CI_CATEGORY_LANES[category] ?? []) lanes.add(lane);
  }
  if (profile === 'candidate') {
    for (const lane of HEAVY_PUSH_LANES) lanes.add(lane);
  }
  return [...lanes].sort();
}

/**
 * Resolve a concrete integration lane list from the affected plan. Category
 * jobs remain stable for GitHub checks, while ordinary runs execute package,
 * crate, domain, and direct-test lanes instead of accidentally running every
 * workspace test. Global/candidate profiles deliberately retain the complete
 * category contract.
 */
export function selectedCiLanes(plan, categories, profile = 'integration') {
  if (profile === 'candidate' || plan?.full || plan?.globalImpact) {
    return promisedLanesForCategories(
      categories,
      profile === 'candidate' ? 'candidate' : 'integration',
    );
  }

  const lanes = new Set(['pipeline-validate']);
  const planLanes = Object.values(plan?.tiers ?? {}).flat();
  const add = (predicate) => {
    for (const lane of planLanes) if (predicate(lane)) lanes.add(lane);
  };

  if (categories.js) {
    add(
      (lane) =>
        (lane.startsWith('js-unit:') || lane.startsWith('typecheck:')) &&
        lane !== 'typecheck:e2e' &&
        lane !== 'typecheck:all' &&
        lane !== 'js-unit:all',
    );
    add((lane) => lane === 'audit:tokens');
  }
  if (categories.rust) {
    add((lane) => lane.startsWith('rust-test:') || lane.startsWith('rust-clippy:'));
    if (plan?.changed?.rust?.length) lanes.add('cargo-fmt');
  }
  if (categories.wasm) lanes.add('wasm');
  if (categories.website) {
    lanes.add('website-unit');
    add((lane) => lane === 'website-e2e');
  }
  if (categories.e2e) {
    add((lane) => lane === 'typecheck:e2e' || (lane.startsWith('e2e:') && lane !== 'e2e:visual'));
  }
  if (categories.visual) lanes.add('e2e:visual');
  if (categories.desktop) lanes.add('desktop-native');
  if (categories.models) lanes.add('models');
  if (categories.bench) add((lane) => lane.startsWith('bench:'));

  return [...lanes].sort();
}

/**
 * Select the bounded local push checkpoint.  It never infers a full local
 * suite from commit count.  Once the fixed limits are reached, the remaining
 * work is explicitly remote-required/deferred.
 */
export function selectPushValidation(plan, { files = pathList(plan), strict = false } = {}) {
  const categories = deriveCiCategories(plan, files);
  const flags = impactFlags(plan, files);
  const localBlocking = ['history:secrets', 'history:policy', 'format:changed', 'lint:changed'];
  const deferred = new Set();
  const remoteRequired = new Set(['pipeline-validate']);
  const localReasons = [];
  let estimatedSeconds = localBlocking.reduce(
    (sum, lane) => sum + (LANE_COST_SECONDS[lane] ?? 60),
    0,
  );

  const directTests = files.filter((file) => /\.(test|spec)\.(ts|tsx)$/.test(file));
  if (directTests.length <= PUSH_LIMITS.maxDirectTestFiles) {
    for (const file of directTests.filter((file) => !file.startsWith('tests/e2e/')).sort()) {
      localBlocking.push(`js-unit:file:${file}`);
      estimatedSeconds += LANE_COST_SECONDS['js-unit:file'];
    }
  } else if (directTests.length > 0) {
    localReasons.push(
      `direct test count ${directTests.length} exceeds fixed local limit ${PUSH_LIMITS.maxDirectTestFiles}`,
    );
  }

  const packageTestLanes = (plan?.tiers?.[2] ?? [])
    .filter((lane) => lane.startsWith('js-unit:') && !lane.endsWith(':all'))
    .sort();
  if (packageTestLanes.length <= PUSH_LIMITS.maxPackageTests) {
    for (const lane of packageTestLanes) {
      localBlocking.push(lane);
      estimatedSeconds += LANE_COST_SECONDS['js-unit:package'];
    }
  } else if (packageTestLanes.length > 0) {
    localReasons.push(
      `package test count ${packageTestLanes.length} exceeds fixed local limit ${PUSH_LIMITS.maxPackageTests}`,
    );
  }

  const packageTypechecks = (plan?.tiers?.[2] ?? [])
    .filter((lane) => lane.startsWith('typecheck:') && !lane.endsWith(':all'))
    .sort();
  if (packageTypechecks.length <= PUSH_LIMITS.maxPackageTypechecks) {
    for (const lane of packageTypechecks) {
      localBlocking.push(lane);
      estimatedSeconds += LANE_COST_SECONDS['typecheck:package'];
    }
  } else {
    localReasons.push(
      `package typecheck count ${packageTypechecks.length} exceeds fixed local limit ${PUSH_LIMITS.maxPackageTypechecks}`,
    );
    for (const lane of packageTypechecks) {
      deferred.add(lane);
      remoteRequired.add(lane);
    }
  }

  const rustTests = (plan?.tiers?.[2] ?? []).filter((lane) => lane.startsWith('rust-test:')).sort();
  const rustClippy = (plan?.tiers?.[2] ?? [])
    .filter((lane) => lane.startsWith('rust-clippy:'))
    .sort();
  if (
    rustTests.length <= PUSH_LIMITS.maxRustCrates &&
    rustClippy.length <= PUSH_LIMITS.maxRustCrates
  ) {
    for (const lane of [...rustTests, ...rustClippy]) {
      localBlocking.push(lane);
      estimatedSeconds += LANE_COST_SECONDS['rust-test:crate'];
    }
  } else if (rustTests.length || rustClippy.length) {
    localReasons.push(`Rust crate count exceeds fixed local limit ${PUSH_LIMITS.maxRustCrates}`);
  }

  if (plan?.tiers?.[1]?.includes('typecheck:e2e') && !flags.globalImpact) {
    localBlocking.push('typecheck:e2e');
    estimatedSeconds += LANE_COST_SECONDS['typecheck:e2e'];
  }
  if (plan?.tiers?.[0]?.includes('audit:docs')) localBlocking.push('audit:docs');
  if (plan?.tiers?.[0]?.includes('audit:emoji')) localBlocking.push('audit:emoji');
  if (plan?.tiers?.[0]?.includes('audit:tokens')) localBlocking.push('audit:tokens');
  if (
    files.some(
      (file) => file.startsWith('scripts/quality/') || file === 'validation-impact.config.mjs',
    )
  ) {
    localBlocking.push('policy');
    estimatedSeconds += LANE_COST_SECONDS.policy;
  }

  if (files.some((file) => file.startsWith('.github/workflows/'))) {
    localBlocking.push('workflow-validate', 'action-pins', 'security-policy');
    estimatedSeconds +=
      LANE_COST_SECONDS['workflow-validate'] +
      LANE_COST_SECONDS['action-pins'] +
      LANE_COST_SECONDS['security-policy'];
  }
  if (
    files.some(
      (file) =>
        file === 'package.json' ||
        file === 'pnpm-lock.yaml' ||
        file.startsWith('scripts/release/') ||
        file.startsWith('packaging/') ||
        file.startsWith('apps/desktop/src-tauri/'),
    )
  ) {
    localBlocking.push('release-version', 'product-truth');
    estimatedSeconds += LANE_COST_SECONDS['release-version'] + LANE_COST_SECONDS['product-truth'];
  }
  for (const category of CI_CATEGORIES) {
    if (!categories[category] || category === 'pipeline') continue;
    const promised = CI_CATEGORY_LANES[category] ?? [];
    for (const lane of promised) {
      if (strict) localBlocking.push(lane);
      else if (HEAVY_PUSH_LANES.includes(lane) || lane.endsWith(':all') || lane === 'wasm') {
        deferred.add(lane);
        remoteRequired.add(lane);
      } else {
        localBlocking.push(lane);
        estimatedSeconds += LANE_COST_SECONDS[lane] ?? 60;
      }
    }
  }

  if (flags.globalImpact) {
    localReasons.push('global impact requires authoritative remote certification');
    for (const lane of promisedLanesForCategories(
      Object.fromEntries(CI_CATEGORIES.map((name) => [name, true])),
      'integration',
    )) {
      if (!localBlocking.includes(lane)) remoteRequired.add(lane);
    }
  }

  if (strict) {
    for (const lane of promisedLanesForCategories(categories, 'candidate')) {
      if (REMOTE_ONLY_PUSH_LANES.includes(lane)) {
        remoteRequired.add(lane);
        continue;
      }
      if (!localBlocking.includes(lane)) localBlocking.push(lane);
    }
    deferred.clear();
  }

  // Fixed budget is a reporting guard.  We do not drop a selected cheap lane
  // after the fact; only future additions are remote-required.
  if (!strict && estimatedSeconds > PUSH_LIMITS.maxLocalEstimatedSeconds) {
    localReasons.push(
      `selected local checkpoint estimate ${estimatedSeconds}s exceeds ${PUSH_LIMITS.maxLocalEstimatedSeconds}s; heavyweight lanes remain remote-required`,
    );
  }

  return {
    profile: 'push',
    flags,
    categories,
    localBlocking: [...new Set(localBlocking)],
    remoteRequired: [...remoteRequired].sort(),
    deferred: [...deferred].sort(),
    reasons: [...new Set([...(plan?.reasons ?? []), ...localReasons])],
    estimatedLocalSeconds: estimatedSeconds,
    limits: PUSH_LIMITS,
    promisedIntegrationLanes: promisedLanesForCategories(categories, 'integration'),
    promisedCandidateLanes: promisedLanesForCategories(categories, 'candidate'),
  };
}

export function canonicalPolicySummary({ root = ROOT } = {}) {
  const policyHash = computePolicyHash({ root });
  return {
    policyVersion: POLICY_VERSION,
    policyHash,
    profiles: PROFILE_NAMES,
    categories: CI_CATEGORIES,
    limits: PUSH_LIMITS,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(canonicalPolicySummary(), null, 2)}\n`);
}
