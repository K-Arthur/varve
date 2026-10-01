import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyRun,
  measuredTraceFailure,
  performanceEvidence,
  summarizeRunnerTraces,
} from './productionEvidence.mjs';

function trace(index, nextPaint = null) {
  return {
    id: index,
    kind: 'pointer-drag',
    totalMs: 12,
    slow: false,
    initialQueueDelayMs: 1,
    inputToCommitMs: 12,
    inputToNextPaintMs: nextPaint,
    presentationEvidence: {
      source: nextPaint === null ? 'unavailable' : 'event-timing',
      clockTrust: nextPaint === null ? 'unavailable' : 'trusted',
    },
    timestampSource: 'dom.event.timeStamp',
    untrustedQueueDelayCount: 0,
    spans: [
      {
        name: 'pointer.input',
        durationMs: 1,
        attributes: { queueDelayMs: 1, eventSequenceId: `event-${index}` },
      },
    ],
    frames: [{ totalMs: 1, causalRelation: 'caused' }],
    droppedSpanCount: 0,
    droppedFrameCount: 0,
    instrumentationErrors: [],
    presentationExpected: true,
  };
}

test('production evidence requires 100 valid samples and preserves v4 fields', () => {
  const traces = Array.from({ length: 100 }, (_, index) => trace(index, 18));
  const summary = summarizeRunnerTraces(traces);
  assert.equal(summary.interactions.inputToCommit.count, 100);
  assert.equal(summary.interactions.inputToNextPaint.count, 100);
  assert.equal(summary.interactionBreakdown.missingPresentation, 0);

  const evidence = performanceEvidence(
    traces,
    {
      sceneNodeCount: 1000,
      presentation: {
        capabilities: { eventTiming: true },
        refreshIntervalMs: 16.7,
        refreshIntervalSource: 'observed-raf-lower-bound',
        refreshIntervalSamples: 12,
      },
    },
    100,
  );
  assert.equal(evidence.insufficientSamples, false);
  assert.equal(evidence.presentationUnavailable, false);
  assert.equal(evidence.sampleAdequacy.commit.p95Qualified, true);
  assert.equal(evidence.sampleAdequacy.commit.p99Qualified, false);
  assert.equal(evidence.frameResponseTargets.basis, 'observed-raf-lower-bound');
  assert.equal(evidence.frameResponseTargets.p95.targetMs, 33.4);
  assert.equal(evidence.frameResponseTargets.p99.commitMeetsTarget, null);
  assert.equal(
    classifyRun({ load1: 0, backgroundActivity: [], thermalMaxC: null }, null, evidence, 8),
    'valid',
  );
});

test('missing next-paint evidence is unsupported, not zero latency', () => {
  const traces = Array.from({ length: 100 }, (_, index) => trace(index));
  const evidence = performanceEvidence(
    traces,
    {
      sceneNodeCount: 10000,
      fixture: { id: 'flat-10k' },
      presentation: { capabilities: { eventTiming: true } },
    },
    100,
  );
  assert.equal(evidence.distributions.nextPaint.count, 0);
  assert.equal(evidence.presentationUnavailable, true);
  assert.equal(
    classifyRun({ load1: 0, backgroundActivity: [], thermalMaxC: null }, null, evidence, 8),
    'insufficient_samples',
  );
});

test('runtime application errors invalidate performance evidence', () => {
  const machine = { load1: 0, backgroundActivity: [], thermalMaxC: null };
  assert.equal(
    classifyRun(machine, null, { instrumentationError: true }, 8),
    'instrumentation_error',
  );
});

test('does not count handler-origin commit or paint samples as trusted evidence', () => {
  const traces = Array.from({ length: 100 }, (_, index) => ({
    ...trace(index, 18),
    timestampSource: 'handler.performance.now',
    presentationEvidence: { source: 'event-timing', clockTrust: 'handler-origin' },
  }));
  const evidence = performanceEvidence(
    traces,
    { sceneNodeCount: 1000, presentation: { capabilities: { eventTiming: true } } },
    100,
  );
  assert.equal(evidence.distributions.commit.count, 0);
  assert.equal(evidence.distributions.nextPaint.count, 0);
  assert.equal(evidence.insufficientSamples, true);
});

test('keeps valid slow runs as evidence and reports performance outcome separately', () => {
  const traces = Array.from({ length: 100 }, (_, index) => ({
    ...trace(index, 18),
    totalMs: 200,
    inputToCommitMs: 200,
    spans: [
      {
        name: 'pointer.input',
        durationMs: 25,
        attributes: { queueDelayMs: 9, eventSequenceId: `slow-${index}` },
      },
    ],
  }));
  const evidence = performanceEvidence(
    traces,
    { sceneNodeCount: 10_000, presentation: { capabilities: { eventTiming: true } } },
    100,
  );
  assert.ok(evidence.thresholdBreaches.length > 0);
  assert.equal(evidence.performanceOutcome, 'baseline-threshold-breach');
  assert.equal(evidence.promotionEligible, false);
  assert.equal(measuredTraceFailure('pan', traces.length, 0), null);
  assert.equal(
    classifyRun({ load1: 0, backgroundActivity: [], thermalMaxC: null }, null, evidence, 8),
    'valid',
  );
});

