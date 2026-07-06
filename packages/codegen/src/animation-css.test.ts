import { createKeyframe, makeTimelineObject } from '@strata/scene';
import type { EasingDefinition } from '@strata/shared';
import { describe, expect, it } from 'vitest';
import { timelineToCSSKeyframes } from './animation-css';

function makeSimpleTrack(
  nodeId: string,
  property: string,
  ...values: { progress: number; value: unknown; easing?: Record<string, unknown> }[]
) {
  return {
    id: `tr-${nodeId}-${property}`,
    nodeId,
    property,
    keyframes: values.map((v) =>
      createKeyframe(v.progress, v.value, v.easing as EasingDefinition | undefined),
    ),
  };
}

describe('timelineToCSSKeyframes', () => {
  it('returns empty string for timeline with no tracks', () => {
    const tl = makeTimelineObject('tl1', 'Test', 1000);
    expect(timelineToCSSKeyframes(tl, {})).toBe('');
  });

  it('returns empty string for tracks with fewer than 2 keyframes', () => {
    const tl = makeTimelineObject('tl1', 'Test', 1000);
    tl.tracks = [makeSimpleTrack('n1', 'opacity', { progress: 0, value: 0 })];
    expect(timelineToCSSKeyframes(tl, { n1: 'box' })).toBe('');
  });

  it('generates @keyframes rule with from/to for two keyframes', () => {
    const tl = makeTimelineObject('tl1', 'Fade', 2000);
    tl.tracks = [
      makeSimpleTrack('n1', 'opacity', { progress: 0, value: 0 }, { progress: 1, value: 1 }),
    ];
    const result = timelineToCSSKeyframes(tl, { n1: 'box' });
    expect(result).toContain('@keyframes box-opacity');
    expect(result).toContain('0% {');
    expect(result).toContain('  opacity: 0;');
    expect(result).toContain('100% {');
    expect(result).toContain('  opacity: 1;');
  });

  it('generates three keyframe stops with percentage syntax', () => {
    const tl = makeTimelineObject('tl1', 'Bounce', 3000);
    tl.tracks = [
      makeSimpleTrack(
        'n1',
        'opacity',
        { progress: 0, value: 0 },
        { progress: 0.5, value: 0.5 },
        { progress: 1, value: 1 },
      ),
    ];
    const result = timelineToCSSKeyframes(tl, { n1: 'box' });
    expect(result).toContain('0% {');
    expect(result).toContain('50% {');
    expect(result).toContain('100% {');
    expect(result).toContain('opacity: 0.5');
  });

  it('applies animation-timing-function for easing on non-first keyframes', () => {
    const tl = makeTimelineObject('tl1', 'Eased', 1000);
    tl.tracks = [
      makeSimpleTrack(
        'n1',
        'opacity',
        { progress: 0, value: 0 },
        { progress: 1, value: 1, easing: { kind: 'easeOut' } },
      ),
    ];
    const result = timelineToCSSKeyframes(tl, { n1: 'box' });
    expect(result).toContain('animation-timing-function: ease-out');
  });

  it('converts cubic-bezier easing correctly', () => {
    const tl = makeTimelineObject('tl1', 'Custom', 1000);
    tl.tracks = [
      makeSimpleTrack(
        'n1',
        'opacity',
        { progress: 0, value: 0 },
        { progress: 1, value: 1, easing: { kind: 'cubicBezier', x1: 0.42, y1: 0, x2: 1, y2: 1 } },
      ),
    ];
    const result = timelineToCSSKeyframes(tl, { n1: 'box' });
    expect(result).toContain('cubic-bezier(0.42, 0, 1, 1)');
  });

  it('outputs rotation as transform: rotate(Xdeg)', () => {
    const tl = makeTimelineObject('tl1', 'Spin', 1000);
    tl.tracks = [
      makeSimpleTrack('n1', 'rotation', { progress: 0, value: 0 }, { progress: 1, value: 360 }),
    ];
    const result = timelineToCSSKeyframes(tl, { n1: 'gear' });
    expect(result).toContain('transform: rotate(0deg)');
    expect(result).toContain('transform: rotate(360deg)');
  });

  it('handles multiple tracks generating separate @keyframes rules', () => {
    const tl = makeTimelineObject('tl1', 'Multi', 1000);
    tl.tracks = [
      makeSimpleTrack('n1', 'opacity', { progress: 0, value: 0 }, { progress: 1, value: 1 }),
      makeSimpleTrack('n2', 'rotation', { progress: 0, value: 0 }, { progress: 1, value: 90 }),
    ];
    const result = timelineToCSSKeyframes(tl, { n1: 'a', n2: 'b' });
    expect(result).toContain('@keyframes a-opacity');
    expect(result).toContain('@keyframes b-rotation');
    expect(result).toContain('opacity: 1');
    expect(result).toContain('transform: rotate(90deg)');
  });

  it('skips disabled tracks', () => {
    const tl = makeTimelineObject('tl1', 'Test', 1000);
    tl.tracks = [
      {
        ...makeSimpleTrack('n1', 'opacity', { progress: 0, value: 0 }, { progress: 1, value: 1 }),
        enabled: false,
      },
    ];
    expect(timelineToCSSKeyframes(tl, { n1: 'box' })).toBe('');
  });
});
