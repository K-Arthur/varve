import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEditorFrameRuntimeForTests } from '../../performance/editorFrameRuntime';
import {
  beginInteraction,
  enableInteractionTraces,
  endInteraction,
  getRecentInteractionTraces,
  resetInteractionTraces,
} from '../../performance/interactionTrace';
import { recordFrame, scheduleCanvasFrame } from '../perfRuntime';

describe('canvas performance trace integration', () => {
  beforeEach(() => {
    resetEditorFrameRuntimeForTests();
    resetInteractionTraces();
    enableInteractionTraces(true);
  });

  afterEach(() => {
    enableInteractionTraces(false);
    resetEditorFrameRuntimeForTests();
    vi.unstubAllGlobals();
  });

  it('correlates render queue wait and main-frame work with the active interaction', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = callbacks.size + 1;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));

    beginInteraction('pointer-drag');
    scheduleCanvasFrame('trace-frame', 'canvas', () => undefined);
    callbacks.values().next().value?.(16);
    recordFrame({
      frameIndex: 1,
      docVersion: 1,
      redrawCount: 1,
      nodeCount: 12,
      culledCount: 2,
      cacheHitCount: 8,
      buildIrMs: 1,
      replayMs: 2,
      totalMs: 4,
      renderPath: 'compositor',
      wasDirty: true,
      partialRedraw: true,
      cacheBytes: 1024,
      cacheEntries: 8,
      profileTier: 'balanced',
    });
    const trace = endInteraction()!;

    expect(trace.spans.map((span) => span.name)).toEqual(['render.queue', 'render.main']);
    expect(trace.frames).toHaveLength(1);
    expect(trace.pointerToPresentMs).not.toBeNull();
    expect(getRecentInteractionTraces(1)[0]?.id).toBe(trace.id);
  });

  it('propagates frame decision as disposition in the interaction trace', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = callbacks.size + 1;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));

    beginInteraction('pointer-drag');
    recordFrame({
      frameIndex: 1,
      docVersion: 1,
      redrawCount: 1,
      nodeCount: 5,
      culledCount: 0,
      cacheHitCount: 3,
      buildIrMs: 0.5,
      replayMs: 1,
      totalMs: 2,
      renderPath: 'compositor',
      wasDirty: true,
      partialRedraw: false,
      cacheBytes: 512,
      cacheEntries: 4,
      profileTier: 'balanced',
      frameDecision: 'content',
    });
    const trace = endInteraction()!;

    expect(trace.frames).toHaveLength(1);
    expect(trace.frames[0]!.disposition).toBe('content');
  });

  it('propagates render revision when supplied in frame diagnostics', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = callbacks.size + 1;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));

    beginInteraction('pointer-drag');
    recordFrame({
      frameIndex: 1,
      docVersion: 1,
      redrawCount: 1,
      nodeCount: 5,
      culledCount: 0,
      cacheHitCount: 3,
      buildIrMs: 0.5,
      replayMs: 1,
      totalMs: 2,
      renderPath: 'worker-cached',
      wasDirty: false,
      partialRedraw: false,
      cacheBytes: 512,
      cacheEntries: 4,
      profileTier: 'balanced',
      frameDecision: 'present',
      renderRevision: 42,
    });
    const trace = endInteraction()!;

    expect(trace.frames).toHaveLength(1);
    expect(trace.frames[0]!.disposition).toBe('present');
    expect(trace.frames[0]!.renderRevision).toBe(42);
  });
});
