import { describe, expect, it } from 'vitest';
import {
  createTimeline,
  addKeyframe,
  sampleAt,
  interpolateValue,
} from './animation';

describe('Animation engine', () => {
  describe('createTimeline', () => {
    it('creates a named timeline with empty keyframes', () => {
      const timeline = createTimeline('bounce', 1000, { kind: 'easeInOut' });
      expect(timeline.id).toBe('bounce');
      expect(timeline.duration).toBe(1000);
      expect(timeline.keyframes).toEqual([]);
    });
  });

  describe('addKeyframe', () => {
    it('adds a keyframe at a given progress point', () => {
      const timeline = createTimeline('move', 500, { kind: 'linear' });
      addKeyframe(timeline, 0, { x: 0, y: 0 });
      addKeyframe(timeline, 1, { x: 100, y: 200 });
      expect(timeline.keyframes).toHaveLength(2);
      expect(timeline.keyframes[0]!.progress).toBe(0);
      expect(timeline.keyframes[1]!.progress).toBe(1);
    });

    it('sorts keyframes by progress', () => {
      const timeline = createTimeline('test', 1000, { kind: 'linear' });
      addKeyframe(timeline, 0.5, { opacity: 0.5 });
      addKeyframe(timeline, 0, { opacity: 0 });
      addKeyframe(timeline, 1, { opacity: 1 });
      expect(timeline.keyframes.map((k) => k.progress)).toEqual([0, 0.5, 1]);
    });

    it('replaces existing keyframe at same progress', () => {
      const timeline = createTimeline('test', 1000, { kind: 'linear' });
      addKeyframe(timeline, 0, { x: 0 });
      addKeyframe(timeline, 0, { x: 10 });
      expect(timeline.keyframes).toHaveLength(1);
      expect(timeline.keyframes[0]!.values.x).toBe(10);
    });
  });

  describe('interpolateValue', () => {
    it('linearly interpolates numbers', () => {
      expect(interpolateValue(0, 100, 0.5, 'linear')).toBe(50);
      expect(interpolateValue(0, 100, 0.25, 'linear')).toBe(25);
      expect(interpolateValue(100, 200, 0.75, 'linear')).toBe(175);
    });

    it('interpolates with ease-in', () => {
      // At t=0.5, ease-in (t^2) = 0.25
      const result = interpolateValue(0, 100, 0.5, 'easeIn');
      expect(result).toBe(25);
    });

    it('interpolates arrays element-wise', () => {
      const result = interpolateValue([0, 0, 0], [10, 20, 30], 0.5, 'linear');
      expect(result).toEqual([5, 10, 15]);
    });

    it('interpolates objects with matching keys', () => {
      const from = { x: 0, y: 0, opacity: 0 };
      const to = { x: 100, y: 200, opacity: 1 };
      const result = interpolateValue(from, to, 0.5, 'linear');
      expect(result).toEqual({ x: 50, y: 100, opacity: 0.5 });
    });

    it('handles identical from/to values', () => {
      expect(interpolateValue(50, 50, 0.5, 'linear')).toBe(50);
    });
  });

  describe('sampleAt', () => {
    it('returns start keyframe values at t=0', () => {
      const timeline = createTimeline('fade', 1000, { kind: 'linear' });
      addKeyframe(timeline, 0, { opacity: 0 });
      addKeyframe(timeline, 1, { opacity: 1 });
      const result = sampleAt(timeline, 0);
      expect(result).toEqual({ opacity: 0 });
    });

    it('returns end keyframe values at t=1', () => {
      const timeline = createTimeline('fade', 1000, { kind: 'linear' });
      addKeyframe(timeline, 0, { opacity: 0 });
      addKeyframe(timeline, 1, { opacity: 1 });
      const result = sampleAt(timeline, 1);
      expect(result).toEqual({ opacity: 1 });
    });

    it('interpolates between keyframes at t=0.5', () => {
      const timeline = createTimeline('move', 1000, { kind: 'linear' });
      addKeyframe(timeline, 0, { x: 0, y: 0 });
      addKeyframe(timeline, 1, { x: 100, y: 200 });
      const result = sampleAt(timeline, 0.5);
      expect(result).toEqual({ x: 50, y: 100 });
    });

    it('interpolates across multiple keyframes', () => {
      const timeline = createTimeline('complex', 2000, { kind: 'linear' });
      addKeyframe(timeline, 0, { x: 0 });
      addKeyframe(timeline, 0.5, { x: 50 });
      addKeyframe(timeline, 1, { x: 200 });
      const result = sampleAt(timeline, 0.25);
      expect(result).toEqual({ x: 25 });
    });

    it('returns the nearest keyframe value when t is between keyframes', () => {
      const timeline = createTimeline('steps', 1000, { kind: 'linear' });
      addKeyframe(timeline, 0, { opacity: 0 });
      addKeyframe(timeline, 0.5, { opacity: 0.5 });
      addKeyframe(timeline, 1, { opacity: 1 });
      const result = sampleAt(timeline, 0.75);
      expect(result).toEqual({ opacity: 0.75 });
    });

    it('throws when sampling empty timeline', () => {
      const timeline = createTimeline('empty', 1000, { kind: 'linear' });
      expect(() => sampleAt(timeline, 0.5)).toThrow();
    });
  });
});
