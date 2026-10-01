import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bootstrapMedianInterval,
  decideQualification,
  pairedP95,
  qualificationWorkload,
} from './qualificationAnalysis.mjs';

function run(p95, overrides = {}) {
  return {
    status: 'ok',
    validity: 'valid',
    rendererModeVerified: true,
    identity: { dirty: false },
    trustedInput: { measuredTrusted: 120, measuredUntrusted: 0 },
    rawSamples: Array.from({ length: 120 }, (_, index) => ({
      timestampSource: 'dom.event.timeStamp',
      inputToCommitMs: p95 + (index % 7) * 0.01,
    })),
    interactions: { inputToCommit: { count: 120, p95 } },
    ...overrides,
  };
}

test('paired analysis uses one p95 per valid run and preserves rejected blocks', () => {
  const result = pairedP95([
    { block: 1, canvas2d: run(40), webgl2: run(30) },
    { block: 2, canvas2d: run(42), webgl2: run(31) },
    { block: 3, canvas2d: run(41, { validity: 'contended' }), webgl2: run(30) },
  ]);
  assert.equal(result.validPairCount, 2);
  assert.deepEqual(result.unavailableBlocks, [3]);
  assert.equal(result.medianImprovementPercent, (25 + ((42 - 31) / 42) * 100) / 2);
  assert.equal(
    result.improvementInterval95.method,
    'nested paired-block and within-run gesture bootstrap (improvement; 10000×500)',
  );
  assert.ok(result.improvementInterval95.lower95 > 20);
});

test('paired analysis excludes input samples from non-measured trace kinds', () => {
  const constantRun = (p95) => ({
    ...run(p95),
    rawSamples: Array.from({ length: 120 }, () => ({
      timestampSource: 'dom.event.timeStamp',
      inputToCommitMs: p95,
    })),
  });
  const selected = constantRun(40);
  selected.rawSamples.push(
    ...Array.from({ length: 100 }, (_, index) => ({
      timestampSource: 'dom.event.timeStamp',
      inputToCommitMs: 900 + index,
      measurementSelected: false,
    })),
  );
  const result = pairedP95([
    { block: 1, canvas2d: selected, webgl2: constantRun(30) },
    { block: 2, canvas2d: constantRun(42), webgl2: constantRun(31) },
    { block: 3, canvas2d: constantRun(41), webgl2: constantRun(30) },
  ]);
  assert.equal(result.validPairCount, 3);
  assert.equal(result.medianImprovementPercent, ((42 - 31) / 42) * 100);
});

test('production report envelope carries root source identity into paired workload analysis', () => {
  const row = run(40);
  delete row.identity;
  const lifted = qualificationWorkload({
    result: {
      identity: { dirty: false, commit: 'abc123' },
      workloads: [row],
    },
  });
  assert.equal(lifted.identity.commit, 'abc123');
  assert.equal(
    pairedP95([
      { block: 1, canvas2d: lifted, webgl2: run(30) },
      { block: 2, canvas2d: lifted, webgl2: run(31) },
      { block: 3, canvas2d: lifted, webgl2: run(30) },
    ]).validPairCount,
    3,
  );
});

test('paired analysis refuses untrusted driver input and samples', () => {
  const result = pairedP95([
    {
      block: 1,
      canvas2d: run(40, { trustedInput: { measuredTrusted: 0, measuredUntrusted: 120 } }),
      webgl2: run(30),
    },
    { block: 2, canvas2d: run(40), webgl2: run(30) },
    { block: 3, canvas2d: run(40), webgl2: run(30) },
  ]);
  assert.equal(result.validPairCount, 2);
  assert.deepEqual(result.unavailableBlocks, [1]);
});

test('bootstrap interval is deterministic and returns null for no valid samples', () => {
  assert.deepEqual(bootstrapMedianInterval([10, 20, 30]), bootstrapMedianInterval([10, 20, 30]));
  assert.deepEqual(bootstrapMedianInterval([]), { count: 0, lower95: null, upper95: null });
});

test('promotion remains inconclusive without correctness and resource gates', () => {
  const comparison = pairedP95([
    { block: 1, canvas2d: run(100), webgl2: run(70) },
    { block: 2, canvas2d: run(100), webgl2: run(70) },
    { block: 3, canvas2d: run(100), webgl2: run(70) },
  ]);
  const decision = decideQualification({
    slowTarget: comparison,
    otherWorkloads: [],
    correctnessPassed: false,
    memoryPassed: false,
  });
  assert.equal(decision.outcome, 'inconclusive');
  assert.ok(decision.blockers.includes('correctness-not-passed'));
  assert.ok(decision.blockers.includes('memory-or-soak-not-passed'));
});

test('decision boundaries distinguish insufficient benefit from a material regression', () => {
  const comparison = (canvasP95, webglP95) =>
    pairedP95([
      { block: 1, canvas2d: run(canvasP95), webgl2: run(webglP95) },
      { block: 2, canvas2d: run(canvasP95), webgl2: run(webglP95) },
      { block: 3, canvas2d: run(canvasP95), webgl2: run(webglP95) },
    ]);
  const belowThreshold = comparison(100, 90);
  assert.ok(belowThreshold.improvementInterval95.upper95 < 20);
  assert.equal(
    decideQualification({
      slowTarget: belowThreshold,
      otherWorkloads: [],
      correctnessPassed: true,
      memoryPassed: true,
    }).outcome,
    'benefit-below-promotion-threshold',
  );

  const slowTarget = comparison(100, 70);
  const regressed = comparison(100, 106);
  assert.ok(regressed.regressionInterval95.lower95 > 5);
  assert.equal(
    decideQualification({
      slowTarget,
      otherWorkloads: [{ id: 'other-workload', ...regressed }],
      correctnessPassed: true,
      memoryPassed: true,
    }).outcome,
    'regression-exceeds-guardrail',
  );
});
