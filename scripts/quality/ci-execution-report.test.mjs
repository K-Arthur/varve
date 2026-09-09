#!/usr/bin/env node

/** Regression tests for exact-source CI execution receipts. */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkedOutIdentity,
  createExecutionReport,
  normalizeExecutionStatus,
  parseList,
  writeExecutionReport,
} from './ci-execution-report.mjs';

assert.deepEqual(parseList('one,two\nthree'), ['one', 'two', 'three']);
assert.equal(normalizeExecutionStatus('cancelled'), 'cancelled');
assert.equal(normalizeExecutionStatus('timed_out'), 'failure');

const identity = checkedOutIdentity();
const plan = {
  profile: 'integration',
  commitSha: identity.commitSha,
  treeSha: identity.treeSha,
  planHash: 'a'.repeat(64),
  policyHash: 'b'.repeat(64),
};
const report = createExecutionReport({
  plan,
  category: 'js',
  matrix: 'ubuntu-latest',
  laneOutcomes: [
    {
      lane: 'typecheck:all',
      argv: ['pnpm', 'typecheck'],
      status: 'success',
      exitCode: 0,
      durationMs: 12,
    },
    {
      lane: 'lint:all',
      argv: ['pnpm', 'lint'],
      status: 'failure',
      exitCode: 1,
      durationMs: 8,
    },
  ],
});
assert.equal(report.source.commitSha, identity.commitSha);
assert.equal(report.source.treeSha, identity.treeSha);
assert.deepEqual(report.executedLanes, ['typecheck:all']);
assert.equal(report.laneOutcomes[1].status, 'failure');

const directory = mkdtempSync(join(tmpdir(), 'varve-ci-execution-report-'));
try {
  const path = join(directory, 'nested', 'report.json');
  writeExecutionReport(report, path);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), report);
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log('ci execution report tests passed');
