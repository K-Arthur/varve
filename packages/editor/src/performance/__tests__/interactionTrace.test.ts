import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginInteraction,
  beginInteractionSpan,
  enableInteractionTraces,
  endInteraction,
  endInteractionIfKind,
  getActiveInteractionIdentity,
  getInteractionTraceCount,
  getRecentInteractionTraces,
  isInteractionTracingEnabled,
  MAX_INTERACTION_FRAMES,
  MAX_INTERACTION_SPANS,
  nextPointerSequenceId,
  notifyFrameCommit,
  recordInteractionSpan,
  resetInteractionTraces,
  setSlowCaptureOnly,
  setSlowInteractionThreshold,
  summarizeInteractionTraces,
} from '../interactionTrace';

describe('interactionTrace', () => {
  beforeEach(() => {
    enableInteractionTraces(false);
    resetInteractionTraces();
    setSlowCaptureOnly(false);
    setSlowInteractionThreshold(50);
  });

  it('is disabled by default and drops spans/frames', () => {
    expect(isInteractionTracingEnabled()).toBe(false);
    beginInteraction('pointer-drag');
    recordInteractionSpan('pointer.input', 5);
    notifyFrameCommit(performance.now(), 8);
    endInteraction();
    expect(getInteractionTraceCount()).toBe(0);
  });

  it('groups events and frames into a correlation-id trace', () => {
    enableInteractionTraces(true);
    beginInteraction('pointer-drag');
    recordInteractionSpan('pointer.input', 3);
    recordInteractionSpan('pointer.input', 2);
    notifyFrameCommit(performance.now(), 10);
    endInteraction();

    expect(getInteractionTraceCount()).toBe(1);
    const trace = getRecentInteractionTraces(1)[0]!;
    expect(trace.kind).toBe('pointer-drag');
    expect(trace.eventCount).toBe(2);
    expect(trace.frameCount).toBe(1);
    expect(trace.spans.map((s) => s.name)).toEqual(['pointer.input', 'pointer.input']);
    expect(trace.pointerToPresentMs).not.toBeNull();
    expect(trace.totalMs).toBeGreaterThanOrEqual(0);
    expect(trace.id).toBeGreaterThan(0);
    expect(trace.schemaVersion).toBe(2);
    expect(trace.sessionId).toMatch(/^s[0-9a-z]+-[0-9a-z]+$/);
    expect(trace.droppedSpanCount).toBe(0);
    expect(trace.droppedFrameCount).toBe(0);
  });

  it('counts input events independently from named phase spans', () => {
    enableInteractionTraces(true);
    beginInteraction('pointer-drag');
    recordInteractionSpan('pointer.input', 3);
    recordInteractionSpan('snap.prefilter', 1);
    recordInteractionSpan('snap.evaluate', 2);
    endInteraction();

    const trace = getRecentInteractionTraces(1)[0]!;
    expect(trace.eventCount).toBe(1);
    expect(trace.spans.map((span) => span.name)).toEqual([
      'pointer.input',
      'snap.prefilter',
      'snap.evaluate',
    ]);
  });

  it('composes nested interactions by closing the previous one', () => {
    enableInteractionTraces(true);
    beginInteraction('pointer-drag');
    beginInteraction('pointer-drag');
    endInteraction();
    expect(getInteractionTraceCount()).toBe(2);
  });

  it('does not let a stale burst timer close a newer interaction kind', () => {
    enableInteractionTraces(true);
    beginInteraction('wheel');
    beginInteraction('pointer-drag');

    expect(endInteractionIfKind('wheel')).toBeNull();
    expect(getActiveInteractionIdentity()?.kind).toBe('pointer-drag');
    expect(endInteractionIfKind('pointer-drag')?.kind).toBe('pointer-drag');
  });

  it('computes pointer-to-present from the first frame commit', () => {
    enableInteractionTraces(true);
    beginInteraction('pointer-drag');
    const t0 = performance.now();
    notifyFrameCommit(t0 + 10, 5);
    notifyFrameCommit(t0 + 20, 6);
    endInteraction();
    const trace = getRecentInteractionTraces(1)[0]!;
    expect(trace.pointerToPresentMs).toBeGreaterThanOrEqual(5);
    expect(trace.frames).toHaveLength(2);
  });

  it('attributes the first frame that arrives just after a fast gesture ends', () => {
    enableInteractionTraces(true);
    beginInteraction('pointer-drag');
    recordInteractionSpan('pointer.input', 1);
    const trace = endInteraction()!;
    expect(trace.pointerToPresentMs).toBeNull();

    notifyFrameCommit(trace.endedAt + 10, 4);

    expect(trace.pointerToPresentMs).toBeGreaterThanOrEqual(0);
    expect(trace.frameCount).toBe(1);
  });

  it('attributes one coalesced frame to every rapid gesture waiting for presentation', () => {
    enableInteractionTraces(true);
    beginInteraction('keyboard');
    const first = endInteraction()!;
    beginInteraction('keyboard');
    const second = endInteraction()!;

    const committedAt = Math.max(first.endedAt, second.endedAt) + 10;
    notifyFrameCommit(committedAt, 4, { disposition: 'coalesced' });

    expect(first.pointerToPresentMs).not.toBeNull();
    expect(second.pointerToPresentMs).not.toBeNull();
    expect(first.frames).toEqual([expect.objectContaining({ disposition: 'coalesced' })]);
    expect(second.frames).toEqual([expect.objectContaining({ disposition: 'coalesced' })]);
  });

  it('does not attribute a frame outside the bounded presentation window', () => {
    enableInteractionTraces(true);
    beginInteraction('keyboard');
    const trace = endInteraction()!;

    notifyFrameCommit(trace.endedAt + 251, 4);
    notifyFrameCommit(trace.endedAt + 252, 4);

    expect(trace.pointerToPresentMs).toBeNull();
    expect(trace.frameCount).toBe(0);
  });

  it('lets an async phase finish against its originating interaction', () => {
    enableInteractionTraces(true);
    beginInteraction('pointer-drag');
    const finish = beginInteractionSpan('render.queue', { lane: 'canvas' });
    const trace = endInteraction()!;

    finish({ replaced: false });

    expect(trace.spans.at(-1)).toMatchObject({
      name: 'render.queue',
      attributes: { lane: 'canvas', replaced: false },
    });
  });

  it('slow-only capture retains only gestures above the threshold', () => {
    enableInteractionTraces(true);
    setSlowCaptureOnly(true);
    setSlowInteractionThreshold(5);
    beginInteraction('pointer-drag');
    recordInteractionSpan('pointer.input', 100);
    endInteraction();
    expect(getInteractionTraceCount()).toBe(1);
    expect(getRecentInteractionTraces(1)[0]?.slow).toBe(true);

    beginInteraction('pointer-drag');
    endInteraction(); // sub-threshold
    expect(getInteractionTraceCount()).toBe(1); // still just the slow one
  });

  it('slow-only capture can qualify a fast gesture from its delayed presentation', () => {
    enableInteractionTraces(true);
    setSlowCaptureOnly(true);
    setSlowInteractionThreshold(5);
    beginInteraction('pointer-drag');
    recordInteractionSpan('pointer.input', 1);
    const trace = endInteraction()!;
    expect(getInteractionTraceCount()).toBe(0);

    notifyFrameCommit(trace.endedAt + 10, 4);

    expect(trace.slow).toBe(true);
    expect(getInteractionTraceCount()).toBe(1);
    expect(getRecentInteractionTraces(1)[0]?.id).toBe(trace.id);
  });

  it('keeps a bounded ring buffer', () => {
    enableInteractionTraces(true);
    setSlowCaptureOnly(true);
    setSlowInteractionThreshold(0); // everything is slow
    for (let i = 0; i < 300; i++) {
      beginInteraction('pointer-drag');
      endInteraction();
    }
    expect(getInteractionTraceCount()).toBe(50);
  });

  it('bounds frames and spans inside a single long interaction', () => {
    enableInteractionTraces(true);
    beginInteraction('pointer-drag');
    for (let i = 0; i < MAX_INTERACTION_SPANS + 25; i++) {
      recordInteractionSpan('pointer.input', 1);
    }
    for (let i = 0; i < MAX_INTERACTION_FRAMES + 25; i++) {
      notifyFrameCommit(performance.now(), 4);
    }
    const trace = endInteraction()!;

    expect(trace.eventCount).toBe(MAX_INTERACTION_SPANS + 25);
    expect(trace.spans).toHaveLength(MAX_INTERACTION_SPANS);
    expect(trace.droppedSpanCount).toBe(25);
    expect(trace.frameCount).toBe(MAX_INTERACTION_FRAMES + 25);
    expect(trace.frames).toHaveLength(MAX_INTERACTION_FRAMES);
    expect(trace.droppedFrameCount).toBe(25);
  });

  it('clears state when disabled', () => {
    enableInteractionTraces(true);
    beginInteraction('pointer-drag');
    recordInteractionSpan('pointer.input', 2);
    enableInteractionTraces(false);
    expect(getInteractionTraceCount()).toBe(0);
    beginInteraction('pointer-drag');
    endInteraction();
    expect(getInteractionTraceCount()).toBe(0);
  });

  it('summarizes latency distributions', () => {
    enableInteractionTraces(true);
    setSlowInteractionThreshold(10);
    for (let i = 0; i < 5; i++) {
      beginInteraction('pointer-drag');
      notifyFrameCommit(performance.now(), 4 + i);
      endInteraction();
    }
    const summary = summarizeInteractionTraces(getRecentInteractionTraces(5));
    expect(summary.count).toBe(5);
    expect(summary.slowCount).toBe(0);
    expect(summary.avgPointerToPresentMs).toBeGreaterThanOrEqual(0);
    expect(summary.p95TotalMs).toBeGreaterThanOrEqual(summary.maxTotalMs * 0.9);
    expect(summary.maxTotalMs).toBeGreaterThanOrEqual(0);
    expect(summary.total.count).toBe(5);
    expect(summary.total.p99).toBeGreaterThanOrEqual(summary.total.p95);
    expect(summary.pointerToPresent.count).toBe(5);
    expect(summary.pointerToPresent.max).toBeGreaterThanOrEqual(summary.pointerToPresent.p99);
  });

  describe('interaction identity', () => {
    it('exposes no identity when tracing is disabled', () => {
      beginInteraction('pointer-drag');
      expect(getActiveInteractionIdentity()).toBeNull();
      expect(nextPointerSequenceId()).toBe(0);
    });

    it('advances the pointer sequence within one interaction', () => {
      enableInteractionTraces(true);
      beginInteraction('pointer-drag');
      expect(nextPointerSequenceId()).toBe(1);
      expect(nextPointerSequenceId()).toBe(2);
      const identity = getActiveInteractionIdentity();
      expect(identity).toMatchObject({ pointerSequenceId: 2, kind: 'pointer-drag' });
      const trace = endInteraction();
      expect(trace?.pointerSequenceId).toBe(2);
    });

    it('restarts the pointer sequence but not the interaction id per gesture', () => {
      enableInteractionTraces(true);
      beginInteraction('pointer-drag');
      nextPointerSequenceId();
      const first = endInteraction();
      beginInteraction('pointer-drag');
      expect(nextPointerSequenceId()).toBe(1);
      const second = endInteraction();
      expect(second?.id).toBe((first?.id ?? 0) + 1);
      expect(second?.sessionId).toBe(first?.sessionId);
    });
  });

  it('records frame disposition and render revision when supplied', () => {
    enableInteractionTraces(true);
    beginInteraction('pointer-drag');
    notifyFrameCommit(performance.now(), 4, { disposition: 'caused', renderRevision: 7 });
    notifyFrameCommit(performance.now(), 3, { disposition: 'background' });
    const trace = endInteraction();
    expect(trace?.frames).toEqual([
      expect.objectContaining({ disposition: 'caused', renderRevision: 7 }),
      expect.objectContaining({ disposition: 'background' }),
    ]);
    expect(trace?.frames[1]).not.toHaveProperty('renderRevision');
  });
});
