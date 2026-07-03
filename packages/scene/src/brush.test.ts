/**
 * Tests for the brush stroke model.
 */
import { describe, expect, it } from 'vitest';
import {
  defaultBrushPreset,
  generateDabs,
  makeBrushStroke,
  pointDistance,
  rebuildStrokeDabs,
  smoothStrokePoints,
  strokeBounds,
  strokeDirection,
  strokePoint,
} from './brush';

describe('defaultBrushPreset', () => {
  it('creates a usable round brush', () => {
    const preset = defaultBrushPreset('p1', 'Round');
    expect(preset.id).toBe('p1');
    expect(preset.name).toBe('Round');
    expect(preset.shape).toBe('circle');
    expect(preset.radius).toBe(10);
    expect(preset.spacing).toBe(0.25);
    expect(preset.smoothing).toBe(0.5);
  });
});

describe('strokePoint', () => {
  it('creates a point with defaults', () => {
    const p = strokePoint(10, 20);
    expect(p.x).toBe(10);
    expect(p.y).toBe(20);
    expect(p.pressure).toBe(1);
    expect(p.tilt).toBe(0);
  });

  it('applies overrides', () => {
    const p = strokePoint(0, 0, { pressure: 0.5, speed: 100 });
    expect(p.pressure).toBe(0.5);
    expect(p.speed).toBe(100);
  });
});

describe('pointDistance', () => {
  it('measures 3-4-5 triangle', () => {
    const a = strokePoint(0, 0);
    const b = strokePoint(3, 4);
    expect(pointDistance(a, b)).toBe(5);
  });
});

describe('strokeDirection', () => {
  it('returns horizontal right for (0,0)->(10,0)', () => {
    const a = strokePoint(0, 0);
    const b = strokePoint(10, 0);
    expect(strokeDirection(a, b)).toBe(0);
  });

  it('returns vertical down for (0,0)->(0,10)', () => {
    const a = strokePoint(0, 0);
    const b = strokePoint(0, 10);
    expect(strokeDirection(a, b)).toBeCloseTo(Math.PI / 2, 5);
  });
});

describe('smoothStrokePoints', () => {
  it('returns identity when factor is 0', () => {
    const points = [strokePoint(0, 0), strokePoint(10, 0), strokePoint(20, 0)];
    const smoothed = smoothStrokePoints(points, 0);
    expect(smoothed[2]!.x).toBe(20);
  });

  it('pulls points toward previous with high factor', () => {
    const points = [strokePoint(0, 0), strokePoint(10, 0), strokePoint(20, 0)];
    const smoothed = smoothStrokePoints(points, 0.9);
    expect(smoothed[2]!.x).toBeLessThan(20);
    expect(smoothed[2]!.x).toBeGreaterThan(0);
  });
});

describe('generateDabs', () => {
  it('returns empty for no points', () => {
    const preset = defaultBrushPreset('p2', 'Round');
    expect(generateDabs([], preset)).toEqual([]);
  });

  it('returns one dab for a single point', () => {
    const preset = defaultBrushPreset('p3', 'Round');
    const dabs = generateDabs([strokePoint(5, 5)], preset);
    expect(dabs.length).toBe(1);
    expect(dabs[0]!.x).toBe(5);
    expect(dabs[0]!.y).toBe(5);
    expect(dabs[0]!.radius).toBe(preset.radius);
  });

  it('spaces dabs by spacing * diameter', () => {
    const preset = defaultBrushPreset('p4', 'Round');
    preset.radius = 10;
    preset.spacing = 0.5;
    // 100 px line with spacing 10 px should yield ~10 dabs
    const points = [strokePoint(0, 0), strokePoint(100, 0)];
    const dabs = generateDabs(points, preset);
    expect(dabs.length).toBeGreaterThanOrEqual(8);
    expect(dabs.length).toBeLessThanOrEqual(12);
  });

  it('decreases dabs when spacing increases', () => {
    const preset = defaultBrushPreset('p5', 'Round');
    preset.radius = 10;
    const points = [strokePoint(0, 0), strokePoint(100, 0)];
    const few = generateDabs(points, { ...preset, spacing: 1 });
    const many = generateDabs(points, { ...preset, spacing: 0.25 });
    expect(few.length).toBeLessThan(many.length);
  });
});

describe('strokeBounds', () => {
  it('computes bounds around dabs', () => {
    const preset = defaultBrushPreset('p6', 'Round');
    preset.radius = 10;
    const points = [strokePoint(0, 0), strokePoint(50, 0)];
    const dabs = generateDabs(points, preset);
    const bounds = strokeBounds(dabs);
    expect(bounds.x).toBeLessThanOrEqual(-5);
    expect(bounds.y).toBeLessThanOrEqual(-10);
    expect(bounds.w).toBeGreaterThanOrEqual(60);
    expect(bounds.h).toBeGreaterThanOrEqual(20);
  });
});

describe('rebuildStrokeDabs', () => {
  it('rebuilds dabs and bounds for a stroke', () => {
    const preset = defaultBrushPreset('p7', 'Round');
    let stroke = makeBrushStroke('s1', 'p7', [0, 0, 0, 255]);
    stroke = { ...stroke, points: [strokePoint(0, 0), strokePoint(40, 0)] };
    const rebuilt = rebuildStrokeDabs(stroke, preset);
    expect(rebuilt.dabs.length).toBeGreaterThan(0);
    expect(rebuilt.bounds.w).toBeGreaterThan(0);
  });
});
