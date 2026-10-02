#!/usr/bin/env node

/** Regression tests for exact-source CI execution receipts. */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  browserEvidenceErrors,
  checkedOutIdentity,
  collectBrowserEvidence,
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

// Browser receipts use actual case counts/history rather than trusting exit 0.
const browserDirectory = mkdtempSync(join(tmpdir(), 'varve-ci-browser-report-'));
const browserJson = {
  config: {
    workers: 1,
    updateSnapshots: 'none',
    failOnFlakyTests: true,
    argv: ['--trace=retain-on-failure'],
    projects: [{ name: 'chromium', retries: 0 }],
  },
  errors: [],
  stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
  suites: [
    {
      title: 'fixture.spec.ts',
      file: 'fixture.spec.ts',
      specs: [
        {
          id: 'playwright-source-id',
          file: 'fixture.spec.ts',
          title: 'keeps failure evidence',
          line: 7,
          tests: [
            {
              projectName: 'chromium',
              expectedStatus: 'passed',
              status: 'expected',
              results: [
                {
                  status: 'passed',
                  retry: 0,
                  duration: 10,
                  errors: [],
                  startTime: '2026-10-02T00:00:00Z',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
try {
  const path = join(browserDirectory, 'browser.json');
  const evaluate = (json = browserJson) => {
    writeFileSync(path, JSON.stringify(json));
    const evidence = collectBrowserEvidence([{ lane: 'e2e:all', path }]);
    return { evidence, errors: browserEvidenceErrors(evidence, ['e2e:all']) };
  };
  const passed = evaluate();
  assert.deepEqual(passed.errors, []);
  assert.equal(passed.evidence.reports[0].cases[0].attempts[0].retry, 0);
  const moved = structuredClone(browserJson);
  moved.suites[0].specs[0].line = 100;
  moved.suites[0].specs[0].id = 'different-source-id';
  assert.equal(
    evaluate(moved).evidence.reports[0].cases[0].caseId,
    passed.evidence.reports[0].cases[0].caseId,
    'line movement must retain comparable case identity',
  );
  for (const mutate of [
    (json) => {
      json.stats.flaky = 1;
      json.stats.expected = 0;
      json.suites[0].specs[0].tests[0].status = 'flaky';
    },
    (json) => {
      json.stats.unexpected = 1;
      json.stats.expected = 0;
      json.suites[0].specs[0].tests[0].status = 'unexpected';
    },
    (json) => {
      json.config.projects[0].retries = 1;
    },
    (json) => {
      json.config.workers = 2;
    },
    (json) => {
      json.config.updateSnapshots = 'all';
    },
    (json) => {
      json.config.failOnFlakyTests = false;
    },
    (json) => {
      json.config.argv = [];
    },
    (json) => {
      json.suites[0].specs[0].tests[0].results[0].retry = 1;
    },
    (json) => {
      json.stats.expected = 2;
    },
    (json) => {
      json.stats.expected = '1';
    },
    (json) => {
      json.errors.push({ message: 'runner failed' });
    },
    (json) => {
      json.suites[0].specs[0].tests[0].results = [];
    },
    (json) => {
      json.suites[0].specs[0].tests[0].results[0].status = 'failed';
    },
  ]) {
    const bad = structuredClone(browserJson);
    mutate(bad);
    const evidence = evaluate(bad).evidence;
    assert.ok(browserEvidenceErrors(evidence, ['e2e:all']).length);
    const rejected = createExecutionReport({
      category: 'e2e',
      status: 'success',
      declaredLanes: ['e2e:all'],
      browserEvidence: evidence,
    });
    assert.equal(
      rejected.status,
      'failure',
      'exit 0 cannot certify malformed/flaky/retried/policy-drift browser evidence',
    );
    assert.deepEqual(rejected.executedLanes, []);
  }
  for (const cases of [undefined, null, [null]]) {
    const malformed = { ...passed.evidence, reports: [{ ...passed.evidence.reports[0], cases }] };
    assert.ok(
      browserEvidenceErrors(malformed, ['e2e:all']).length,
      'malformed histories retain failure evidence without throwing',
    );
  }
  for (const mutate of [
    (report) => {
      report.runner.projects = [null];
    },
    (report) => {
      report.cases[0].attempts = [null];
    },
  ]) {
    const malformed = structuredClone(passed.evidence);
    mutate(malformed.reports[0]);
    assert.ok(browserEvidenceErrors(malformed, ['e2e:all']).length);
  }
  assert.ok(browserEvidenceErrors({ schema: 1, errors: [], reports: [null] }, ['e2e:all']).length);
  const skipped = structuredClone(browserJson);
  skipped.stats.expected = 0;
  skipped.stats.skipped = 1;
  skipped.suites[0].specs[0].tests[0].status = 'skipped';
  skipped.suites[0].specs[0].tests[0].results = [];
  assert.deepEqual(evaluate(skipped).errors, [], 'explicit supported GPU skips remain data');
  const empty = structuredClone(browserJson);
  empty.stats.expected = 0;
  empty.suites = [];
  assert.ok(
    evaluate(empty).errors.length,
    'an empty successful report cannot certify a browser lane',
  );
  writeFileSync(path, '{malformed');
  assert.ok(
    browserEvidenceErrors(collectBrowserEvidence([{ lane: 'e2e:all', path }]), ['e2e:all']).length,
  );
  assert.ok(
    browserEvidenceErrors(
      collectBrowserEvidence([{ lane: 'e2e:all', path: join(browserDirectory, 'missing.json') }]),
      ['e2e:all'],
    ).length,
  );
  assert.ok(browserEvidenceErrors(null, ['e2e:all']).length);
  const cancelled = createExecutionReport({
    category: 'e2e',
    status: 'cancelled',
    declaredLanes: ['e2e:all'],
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(cancelled.executedLanes, []);
  assert.ok(cancelled.playwright.errors.length);
} finally {
  rmSync(browserDirectory, { recursive: true, force: true });
}
console.log('browser execution report guards passed');
