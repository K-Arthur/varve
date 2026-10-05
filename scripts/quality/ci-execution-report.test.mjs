#!/usr/bin/env node

/** Regression tests for exact-source CI execution receipts. */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrowserInventory } from './browser-inventory.mjs';
import {
  browserEvidenceErrors,
  browserReviewReportErrors,
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
const cleanIdentity = { ...identity, clean: true, dirtyPathCount: 0, dirtyPaths: [] };
const plan = {
  profile: 'integration',
  commitSha: identity.commitSha,
  treeSha: identity.treeSha,
  planHash: 'a'.repeat(64),
  policyHash: 'b'.repeat(64),
};
const report = createExecutionReport({
  readSource: () => cleanIdentity,
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
assert.equal(report.source.dirtyPathCount, 0);
assert.deepEqual(report.source.dirtyPaths, []);
assert.deepEqual(report.executedLanes, ['typecheck:all']);
assert.equal(report.laneOutcomes[1].status, 'failure');
const dirtyReport = createExecutionReport({
  plan,
  category: 'js',
  declaredLanes: ['typecheck:all'],
  readSource: () => ({
    ...identity,
    clean: false,
    dirtyPathCount: 2,
    dirtyPaths: ['tests/e2e/fixtures/captured.png', 'reports/local-run.json'],
  }),
});
assert.equal(dirtyReport.status, 'failure', 'a dirty checkout cannot certify committed source');
assert.equal(dirtyReport.source.clean, false);
assert.equal(dirtyReport.source.dirtyPathCount, 2);
assert.deepEqual(dirtyReport.source.dirtyPaths, [
  'tests/e2e/fixtures/captured.png',
  'reports/local-run.json',
]);
assert.deepEqual(dirtyReport.executedLanes, []);

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
  const inventory = createBrowserInventory(browserJson, {
    lane: 'e2e:all',
    argv: ['pnpm', 'exec', 'playwright', 'test', '--project=chromium'],
    source: plan,
  });
  const evaluate = (json = browserJson) => {
    writeFileSync(path, JSON.stringify(json));
    const evidence = collectBrowserEvidence([{ lane: 'e2e:all', path, inventory }]);
    return { evidence, errors: browserEvidenceErrors(evidence, ['e2e:all']) };
  };
  const passed = evaluate();
  assert.deepEqual(passed.errors, []);
  assert.equal(passed.evidence.reports[0].cases[0].attempts[0].retry, 0);
  const demoSource = { ...plan, planHash: 'f'.repeat(64) };
  const demoInventory = createBrowserInventory(browserJson, {
    lane: 'e2e:demo-dist',
    argv: ['pnpm', 'exec', 'playwright', 'test', '--config', 'playwright.demo-dist.config.mts'],
    source: demoSource,
  });
  const demoEvidence = collectBrowserEvidence(
    [{ lane: 'e2e:demo-dist', path, inventory: demoInventory, executionShard: '1/16' }],
    { root: browserDirectory },
  );
  const demoReceipt = createExecutionReport({
    plan,
    category: 'e2e',
    status: 'success',
    declaredLanes: ['e2e:demo-dist'],
    browserEvidence: demoEvidence,
    shard: '1/16',
    readSource: () => ({ ...identity, clean: true }),
  });
  assert.equal(demoReceipt.status, 'success');
  assert.equal(demoReceipt.playwright.reports[0].shard, null);
  assert.equal(demoReceipt.playwright.reports[0].executionShard, '1/16');
  assert.deepEqual(
    createExecutionReport({
      plan,
      category: 'e2e',
      status: 'success',
      declaredLanes: ['e2e:demo-dist'],
      browserEvidence: collectBrowserEvidence(
        [{ lane: 'e2e:demo-dist', path, inventory: demoInventory }],
        {
          root: browserDirectory,
        },
      ),
      shard: '1/16',
      readSource: () => ({ ...identity, clean: true }),
    }).executedLanes,
    [],
    'a complete unsharded report cannot be attached to a different shard without an explicit execution-cell binding',
  );
  const review = collectBrowserEvidence([{ lane: 'e2e:all', path }], { reviewOnly: true });
  assert.deepEqual(review.errors, []);
  assert.equal(review.reviewOnly, true);
  assert.equal(review.certified, false);
  assert.equal(review.reports[0].reviewOnly, true);
  assert.equal(review.reports[0].certified, false);
  assert.ok(browserEvidenceErrors(review, ['e2e:all']).length);
  assert.ok(browserReviewReportErrors(passed.evidence.reports[0]).length);
  const reviewWithInventory = collectBrowserEvidence([{ lane: 'e2e:all', path, inventory }], {
    reviewOnly: true,
  });
  assert.deepEqual(reviewWithInventory.errors, []);
  for (const evidence of [
    reviewWithInventory,
    { ...reviewWithInventory, reviewOnly: undefined, certified: undefined },
    { ...reviewWithInventory, reports: passed.evidence.reports },
  ]) {
    const rejected = createExecutionReport({
      plan,
      category: 'e2e',
      status: 'success',
      declaredLanes: ['e2e:all'],
      browserEvidence: evidence,
      readSource: () => ({ ...identity, clean: true }),
    });
    assert.equal(rejected.status, 'failure', 'review-only evidence cannot certify a lane');
    assert.deepEqual(rejected.executedLanes, []);
    assert.ok(rejected.playwright.errors.some((error) => error.includes('review-only')));
  }
  const changedReview = structuredClone(browserJson);
  changedReview.config.updateSnapshots = 'changed';
  writeFileSync(path, JSON.stringify(changedReview));
  assert.deepEqual(
    collectBrowserEvidence([{ lane: 'e2e:all', path }], { reviewOnly: true }).errors,
    [],
    'explicit baseline updates retain actual snapshot mode in non-certifying review evidence',
  );
  assert.ok(collectBrowserEvidence([{ lane: 'e2e:all', path, inventory }]).errors.length);
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
    assert.ok(
      collectBrowserEvidence([{ lane: 'e2e:all', path }], { reviewOnly: true }).errors.length,
      'baseline review keeps ordinary runner/history/retry/policy failures',
    );
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
  assert.ok(
    evaluate(skipped).errors.length,
    'all-skipped coverage and unexplained fixture skips cannot certify a lane',
  );
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
