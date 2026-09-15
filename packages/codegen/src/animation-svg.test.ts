import { createKeyframe, makeTimelineObject } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { timelineToSVGAnimations } from './animation-svg';

describe('timelineToSVGAnimations', () => {
  it('returns empty string for timeline with no tracks', () => {
    const tl = makeTimelineObject('tl1', 'Test', 1000);
    expect(timelineToSVGAnimations(tl, {})).toBe('');
  });

  it('returns empty string for tracks with no keyframes', () => {
    const tl = makeTimelineObject('tl1', 'Test', 1000);
    tl.tracks = [{ id: 'tr1', nodeId: 'n1', property: 'opacity', keyframes: [] }];
    expect(timelineToSVGAnimations(tl, { n1: 'box' })).toBe('');
  });

  it('generates <animate> element for opacity with two keyframes', () => {
    const tl = makeTimelineObject('tl1', 'Fade', 2000);
    tl.tracks = [
      {
        id: 'tr1',
        nodeId: 'n1',
        property: 'opacity',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 1)],
      },
    ];
    const result = timelineToSVGAnimations(tl, { n1: 'box' });
    expect(result).toContain('<animate');
    expect(result).toContain('attributeName="opacity"');
    expect(result).toContain('values="0;1"');
    expect(result).toContain('dur="2000ms"');
  });

  it('generates <animateTransform> for rotation', () => {
    const tl = makeTimelineObject('tl1', 'Spin', 1000);
    tl.tracks = [
      {
        id: 'tr1',
        nodeId: 'n1',
        property: 'rotation',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 360)],
      },
    ];
    const result = timelineToSVGAnimations(tl, { n1: 'gear' });
    expect(result).toContain('<animateTransform');
    expect(result).toContain('attributeName="transform"');
    expect(result).toContain('type="rotate"');
    expect(result).toContain('values="0;360"');
  });

  it('generates keyTimes for three keyframes', () => {
    const tl = makeTimelineObject('tl1', 'Multi', 2000);
    tl.tracks = [
      {
        id: 'tr1',
        nodeId: 'n1',
        property: 'opacity',
        keyframes: [createKeyframe(0, 0), createKeyframe(0.5, 0.5), createKeyframe(1, 1)],
      },
    ];
    const result = timelineToSVGAnimations(tl, { n1: 'box' });
    expect(result).toContain('values="0;0.5;1"');
    expect(result).toContain('keyTimes="0.0000;0.5000;1.0000"');
  });

  it('uses <set> for discrete interpolation', () => {
    const tl = makeTimelineObject('tl1', 'Toggle', 1000);
    tl.tracks = [
      {
        id: 'tr1',
        nodeId: 'n1',
        property: 'visibility',
        keyframes: [createKeyframe(0, 'visible'), createKeyframe(0.5, 'hidden')],
        interpolation: 'discrete',
      },
    ];
    const result = timelineToSVGAnimations(tl, { n1: 'box' });
    expect(result).toContain('<set');
    expect(result).toContain('attributeName="visibility"');
    expect(result).toContain('to="hidden"');
  });

  it('references elements via xlink:href', () => {
    const tl = makeTimelineObject('tl1', 'Multi', 1000);
    tl.tracks = [
      {
        id: 'tr1',
        nodeId: 'n1',
        property: 'opacity',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 1)],
      },
      {
        id: 'tr2',
        nodeId: 'n2',
        property: 'rotation',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 90)],
      },
    ];
    const result = timelineToSVGAnimations(tl, { n1: 'a', n2: 'b' });
    expect(result).toContain('href="#a"');
    expect(result).toContain('href="#b"');
  });

  it('skips disabled tracks', () => {
    const tl = makeTimelineObject('tl1', 'Test', 1000);
    tl.tracks = [
      {
        id: 'tr1',
        nodeId: 'n1',
        property: 'opacity',
        keyframes: [createKeyframe(0, 0), createKeyframe(1, 1)],
        enabled: false,
      },
    ];
    expect(timelineToSVGAnimations(tl, { n1: 'box' })).toBe('');
  });
});
