/**
 * Integration test: MotionFacade drives editor-style state updates.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Timeline } from '@strata/scene';
import { MotionFacade } from './MotionFacade';

function makeTimeline(): Timeline {
  return {
    id: 'tl-1',
    name: 'Test',
    duration: 1000,
    tracks: [
      {
        id: 'tr-1',
        nodeId: 'n1',
        property: 'opacity',
        keyframes: [
          { progress: 0, value: 0, easing: { kind: 'linear' } },
          { progress: 1, value: 1, easing: { kind: 'linear' } },
        ],
      },
    ],
    defaultEasing: { kind: 'linear' },
  };
}

describe('playback integration', () => {
  it('MotionFacade onFrame advances time like editor context would patch', () => {
    const times: number[] = [];
    const onFinish = vi.fn();
    const facade = new MotionFacade({
      onFrame: (t) => times.push(t),
      onFinish,
    });

    facade.play(makeTimeline());
    const engine = facade.getEngine().engine!;
    engine.processDelta(250);
    engine.processDelta(250);

    expect(times.length).toBeGreaterThan(0);
    expect(times[times.length - 1]).toBeGreaterThan(0);
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('loop playback does not call onFinish', () => {
    const onFinish = vi.fn();
    const facade = new MotionFacade({
      onFrame: () => {},
      onFinish,
    });
    facade.setLoop(true);
    facade.play(makeTimeline());
    const engine = facade.getEngine().engine!;
    engine.processDelta(5000);
    expect(onFinish).not.toHaveBeenCalled();
    expect(engine.state).toBe('playing');
  });
});