test('rejects missing measured traces and missing presentation independently of speed', () => {
  assert.deepEqual(measuredTraceFailure('pan', 0), {
    status: 'no-evidence',
    error: 'workload completed but produced no interaction traces',
  });
  assert.deepEqual(measuredTraceFailure('pan', 100, 1), {
    status: 'instrumentation-error',
    error: '1 interaction trace(s) had no presented frame',
  });
  assert.equal(measuredTraceFailure('pointer-move-idle', 100, 1), null);
});

test('does not gate or claim p99 until 1,000 valid samples exist', () => {
  const traces = (count) =>
    Array.from({ length: count }, (_, index) => ({
      ...trace(index, 18),
      inputToCommitMs: index >= count - 12 ? 200 : 12,
    }));
  const presentation = {
    capabilities: { eventTiming: true },
    refreshIntervalMs: 16.7,
    refreshIntervalSource: 'observed-raf-lower-bound',
    refreshIntervalSamples: 12,
  };
  const underSampled = performanceEvidence(traces(999), { sceneNodeCount: 1000, presentation });
  assert.equal(underSampled.distributions.commit.p99, 200);
  assert.equal(underSampled.sampleAdequacy.commit.p99Qualified, false);
  assert.equal(underSampled.frameResponseTargets.p99.commitMeetsTarget, null);
  assert.ok(!underSampled.thresholdBreaches.some((breach) => breach.includes('commit p99')));

  const qualified = performanceEvidence(traces(1000), { sceneNodeCount: 1000, presentation });
  assert.equal(qualified.sampleAdequacy.commit.p99Qualified, true);
  assert.equal(qualified.frameResponseTargets.p99.commitMeetsTarget, false);
  assert.ok(qualified.thresholdBreaches.some((breach) => breach.includes('commit p99')));
});

test('does not treat missing authoritative presentation as zero or invalidate compute evidence', () => {
  const traces = Array.from({ length: 100 }, (_, index) => trace(index, 18));
  const evidence = performanceEvidence(
    traces,
    { sceneNodeCount: 1000, presentation: { capabilities: { eventTiming: true } } },
    100,
  );
  assert.equal(evidence.distributions.nextPaint.count, 100);
  assert.equal(evidence.authoritativePresentationAvailable, false);
  assert.ok(evidence.promotionBlockers.includes('authoritative-presentation-unavailable'));
  assert.equal(
    classifyRun({ load1: 0, backgroundActivity: [], thermalMaxC: null }, null, evidence, 8),
    'valid',
  );
});

test('presentation identifiers without linked clocks and timestamps are not authoritative', () => {
  const traces = Array.from({ length: 100 }, (_, index) => ({
    ...trace(index, 18),
    presentationEvidence: {
      source: 'native-profiler-correlated',
      clockTrust: 'trusted',
      inputIdentity: `input-${index}`,
      contentFrameIdentity: `frame-${index}`,
      uncertaintyMs: 0.1,
    },
  }));
  const evidence = performanceEvidence(
    traces,
    {
      sceneNodeCount: 1000,
      rendererQualification: { webgl2: { renderer: 'llvmpipe (LLVM 19.1.7, 256 bits)' } },
    },
    100,
  );
  assert.equal(evidence.authoritativePresentationAvailable, false);
  assert.ok(evidence.promotionBlockers.includes('authoritative-presentation-unavailable'));
});

test('correlated software-renderer evidence remains compatibility only', () => {
  const traces = Array.from({ length: 100 }, (_, index) => ({
    ...trace(index, 18),
    inputIdentity: `input-${index}`,
    contentFrameIdentity: `frame-${index}`,
    inputClockId: 'monotonic-host',
    inputMonotonicTimestampMs: 1000 + index * 100,
    presentationEvidence: {
      source: 'native-profiler-correlated',
      clockTrust: 'trusted',
      clockId: 'monotonic-host',
      monotonicTimestampMs: 1016.7 + index * 100,
      inputToPresentationMs: 16.7,
      inputIdentity: `input-${index}`,
      contentFrameIdentity: `frame-${index}`,
      uncertaintyMs: 0.1,
    },
  }));
  const evidence = performanceEvidence(
    traces,
    {
      sceneNodeCount: 1000,
      rendererQualification: { webgl2: { renderer: 'llvmpipe (LLVM 19.1.7, 256 bits)' } },
    },
    100,
  );
  assert.equal(evidence.authoritativePresentationAvailable, true);
  assert.equal(evidence.promotionEligible, false);
  assert.ok(evidence.promotionBlockers.includes('software-renderer-compatibility-only'));
});
