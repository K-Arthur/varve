#!/usr/bin/env node
/**
 * Unit tests for ci-health.mjs failure classification.
 *
 * Run: node scripts/ci-health.test.mjs
 */
import assert from 'node:assert';
import { classifyJobFailure, classifyRun, isStuckQueued } from './ci-health.mjs';

const BILLING_ANNOTATIONS = [
  {
    annotation_level: 'failure',
    message:
      'The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the Billing & plans section in your settings',
  },
];

const RUNNER_UNAVAILABLE_ANNOTATIONS = [
  {
    annotation_level: 'failure',
    message: 'The job was not acquired by Runner of type hosted even after multiple attempts',
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

// runner-unavailable: zero-step failed job + "not acquired" annotation
assert.strictEqual(
  classifyJobFailure({ conclusion: 'failure', steps: [] }, RUNNER_UNAVAILABLE_ANNOTATIONS),
  'runner-unavailable',
  'zero-step failed job + "not acquired by Runner" annotation => runner-unavailable',
);

// GitHub records never-started jobs as `cancelled` with zero steps — the
// annotation discriminates infra cancellation from user cancellation.
assert.strictEqual(
  classifyJobFailure({ conclusion: 'cancelled', steps: [] }, RUNNER_UNAVAILABLE_ANNOTATIONS),
  'runner-unavailable',
  'zero-step cancelled job + runner annotation => runner-unavailable',
);
assert.strictEqual(
  classifyJobFailure({ conclusion: 'cancelled', steps: [] }, BILLING_ANNOTATIONS),
  'billing-block',
  'zero-step cancelled job + billing annotation => billing-block',
);
assert.strictEqual(
  classifyJobFailure({ conclusion: 'cancelled', steps: [] }, []),
  null,
  'user/concurrency cancellation without annotation stays unclassified',
);

// stuck-queued: job accepted by GitHub but still queued past the threshold
const nowMs = Date.parse('2026-08-06T19:00:00Z');
const stuckJob = {
  conclusion: null,
  status: 'queued',
  started_at: '2026-08-06T18:00:00Z', // 60 min ago
  steps: [],
};
assert.strictEqual(
  classifyJobFailure(stuckJob, [], nowMs),
  'stuck-queued',
  'queued > 30 min without conclusion => stuck-queued',
);
assert.strictEqual(
  classifyJobFailure(
    { conclusion: null, status: 'queued', started_at: '2026-08-06T18:59:00Z', steps: [] },
    [],
    nowMs,
  ),
  null,
  'queued < 30 min is not yet stuck',
);
assert.strictEqual(
  classifyJobFailure(
    { conclusion: null, status: 'in_progress', started_at: '2026-08-06T18:00:00Z', steps: [] },
    [],
    nowMs,
  ),
  null,
  'in_progress jobs are never stuck',
);
assertTrue(
  isStuckQueued({ status: 'queued', started_at: '2026-08-06T18:00:00Z' }, nowMs),
  'isStuckQueued true for old queued run',
);
assertTrue(
  isStuckQueued({ status: 'queued', run_started_at: '2026-08-06T18:00:00Z' }, nowMs),
  'isStuckQueued accepts workflow run timestamps',
);
assertTrue(
  !isStuckQueued({ status: 'queued', started_at: '2026-08-06T18:59:00Z' }, nowMs),
  'isStuckQueued false for recent queued run',
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

// Run stuck at run level (no jobs, no conclusion, queued past threshold).
const stuckRun = classifyRun([], new Map(), {
  status: 'queued',
  started_at: '2026-08-06T18:00:00Z',
});
assert.strictEqual(stuckRun.stuckQueued, true, 'queued run past threshold is stuck');
assert.strictEqual(
  stuckRun.infraBlocks[0].kind,
  'stuck-queued',
  'run-level stuck block attributed with kind stuck-queued',
);

// Runner-unavailable job aggregates into infra blocks (not real failures).
const runnerRun = classifyRun(
  [
    {
      id: 6,
      name: 'Build WASM engine',
      conclusion: 'failure',
      steps: [],
    },
  ],
  new Map([[6, RUNNER_UNAVAILABLE_ANNOTATIONS]]),
);
assert.strictEqual(runnerRun.infraBlocks.length, 1, 'runner-unavailable job counted as infra');
assert.strictEqual(
  runnerRun.infraBlocks[0].kind,
  'runner-unavailable',
  'kind is runner-unavailable',
);
assert.deepStrictEqual(runnerRun.realFailures, [], 'runner-unavailable is not a real failure');

// Job-level stuck-queued detected inside classifyRun.
const stuckJobRun = classifyRun(
  [{ id: 7, name: 'E2E', status: 'queued', started_at: '2026-08-06T18:00:00Z', steps: [] }],
  new Map(),
  {},
);
assert.strictEqual(
  stuckJobRun.infraBlocks.some((b) => b.kind === 'stuck-queued'),
  true,
  'stuck job inside a run surfaced as infra block',
);

console.log('ci-health classification tests passed.');
