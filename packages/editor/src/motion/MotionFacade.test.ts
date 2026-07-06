import type { Timeline } from '@strata/scene';
import { describe, expect, it, vi } from 'vitest';
import { MotionFacade } from './MotionFacade';

function makeTimeline(duration = 1000): Timeline {
  return {
    id: 'tl-1',
    name: 'Test',
    duration,
    defaultEasing: { kind: 'linear' },
    tracks: [
      {
        id: 'tr-1',
        nodeId: 'node-1',
        property: 'opacity',
        keyframes: [
          { progress: 0, value: 0, easing: { kind: 'linear' } },
          { progress: 1, value: 1, easing: { kind: 'linear' } },
        ],
      },
    ],
  };
}

describe('MotionFacade', () => {
  it('calls onFrame with advancing time during playback', () => {
    const frames: number[] = [];
    const facade = new MotionFacade({
      onFrame: (time) => frames.push(time),
      onFinish: () => {},
    });

    const eng = facade.getEngine().engine;
    expect(eng).toBeNull();

    facade.play(makeTimeline());
    expect(facade.getEngine().engine).not.toBeNull();

    const engine = facade.getEngine().engine!;
    engine.processDelta(100);
    engine.processDelta(100);

    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames[frames.length - 1]).toBeGreaterThan(frames[0]!);
  });

  it('calls onFinish when playback completes', () => {
    const onFinish = vi.fn();
    const facade = new MotionFacade({
      onFrame: () => {},
      onFinish,
    });

    facade.play(makeTimeline(100));
    const engine = facade.getEngine().engine!;
    engine.processDelta(5000);

    expect(onFinish).toHaveBeenCalled();
  });

  it('passes loop option to engine', () => {
    const facade = new MotionFacade({
      onFrame: () => {},
      onFinish: () => {},
    });

    facade.setLoop(true);
    facade.play(makeTimeline(100));
    const engine = facade.getEngine().engine!;
    engine.processDelta(500);

    expect(engine.state).toBe('playing');
  });

  it('stop resets engine', () => {
    const facade = new MotionFacade({
      onFrame: () => {},
      onFinish: () => {},
    });

    facade.play(makeTimeline());
    facade.stop();
    expect(facade.getEngine().engine).toBeNull();
  });

  it('seek updates sample via onFrame', () => {
    const frames: number[] = [];
    const facade = new MotionFacade({
      onFrame: (time) => frames.push(time),
      onFinish: () => {},
    });

    facade.play(makeTimeline());
    facade.seek(500);
    expect(frames).toContain(500);
  });
});
