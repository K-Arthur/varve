#!/usr/bin/env node
/**
 * Unit tests for the failure extraction logic in ci-debug.mjs.
 *
 * Run: node scripts/ci-debug.test.mjs
 */
import assert from 'node:assert';
import { extractFailures, isFailureLine, rankLine } from './ci-debug.mjs';

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
assertTrue(isFailureLine('npm ERR! code ENOENT'), 'should detect npm error');
assertTrue(isFailureLine('pnpm ERR_123 some error'), 'should detect pnpm error');
assertTrue(
  isFailureLine('AssertionError: expected true to be false'),
  'should detect AssertionError',
);
assertTrue(isFailureLine('test failed: foo'), 'should detect test failed');

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

console.log('ci-debug extraction tests passed.');
