import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRun, performanceEvidence, summarizeRunnerTraces } from './productionEvidence.mjs';

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
    { sceneNodeCount: 1000, presentation: { capabilities: { eventTiming: true } } },
    100,
  );
  assert.equal(evidence.insufficientSamples, false);
  assert.equal(evidence.presentationUnavailable, false);
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
