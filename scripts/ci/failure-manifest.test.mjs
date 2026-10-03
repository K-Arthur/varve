#!/usr/bin/env node

/** Failure classification, known-debt governance, and manifest shape tests. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildFailureManifest,
  classifyFailure,
  hasRecordedExecution,
  isDependencyVulnerability,
  validateKnownFailures,
} from './failure-manifest.mjs';

assert.equal(
  classifyFailure({ stepName: 'Playwright screenshot', text: 'pixel diff' }).category,
  'visual-regression-review-required',
);
assert.equal(
  classifyFailure({ stepName: 'Install browsers', text: 'network timeout' }).retryWithoutCode,
  true,
);
assert.equal(
  classifyFailure({ stepName: 'cargo test', text: 'JavaScript heap out of memory' }).category,
  'resource-exhaustion',
);
assert.equal(
  classifyFailure({ conclusion: 'cancelled', stepName: 'E2E' }).category,
  'cancellation',
);
assert.equal(
  classifyFailure({ text: 'payments have failed or your spending limit needs to be increased' })
    .category,
  'github-runner-or-billing-infrastructure',
);
assert.equal(
  classifyFailure({ stepName: 'expect', text: 'AssertionError tests/e2e/canvas/tools.spec.ts' })
    .category,
  'product-or-test-regression',
);

const manifest = buildFailureManifest({
  run: { id: 42, name: 'CI', head_sha: 'a'.repeat(40) },
  profile: 'integration',
  jobs: [
    {
      id: 7,
      name: 'E2E (Playwright) 1/8',
      conclusion: 'failure',
      steps: [{ name: 'browser assertion', conclusion: 'failure' }],
    },
  ],
  failuresBySource: {
    'E2E (Playwright) 1/8':
      'AssertionError: tests/e2e/canvas/tools.spec.ts expected true to be false',
  },
  artifacts: ['E2E (Playwright) 1/8-report'],
  knownFailureIds: ['tests/e2e/canvas/tools.spec.ts'],
});
assert.equal(manifest.commitSha, 'a'.repeat(40));
assert.equal(manifest.failures.length, 1);
assert.equal(manifest.failures[0].governedKnownFailure, true);
assert.equal(manifest.failures[0].retryWithoutCode, false);
assert.equal(manifest.failures[0].artifacts[0], 'E2E (Playwright) 1/8-report');

const knownManifest = buildFailureManifest({
  run: { id: 43, name: 'CI', head_sha: 'a'.repeat(40) },
  jobs: [
    {
      id: 8,
      name: 'JS',
      conclusion: 'failure',
      steps: [{ name: 'unit assertion', conclusion: 'failure' }],
    },
  ],
  failuresBySource: { JS: 'AssertionError tests/unit/foo.test.ts expected old behavior' },
  knownFailures: [
    {
      testId: 'tests/unit/foo.test.ts',
      issue: '#124',
      owner: '@varve/maintainers',
      reason: 'temporary known defect',
      createdAt: '2026-08-01T00:00:00Z',
      expiresAt: '2026-09-30T00:00:00Z',
      signature: 'expected old behavior',
    },
  ],
  now: new Date('2026-08-31T00:00:00Z'),
});
assert.equal(knownManifest.failures[0].governedKnownFailure, true);
assert.equal(knownManifest.failures[0].knownFailure.issue, '#124');
const changedSignature = buildFailureManifest({
  run: { id: 44, name: 'CI', head_sha: 'a'.repeat(40) },
  jobs: [
    {
      id: 8,
      name: 'JS',
      conclusion: 'failure',
      steps: [{ name: 'unit assertion', conclusion: 'failure' }],
    },
  ],
  failuresBySource: { JS: 'AssertionError tests/unit/foo.test.ts different behavior' },
  knownFailures: [
    {
      testId: 'tests/unit/foo.test.ts',
      issue: '#124',
      owner: '@varve/maintainers',
      reason: 'temporary known defect',
      createdAt: '2026-08-01T00:00:00Z',
      expiresAt: '2026-09-30T00:00:00Z',
      signature: 'expected old behavior',
    },
  ],
  now: new Date('2026-08-31T00:00:00Z'),
});
assert.equal(changedSignature.failures[0].governedKnownFailure, false);

assert.deepEqual(validateKnownFailures([], { now: new Date('2026-08-31T00:00:00Z') }), []);
assert.ok(
  validateKnownFailures(
    [
      {
        testId: 'tests/unit/foo.test.ts',
        issue: '#123',
        owner: '@varve/maintainers',
        reason: 'missing platform fixture',
        createdAt: '2026-08-01T00:00:00Z',
        expiresAt: '2026-09-30T00:00:00Z',
        signature: 'expected old behavior',
      },
    ],
    { now: new Date('2026-08-31T00:00:00Z') },
  ).some((error) => error.includes('platforms')),
);
const known = {
  testId: 'tests/e2e/canvas/tools.spec.ts:42',
  issue: '#123',
  owner: '@varve/maintainers',
  reason: 'tracked upstream browser defect',
  platforms: ['ubuntu-latest'],
  createdAt: '2026-08-01T00:00:00Z',
  expiresAt: '2026-09-30T00:00:00Z',
  signature: 'AssertionError: expected true to be false',
};
assert.deepEqual(validateKnownFailures([known], { now: new Date('2026-08-31T00:00:00Z') }), []);
assert.ok(
  validateKnownFailures([{ ...known, expiresAt: '2026-08-30T00:00:00Z' }], {
    now: new Date('2026-08-31T00:00:00Z'),
  }).some((error) => error.includes('expired')),
);
assert.ok(
  validateKnownFailures([{ ...known, signature: '' }]).some((error) => error.includes('signature')),
);

const cancelledJob = {
  id: 10,
  name: 'E2E (Playwright) 2/8',
  conclusion: 'cancelled',
  steps: [
    { name: 'Set up job', status: 'completed', conclusion: 'success' },
    { name: 'E2E (chromium)', status: 'completed', conclusion: 'cancelled' },
  ],
};
const ansiEscape = String.fromCharCode(27);
const credential = `ghp_${'C'.repeat(36)}`;
const signedUrlCredential = 'credential-canary-value';
const cancelledLog = [
  `2026-10-02T14:08:00Z ${ansiEscape}[31m##[error] 1) [chromium] › tests/e2e/canvas/crop.spec.ts:82:7 › F key cycles fit mode${ansiEscape}[0m`,
  `2026-10-02T14:08:00Z Error: expect(locator).toHaveText(expected) failed ${credential}`,
  'E2E\tTest\t2026-10-02T14:08:01Z at tests/e2e/helpers/crop.test.ts:12:4',
  `2026-10-02T14:08:01Z https://example.invalid/download?X-Amz-Signature=${signedUrlCredential}`,
  '2026-10-02T14:08:02Z ##[error]The operation was canceled.',
].join('\n');
const interrupted = buildFailureManifest({
  jobs: [cancelledJob],
  failuresBySource: { [cancelledJob.name]: cancelledLog },
  knownFailureIds: ['tests/e2e/canvas/crop.spec.ts:82'],
}).failures[0];
assert.equal(interrupted.conclusion, 'cancelled');
assert.equal(interrupted.jobConclusion, 'cancelled');
assert.equal(interrupted.terminationCategory, 'cancellation');
assert.equal(interrupted.category, 'product-or-test-regression');
assert.equal(interrupted.executedFailure.category, 'product-or-test-regression');
assert.deepEqual(interrupted.testIds, ['tests/e2e/canvas/crop.spec.ts:82']);
assert.match(interrupted.firstUsefulError, /^Error: expect\(/);
assert.equal(interrupted.retryWithoutCode, false);
assert.equal(interrupted.governedKnownFailure, false);
assert.match(
  interrupted.localReproductionCommand,
  /heavy-lease\.mjs.*crop\.spec\.ts:82.*--workers=1/,
);
for (const secret of [credential, signedUrlCredential, ansiEscape]) {
  assert.equal(JSON.stringify(interrupted).includes(secret), false);
}

for (const job of [cancelledJob, { ...cancelledJob, steps: [] }]) {
  const clean = buildFailureManifest({
    jobs: [job],
    failuresBySource: { [job.name]: '2026-10-02T14:08:02Z ##[error]The operation was canceled.' },
  }).failures[0];
  assert.equal(clean.category, 'cancellation');
  assert.equal(clean.executedFailure, null);
  assert.deepEqual(clean.testIds, []);
  assert.equal(clean.firstUsefulError, '');
  assert.equal(clean.retryWithoutCode, false);
}
const neverStarted = buildFailureManifest({
  jobs: [{ ...cancelledJob, steps: [] }],
  failuresBySource: { [cancelledJob.name]: cancelledLog },
}).failures[0];
assert.equal(neverStarted.executedFailure, null, 'unexecuted metadata cannot prove an assertion');
assert.deepEqual(neverStarted.testIds, []);
assert.equal(
  hasRecordedExecution({ steps: [{ status: 'completed', conclusion: 'skipped' }] }),
  false,
);
assert.equal(
  hasRecordedExecution({ steps: [{ status: 'completed', conclusion: 'cancelled' }] }),
  false,
);

const compiler = buildFailureManifest({
  jobs: [{ id: 11, name: 'Rust', conclusion: 'failure' }],
  failuresBySource: {
    Rust: 'error: redundant pattern\n --> crates/varve-print/src/lib.rs:1688:25\n = note: clippy::unneeded_wildcard_pattern',
  },
}).failures[0];
assert.equal(
  compiler.localReproductionCommand,
  'cargo clippy -p varve-print --all-targets -- -D warnings',
);
assert.equal(compiler.retryWithoutCode, false);
for (const name of ['Website E2E', 'Rust', 'E2E', 'JS']) {
  const unknown = buildFailureManifest({ jobs: [{ name, conclusion: 'failure' }] }).failures[0];
  assert.equal(
    unknown.localReproductionCommand,
    'pnpm verify:affected',
    'missing evidence never selects a broad suite',
  );
}

console.log('failure manifest tests passed');

// Real 0fc CI 37087003442 failed before browser/native lanes on two npm advisories.
const advisoryLog = readFileSync(
  new URL('./fixtures/dependency-advisory-vulnerable.txt', import.meta.url),
  'utf8',
);
const advisoryLine = advisoryLog.split('\n').find(isDependencyVulnerability);
assert.ok(advisoryLine);
assert.deepEqual(
  classifyFailure({
    stepName: 'Audit production npm and both Cargo dependency graphs',
    text: advisoryLog,
  }),
  { category: 'dependency-vulnerability', retryWithoutCode: false },
);
const advisoryManifest = buildFailureManifest({
  run: { id: 37087003442, name: 'CI', head_sha: '0fc9e2279bcb804b4757a33ec0b85d6cc34d5790' },
  jobs: [
    {
      id: 111099347546,
      name: 'Pipeline validation (workflow + SHA pins)',
      conclusion: 'failure',
      steps: [
        { name: 'Audit production npm and both Cargo dependency graphs', conclusion: 'failure' },
      ],
    },
  ],
  failuresBySource: { 'Pipeline validation (workflow + SHA pins)': advisoryLog },
});
assert.equal(advisoryManifest.failures[0].category, 'dependency-vulnerability');
assert.equal(advisoryManifest.failures[0].retryWithoutCode, false);
assert.match(
  advisoryManifest.failures[0].firstUsefulError,
  /"id":"npm-production".*"status":"vulnerable"/,
);
assert.equal(
  advisoryManifest.failures[0].localReproductionCommand,
  'node scripts/security/dependency-advisories.mjs',
);
assert.equal(
  isDependencyVulnerability(
    'Dependency advisory: {"id":"cargo-root","status":"pass","warnings":[{"kind":"unsound"}]}',
  ),
  false,
);
assert.equal(
  isDependencyVulnerability('Dependency advisory: {"id":"npm-production","status":"vulnerable"'),
  false,
);
assert.equal(
  isDependencyVulnerability('Dependency advisory: {"id":"unknown","status":"vulnerable"}'),
  false,
);
assert.equal(
  isDependencyVulnerability(
    'Dependency advisory: {"id":"cargo-root","status":"vulnerable","vulnerabilities":1}',
  ),
  true,
);
assert.deepEqual(
  classifyFailure({
    stepName: 'Audit production npm and both Cargo dependency graphs',
    text: 'Process completed with exit code 1.',
  }),
  { category: 'unknown-requires-triage', retryWithoutCode: false },
);
assert.equal(
  classifyFailure({ stepName: 'Install pinned advisory scanner', text: 'download failed with 403' })
    .retryWithoutCode,
  true,
);
assert.equal(
  classifyFailure({ conclusion: 'cancelled', text: advisoryLog }).category,
  'dependency-vulnerability',
);
assert.equal(
  classifyFailure({ conclusion: 'cancelled', text: advisoryLog }).retryWithoutCode,
  false,
);
