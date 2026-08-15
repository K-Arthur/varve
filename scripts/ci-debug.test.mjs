#!/usr/bin/env node
/**
 * Unit tests for the failure extraction logic in ci-debug.mjs.
 *
 * Run: node scripts/ci-debug.test.mjs
 */
import assert from 'node:assert';
import {
  classifyJobFailure,
  classifyRunFailures,
  extractFailures,
  hasFailureSourceForJob,
  isFailureLine,
  isStuckQueued,
  normalizeLogSource,
  rankLine,
  redactSensitive,
} from './ci-debug.mjs';

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Positive matches
assertTrue(isFailureLine('Error: something broke'), 'should detect plain Error');
assertTrue(isFailureLine('  ERROR: missing file'), 'should detect uppercase ERROR');
assertTrue(
  isFailureLine('cargo test failed with exit code 101'),
  'should detect failed with exit code',
);
assertTrue(isFailureLine('thread panicked at src/main.rs:10'), 'should detect panic');
assertTrue(isFailureLine('Caused by: network timeout'), 'should detect Caused by');
assertTrue(
  isFailureLine('::error::Compilation failed'),
  'should detect GitHub Actions error annotation',
);
assertTrue(
  isFailureLine('##[error]Unable to resolve action `actions/checkout@abc`'),
  'should detect legacy ##[error] annotation',
);
assertTrue(
  isFailureLine('Unable to resolve action `actions/checkout@xxx`, unable to find version `xxx`'),
  'should detect unresolvable action refs',
);
assertTrue(isFailureLine('npm ERR! code ENOENT'), 'should detect npm error');
assertTrue(isFailureLine('pnpm ERR_123 some error'), 'should detect pnpm error');
assertTrue(
  isFailureLine('AssertionError: expected true to be false'),
  'should detect AssertionError',
);
assertTrue(isFailureLine('test failed: foo'), 'should detect test failed');
assertTrue(
  isFailureLine('Traceback (most recent call last):'),
  'should detect Python traceback failures',
);
assertTrue(isFailureLine('fatal error: vector.hpp not found'), 'should detect C/C++ fatal errors');
assertTrue(
  isFailureLine('ninja: build stopped: subcommand failed'),
  'should detect Ninja build failures',
);

// Negative matches
assertTrue(!isFailureLine('  + exit 0'), 'should ignore exit 0');
assertTrue(!isFailureLine('git status clean'), 'should ignore clean status');
assertTrue(!isFailureLine(''), 'should ignore empty line');
assertTrue(!isFailureLine('Everything is fine'), 'should ignore plain text');

// Rank priority: generic error (index 1) outranks panic (index 5)
assertTrue(
  rankLine('error: foo') < rankLine('panicked at foo'),
  'error should rank higher than panic',
);

// extractFailures with context
const log = [
  'normal line',
  'another normal line',
  'Error: expected value, got null',
  'at some_function (file.ts:42)',
  'final line',
].join('\n');

const hits = extractFailures(log, 1);
assert.strictEqual(hits.length, 1, 'should find one failure');
assert.strictEqual(hits[0].line, 3, 'failure line should be 3');
assertTrue(
  hits[0].snippet.includes('another normal line'),
  'context should include preceding line',
);
assertTrue(
  hits[0].snippet.includes('Error: expected value'),
  'snippet should include failing line',
);
assertTrue(hits[0].snippet.includes('at some_function'), 'context should include following line');

// GitHub prefixes run-archive job filenames with a numeric index. The report
// must recognise that indexed filename as the same job before adding a false
// "no log text" fallback entry.
assert.strictEqual(
  normalizeLogSource('0_Build (windows-latest).txt'),
  normalizeLogSource('Build (windows-latest)'),
  'indexed archive filename normalises to the job name',
);
assertTrue(
  hasFailureSourceForJob(
    { '0_Build (windows-latest)': [{ line: 42, rank: 1, text: 'Error: boom', snippet: '' }] },
    'Build (windows-latest)',
  ),
  'indexed archive failure source matches job metadata',
);
assertTrue(
  !hasFailureSourceForJob({ '0_Rust (ubuntu-latest)': [] }, 'Build (windows-latest)'),
  'different job names do not match',
);

