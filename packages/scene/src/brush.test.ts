/**
 * Tests for the brush stroke model.
 */
import { describe, expect, it } from 'vitest';
import {
  clampBrushPreset,
  defaultBrushPreset,
  generateDabs,
  getActivePreset,
  isBuiltInPreset,
  makeBrushStroke,
  migrateBrushPreset,
  OneEuroFilter,
  oneEuroFilterPoint,
  pointDistance,
  rebuildStrokeDabs,
  smoothStrokePoints,
  strokeBounds,
  strokeDirection,
  strokePoint,
  validateBrushPreset,
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
    expect(smoothed[2]?.x).toBe(20);
  });

  it('pulls points toward previous with high factor', () => {
    const points = [strokePoint(0, 0), strokePoint(10, 0), strokePoint(20, 0)];
    const smoothed = smoothStrokePoints(points, 0.9);
    expect(smoothed[2]?.x).toBeLessThan(20);
    expect(smoothed[2]?.x).toBeGreaterThan(0);
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
    expect(dabs[0]?.x).toBe(5);
    expect(dabs[0]?.y).toBe(5);
    expect(dabs[0]?.radius).toBe(preset.radius);
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

describe('OneEuroFilter', () => {
  it('returns identity on first sample', () => {
    const filter = new OneEuroFilter(1.0, 0.007, 1.0);
    const result = filter.filter(100, 200, 0);
    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
    expect(result.dx).toBe(0);
  });

  it('produces identity at zero velocity with beta=0', () => {
    const filter = new OneEuroFilter(0.5, 0.0, 1.0);
    let t = 0;
    for (let i = 0; i < 5; i++) {
      t += 16;
      const sp = strokePoint(100, 200, { time: t });
      const filtered = oneEuroFilterPoint(sp, filter);
      expect(filtered.x).toBe(100);
    }
  });

  it('tracks movement with velocity-dependent smoothing', () => {
    const filter = new OneEuroFilter(1.0, 0.5, 1.0);
    let t = 0;
    const results: Array<{ x: number }> = [];
    for (let i = 0; i < 5; i++) {
      t += 16;
      const sp = strokePoint(100 + i * 10, 200, { time: t });
      const filtered = oneEuroFilterPoint(sp, filter);
      results.push({ x: filtered.x });
    }
    expect(results[results.length - 1]!.x).toBeGreaterThan(120);
  });

  it('reset clears all state', () => {
    const filter = new OneEuroFilter(1.0, 0.5, 1.0);
    filter.filter(100, 200, 0);
    filter.reset();
    const result = filter.filter(300, 400, 16);
    expect(result.x).toBe(300);
    expect(result.dx).toBe(0);
  });
});

describe('brush preset validation', () => {
  it('validateBrushPreset rejects non-objects', () => {
    expect(validateBrushPreset(null)).toBeNull();
    expect(validateBrushPreset(42)).toBeNull();
  });

  it('validateBrushPreset clamps out-of-range radius', () => {
    const result = validateBrushPreset({ id: 't1', name: 'T1', shape: 'circle', radius: 2000 });
    expect(result).not.toBeNull();
    expect(result!.radius).toBe(1000);
  });

  it('validateBrushPreset fills missing fields with defaults', () => {
    const result = validateBrushPreset({ id: 't2', name: 'T2', shape: 'circle', radius: 10 });
    expect(result).not.toBeNull();
    expect(result!.blendMode).toBe('normal');
  });

  it('isBuiltInPreset returns true for built-in presets', () => {
    expect(isBuiltInPreset('built-in-round')).toBe(true);
    expect(isBuiltInPreset('built-in-eraser')).toBe(true);
    expect(isBuiltInPreset('unknown')).toBe(false);
  });

  it('migrateBrushPreset fills missing fields', () => {
    const result = migrateBrushPreset({
      id: 'custom',
      name: 'Custom',
      shape: 'circle',
      radius: 20,
    });
    expect(result).not.toBeNull();
    expect(result!.id).toBe('custom');
    expect(result!.radius).toBe(20);
  });

  it('getActivePreset falls back to built-in', () => {
    const doc = { brushPresets: {} } as never;
    const preset = getActivePreset(doc, 'nonexistent');
    expect(preset.id).toBe('built-in-round');
  });

  it('clampBrushPreset clamps range fields', () => {
    const p = defaultBrushPreset('test', 'Test');
    p.radius = 2000;
    const clamped = clampBrushPreset(p);
    expect(clamped.radius).toBe(1000);
  });
});
