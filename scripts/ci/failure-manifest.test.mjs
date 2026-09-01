#!/usr/bin/env node

/** Failure classification, known-debt governance, and manifest shape tests. */

import assert from 'node:assert/strict';
import {
  buildFailureManifest,
  classifyFailure,
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

console.log('failure manifest tests passed');
