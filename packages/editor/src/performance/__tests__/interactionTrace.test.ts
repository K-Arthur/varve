import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginInteraction,
  enableInteractionTraces,
  endInteraction,
  getInteractionTraceCount,
  getRecentInteractionTraces,
  isInteractionTracingEnabled,
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
  });

  it('composes nested interactions by closing the previous one', () => {
    enableInteractionTraces(true);
    beginInteraction('pointer-drag');
    beginInteraction('pointer-drag');
    endInteraction();
    expect(getInteractionTraceCount()).toBe(2);
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
  });
});
