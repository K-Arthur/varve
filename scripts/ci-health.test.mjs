#!/usr/bin/env node
/**
 * Unit tests for ci-health.mjs failure classification.
 *
 * Run: node scripts/ci-health.test.mjs
 */
import assert from 'node:assert';
import { classifyJobFailure, classifyRun } from './ci-health.mjs';

const BILLING_ANNOTATIONS = [
  {
    annotation_level: 'failure',
    message:
      'The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the Billing & plans section in your settings',
  },
];

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

// classifyJobFailure
assert.strictEqual(
  classifyJobFailure({ conclusion: 'failure', steps: [] }, BILLING_ANNOTATIONS),
  'billing-block',
  'zero-step failed job + billing annotation => billing-block',
);
assert.strictEqual(
  classifyJobFailure({ conclusion: 'failure', steps: [] }, []),
  'never-started',
  'zero-step failed job, no annotation => never-started',
);
assert.strictEqual(
  classifyJobFailure(
    { conclusion: 'failure', steps: [{ name: 'pnpm test', conclusion: 'failure' }] },
    BILLING_ANNOTATIONS,
  ),
  'real-failure',
  'failed job with steps is real-failure even with billing annotations present',
);
assert.strictEqual(
  classifyJobFailure({ conclusion: 'timed_out', steps: [{ name: 'e2e' }] }, []),
  'real-failure',
  'timed-out job with steps is real-failure',
);
assert.strictEqual(
  classifyJobFailure({ conclusion: 'success', steps: [] }, []),
  null,
  'successful jobs are not classified',
);
assert.strictEqual(
  classifyJobFailure({ conclusion: 'skipped', steps: [] }, []),
  null,
  'skipped jobs are not classified',
);

// classifyRun aggregates jobs into infra blocks + real failures.
const annotations = new Map([
  [1, BILLING_ANNOTATIONS],
  [2, []],
  [3, []],
]);

const jobs = [
  { id: 1, name: 'JS (pnpm)', conclusion: 'failure', steps: [] },
  { id: 2, name: 'Rust (ubuntu-latest)', conclusion: 'failure', steps: [] },
  {
    id: 3,
    name: 'Rust (macos-latest)',
    conclusion: 'failure',
    steps: [{ name: 'cargo clippy', conclusion: 'failure' }],
  },
  { id: 4, name: 'E2E (Playwright)', conclusion: 'skipped', steps: [] },
];

const classified = classifyRun(jobs, annotations);
assert.strictEqual(
  classified.billingBlocked,
  true,
  'run with billing annotation is billing-blocked',
);
assert.strictEqual(classified.infraBlocks.length, 2, 'two infra blocks expected');
assertTrue(
  classified.infraBlocks.some((b) => b.kind === 'billing-block' && b.jobName === 'JS (pnpm)'),
  'billing block attributed to the right job',
);
assertTrue(
  classified.infraBlocks.some(
    (b) => b.kind === 'never-started' && b.jobName === 'Rust (ubuntu-latest)',
  ),
  'never-started attributed to the right job',
);
assert.deepStrictEqual(
  classified.realFailures,
  ['Rust (macos-latest)'],
  'real failure surfaced by name',
);
assertTrue(
  classified.infraBlocks[0].message.includes('recent account payments'),
  'billing message preserved for remediation',
);

// Healthy run: no failed jobs at all.
const healthy = classifyRun(
  [{ id: 5, name: 'JS (pnpm)', conclusion: 'success', steps: [] }],
  new Map(),
);
assert.strictEqual(healthy.billingBlocked, false, 'healthy run is not billing-blocked');
assert.strictEqual(healthy.infraBlocks.length, 0, 'healthy run has no infra blocks');
assert.deepStrictEqual(healthy.realFailures, [], 'healthy run has no real failures');

console.log('ci-health classification tests passed.');
