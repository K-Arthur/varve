import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DispatchEventLike, dispatchToTool, documentComplexityBucket } from '../dispatchSpan';
import {
  beginInteraction,
  enableInteractionTraces,
  endInteraction,
  resetInteractionTraces,
} from '../interactionTrace';

function event(overrides: Partial<DispatchEventLike> = {}): DispatchEventLike {
  return {
    timeStamp: performance.now() - 2,
    pointerType: 'mouse',
    buttons: 1,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  };
}

const attributes = { tool: 'select', docComplexity: 's', selectionCount: 1 };

describe('documentComplexityBucket', () => {
  it('buckets rather than leaking exact node counts', () => {
    expect(documentComplexityBucket(0)).toBe('xs');
    expect(documentComplexityBucket(99)).toBe('xs');
    expect(documentComplexityBucket(100)).toBe('s');
    expect(documentComplexityBucket(1_000)).toBe('m');
    expect(documentComplexityBucket(10_000)).toBe('l');
    expect(documentComplexityBucket(50_000)).toBe('xl');
  });
});

describe('dispatchToTool', () => {
  beforeEach(() => {
    enableInteractionTraces(false);
    resetInteractionTraces();
  });

  it('runs the dispatch and records nothing when tracing is disabled', () => {
    const run = vi.fn();
    const getCoalescedEvents = vi.fn(() => []);
    dispatchToTool('move', event({ getCoalescedEvents }), attributes, run);
    expect(run).toHaveBeenCalledOnce();
    // The allocating coalesced-event read must not happen on the hot path.
    expect(getCoalescedEvents).not.toHaveBeenCalled();
  });

  it('records a distinct interaction.dispatch span with bounded attributes', () => {
    enableInteractionTraces(true);
    beginInteraction('pointer-drag');
    dispatchToTool(
      'move',
      event({ getCoalescedEvents: () => [{}, {}, {}], shiftKey: true }),
      attributes,
      () => undefined,
    );
    const trace = endInteraction();
    const span = trace?.spans.find((s) => s.name === 'interaction.dispatch');
    expect(span).toBeDefined();
    expect(span?.attributes).toMatchObject({
      tool: 'select',
      docComplexity: 's',
      selectionCount: 1,
      phase: 'move',
      pointerType: 'mouse',
      coalescedCount: 3,
      shift: true,
      pointerSequenceId: 1,
      queueDelayClock: 'dom.event.timeStamp',
    });
    expect(span?.attributes?.queueDelayMs).toBeGreaterThanOrEqual(0);
  });

  it('marks the queue delay untrusted instead of reporting a bogus latency', () => {
    enableInteractionTraces(true);
    beginInteraction('pointer-drag');
    dispatchToTool('move', event({ timeStamp: Date.now() }), attributes, () => undefined);
    const span = endInteraction()?.spans[0];
    expect(span?.attributes?.queueDelayClock).toBe('untrusted');
    expect(span?.attributes).not.toHaveProperty('queueDelayMs');
  });

  it('closes the span when the tool throws', () => {
    enableInteractionTraces(true);
    beginInteraction('pointer-drag');
    expect(() =>
      dispatchToTool('down', event(), attributes, () => {
        throw new Error('tool blew up');
      }),
    ).toThrow('tool blew up');
    const trace = endInteraction();
    expect(trace?.spans.map((s) => s.name)).toEqual(['interaction.dispatch']);
  });

  it('advances the pointer sequence once per dispatch', () => {
    enableInteractionTraces(true);
    beginInteraction('pointer-drag');
    dispatchToTool('down', event(), attributes, () => undefined);
    dispatchToTool('move', event(), attributes, () => undefined);
    dispatchToTool('up', event(), attributes, () => undefined);
    const trace = endInteraction();
    expect(trace?.spans.map((s) => s.attributes?.pointerSequenceId)).toEqual([1, 2, 3]);
    expect(trace?.spans.map((s) => s.attributes?.phase)).toEqual(['down', 'move', 'up']);
  });
});
