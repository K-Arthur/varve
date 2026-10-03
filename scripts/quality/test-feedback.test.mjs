import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTestFeedback, feedbackMarkdown } from './test-feedback.mjs';

const caseId = 'a'.repeat(64);
function receipt({
  attempt = 1,
  status = 'expected',
  duration = 100,
  runId = '10',
  sha = 'b'.repeat(40),
  caseIdentity = caseId,
} = {}) {
  return {
    schema: 1,
    profile: 'integration',
    category: 'e2e',
    matrix: 'ubuntu-latest',
    shard: '1/8',
    status: status === 'expected' ? 'success' : 'failure',
    durationMs: duration + 50,
    source: { commitSha: sha, treeSha: 'c'.repeat(40), policyHash: 'd'.repeat(64) },
    workflow: { repository: 'example/varve', runId, runAttempt: String(attempt) },
    runner: { os: 'Linux', arch: 'X64' },
    playwright: {
      reports: [
        {
          cases: [
            {
              caseId: caseIdentity,
              file: 'canvas.spec.ts',
              project: 'chromium',
              status,
              attempts: [{ retry: 0, durationMs: duration }],
            },
          ],
        },
      ],
    },
  };
}

test('uses latest failed-job attempt for timing and preserves divergent outcomes as investigation evidence', () => {
  const report = buildTestFeedback([
    receipt({ status: 'unexpected', duration: 300 }),
    receipt({ attempt: 2, duration: 100 }),
  ]);
  assert.equal(report.certifying, false);
  assert.equal(report.selectedCellCount, 1);
  assert.equal(report.caseDurationMs.total, 100);
  assert.equal(report.cells[0].attempt, 2);
  assert.equal(report.divergentOutcomeCount, 1);
  assert.equal(
    report.divergentOutcomes[0].classification,
    'needs-runtime-environment-investigation',
  );
});

test('does not infer a flake from different source or profile identity', () => {
  const other = receipt({ status: 'unexpected', sha: 'e'.repeat(40), runId: '11' });
  const candidate = receipt({ status: 'unexpected', runId: '12' });
  candidate.profile = 'candidate';
  const report = buildTestFeedback([receipt(), other, candidate]);
  assert.equal(report.divergentOutcomeCount, 0);
  assert.equal(report.selectedCellCount, 3);
});

test('duplicate latest receipts do not double count timing or arbitrarily pick a pass', () => {
  const report = buildTestFeedback([receipt(), receipt({ status: 'unexpected' })]);
  assert.equal(report.conflictingCells, 1);
  assert.equal(report.selectedCellCount, 0);
  assert.equal(report.caseSamples, 0);
});

test('a duplicate superseded attempt cannot hide a unique current attempt', () => {
  const report = buildTestFeedback([receipt(), receipt(), receipt({ attempt: 2 })]);
  assert.equal(report.conflictingCells, 0);
  assert.equal(report.selectedCellCount, 1);
});

test('retains cancelled and all-skipped cells without turning diagnostics into certification', () => {
  const skipped = receipt({ status: 'skipped', duration: 0 });
  skipped.status = 'cancelled';
  skipped.durationMs = null;
  const report = buildTestFeedback([skipped]);
  assert.equal(report.cells[0].status, 'cancelled');
  assert.equal(report.cells[0].skipped, 1);
  assert.equal(report.cells[0].measuredLaneMs, null);
  assert.equal(report.caseDurationMs.p95, null);
  assert.equal(report.certifying, false);
});

test('bounded percentiles and slow cases describe actual measured sample durations', () => {
  const receipts = [10, 20, 1000].map((duration, index) =>
    receipt({ duration, runId: String(index + 1), caseIdentity: String(index).repeat(64) }),
  );
  const report = buildTestFeedback(receipts, { limit: 1 });
  assert.equal(report.caseDurationMs.p50, 20);
  assert.equal(report.caseDurationMs.p95, 1000);
  assert.equal(report.slowestCases.length, 1);
  assert.equal(report.slowestCases[0].durationMs, 1000);
});

test('malformed identity and negative durations remain explicit missing diagnostics', () => {
  const report = buildTestFeedback([{}, receipt({ duration: -1 }), receipt()]);
  assert.equal(report.invalidReceipts, 1);
  assert.equal(report.invalidCases, 1);
  assert.throws(() => buildTestFeedback([], { limit: 0 }), /limit/);
});

test('reports incomplete and imbalanced shards without presenting partial coverage as complete', () => {
  const first = receipt({ duration: 100 });
  const second = receipt({ duration: 500 });
  second.shard = '2/8';
  const report = buildTestFeedback([first, second]);
  assert.equal(report.shardBalance[0].complete, false);
  assert.equal(report.shardBalance[0].maxToMinRatio, 5);
  assert.match(feedbackMarkdown(report), /2\/8 \| false \| 5\.00/);
});

test('malformed browser arrays are recorded instead of crashing the feedback report', () => {
  const invalid = receipt();
  invalid.playwright.reports = {};
  assert.equal(buildTestFeedback([invalid]).invalidCases, 1);
});