// Job classification: billing-blocked jobs never start and have zero steps.
const billingAnnotations = [
  {
    annotation_level: 'failure',
    message:
      'The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the Billing & plans section in your settings',
  },
];
assert.strictEqual(
  classifyJobFailure({ conclusion: 'failure', steps: [] }, billingAnnotations),
  'billing-block',
  'zero-step failed job with billing annotation is a billing block',
);
assert.strictEqual(
  classifyJobFailure({ conclusion: 'failure', steps: [] }, []),
  'never-started',
  'zero-step failed job without annotation is never-started',
);
assert.strictEqual(
  classifyJobFailure(
    { conclusion: 'failure', steps: [{ name: 'cargo clippy', conclusion: 'failure' }] },
    billingAnnotations,
  ),
  'real-failure',
  'failed job with steps is a real failure even with billing annotations',
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

// Runner-unavailable: GitHub never assigned a hosted runner.
const runnerUnavailableAnnotations = [
  {
    annotation_level: 'failure',
    message: 'The job was not acquired by Runner of type hosted even after multiple attempts',
  },
];
assert.strictEqual(
  classifyJobFailure({ conclusion: 'failure', steps: [] }, runnerUnavailableAnnotations),
  'runner-unavailable',
  'zero-step failed job with "not acquired" annotation is runner-unavailable',
);

// Stuck-queued: job accepted but never scheduled past the threshold.
const NOW = Date.parse('2026-08-06T19:00:00Z');
assert.strictEqual(
  classifyJobFailure(
    { conclusion: null, status: 'queued', started_at: '2026-08-06T18:00:00Z', steps: [] },
    [],
    NOW,
  ),
  'stuck-queued',
  'queued > 30 min is stuck-queued',
);
assert.strictEqual(
  classifyJobFailure(
    { conclusion: null, status: 'queued', started_at: '2026-08-06T18:59:00Z', steps: [] },
    [],
    NOW,
  ),
  null,
  'queued < 30 min is not yet stuck',
);
assertTrue(
  isStuckQueued({ status: 'queued', started_at: '2026-08-06T18:00:00Z' }, NOW),
  'isStuckQueued true for old queued run',
);
assertTrue(
  isStuckQueued({ status: 'queued', run_started_at: '2026-08-06T18:00:00Z' }, NOW),
  'isStuckQueued accepts GitHub workflow run timestamps',
);

// classifyRunFailures: probe-mode aggregation.
const probeJobs = [
  { id: 1, name: 'Rust (ubuntu-latest)', conclusion: 'failure', steps: [{ name: 'cargo test' }] },
  {
    id: 2,
    name: 'Build WASM engine',
    conclusion: 'failure',
    steps: [],
  },
  { id: 3, name: 'E2E', status: 'queued', started_at: '2026-08-06T18:00:00Z', steps: [] },
];
const probeAnnotations = new Map([
  [2, runnerUnavailableAnnotations],
  [3, []],
]);
const probed = classifyRunFailures(probeJobs, probeAnnotations);
assert.deepStrictEqual(probed.real, ['Rust (ubuntu-latest)'], 'probe surfaces real failure names');
assert.strictEqual(probed.infra.length, 2, 'probe counts infra blocks');
assertTrue(
  probed.infra.some((b) => b.kind === 'runner-unavailable'),
  'probe attributes runner-unavailable',
);
assertTrue(
  probed.infra.some((b) => b.kind === 'stuck-queued'),
  'probe attributes stuck-queued',
);

const infraOnly = classifyRunFailures(
  [
    {
      id: 4,
      name: 'Manifest verification',
      conclusion: 'failure',
      steps: [],
    },
  ],
  new Map([[4, runnerUnavailableAnnotations]]),
);
assert.deepStrictEqual(infraOnly.real, [], 'infra-only run has no real failures');
assert.strictEqual(infraOnly.infra.length, 1, 'infra-only run keeps the block');

// Redaction canaries: credential-shaped strings in failing logs must never
// reach the report. Values are runtime-constructed so no live-format token
// is committed to source.
const canaryPat = `ghp_${'A'.repeat(36)}`;
const canaryEnv = `APPLE_API_KEY_P8_BASE64=${'B'.repeat(48)}`;
assert.ok(
  !redactSensitive(canaryPat).includes('A'.repeat(36)),
  'GitHub PAT payload must be redacted',
);
assert.ok(
  !redactSensitive(canaryEnv).includes('B'.repeat(48)),
  'signing env values must be redacted',
);
const redactedHits = extractFailures(
  `Error: build failed
secret=${canaryPat}
`,
  1,
);
assert.ok(
  !redactedHits[0].text.includes('A'.repeat(36)),
  'hit text must not contain the canary token payload',
);
assert.ok(
  !redactedHits[0].snippet.includes('A'.repeat(36)),
  'hit snippet must not contain the canary token payload',
);

console.log('ci-debug extraction tests passed.');
