import { describe, expect, it } from 'vitest';
import type { Affine } from './affine';
import {
  interpolateAffine,
  interpolateColor,
  interpolatePath,
  interpolateSpatialBezier,
  interpolateValue,
} from './interpolation';

describe('interpolateValue', () => {
  it('interpolates numbers linearly', () => {
    expect(interpolateValue(0, 100, 0.5)).toBe(50);
    expect(interpolateValue(0, 100, 0)).toBe(0);
    expect(interpolateValue(0, 100, 1)).toBe(100);
    expect(interpolateValue(-50, 50, 0.25)).toBe(-25);
  });

  it('returns from value when t=0', () => {
    expect(interpolateValue(42, 100, 0)).toBe(42);
  });

  it('returns to value when t=1', () => {
    expect(interpolateValue(42, 100, 1)).toBe(100);
  });

  it('handles negative numbers', () => {
    expect(interpolateValue(-100, 100, 0.5)).toBe(0);
  });

  it('returns identical values without computation', () => {
    const obj = { a: 1 };
    expect(interpolateValue(obj, obj, 0.5)).toBe(obj);
  });

  it('falls back to discrete for non-numeric, non-array, non-object', () => {
    expect(interpolateValue('hello', 'world', 0)).toBe('hello');
    expect(interpolateValue('hello', 'world', 1)).toBe('world');
    expect(interpolateValue('hello', 'world', 0.4)).toBe('hello');
    expect(interpolateValue('hello', 'world', 0.6)).toBe('world');
  });

  it('interpolates null to null', () => {
    expect(interpolateValue(null, null, 0.5)).toBeNull();
  });
});

describe('interpolateColor', () => {
  it('interpolates between hex colors', () => {
    const result = interpolateColor('#ff0000', '#0000ff', 0.5) as string;
    expect(result.startsWith('#')).toBe(true);
    // Returns format matching input (6-char hex when inputs have no alpha)
    expect([7, 9]).toContain(result.length);
  });

  it('interpolates RGBA tuples', () => {
    const result = interpolateColor([255, 0, 0, 255], [0, 0, 255, 255], 0.5);
    expect(result).toEqual([127.5, 0, 127.5, 255]);
  });

  it('returns from value at t=0', () => {
    expect(interpolateColor('#ff0000', '#0000ff', 0)).toBe('#ff0000');
  });

  it('returns to value at t=1', () => {
    expect(interpolateColor('#ff0000', '#0000ff', 1)).toBe('#0000ff');
  });

  it('returns from array value at t=0', () => {
    expect(interpolateColor([255, 0, 0, 255], [0, 0, 255, 255], 0)).toEqual([255, 0, 0, 255]);
  });

  it('interpolates with alpha channel', () => {
    const result = interpolateColor([255, 0, 0, 0], [0, 0, 255, 255], 0.5) as number[];
    expect(result[3]).toBe(127.5);
  });

  it('handles hex shorthand without alpha', () => {
    const result = interpolateColor('#ff0000', '#0000ff', 0.5) as string;
    // Without alpha input, output is 6-char hex
    expect(result.length).toBe(7);
  });

  it('includes alpha in output when input has alpha', () => {
    const result = interpolateColor('#ff0000ff', '#0000ffff', 0.5) as string;
    expect(result.length).toBe(9);
  });
});

describe('interpolateAffine', () => {
  it('interpolates between two affine transforms', () => {
    const from: Affine = [1, 0, 0, 1, 0, 0];
    const to: Affine = [2, 0, 0, 2, 100, 100];
    const result = interpolateAffine(from, to, 0.5);
    expect(result[0]).toBeCloseTo(1.5);
    expect(result[4]).toBeCloseTo(50);
    expect(result[5]).toBeCloseTo(50);
  });

  it('returns identity at t=0', () => {
    const from: Affine = [1, 0, 0, 1, 0, 0];
    const to: Affine = [2, 0, 0, 2, 100, 100];
    const result = interpolateAffine(from, to, 0);
    expect(result).toEqual(from);
  });

  it('returns target at t=1', () => {
    const from: Affine = [1, 0, 0, 1, 0, 0];
    const to: Affine = [2, 0, 0, 2, 100, 100];
    const result = interpolateAffine(from, to, 1);
    expect(result).toEqual(to);
  });

  it('handles negative scale/position', () => {
    const from: Affine = [-1, 0, 0, -1, -50, -50];
    const to: Affine = [1, 0, 0, 1, 50, 50];
    const result = interpolateAffine(from, to, 0.5);
    expect(result[0]).toBeCloseTo(0);
    expect(result[4]).toBeCloseTo(0);
  });
});

describe('interpolatePath', () => {
  it('interpolates between path point arrays with matching vertex count', () => {
    const from = [
      { x: 0, y: 0, handleIn: null, handleOut: null },
      { x: 100, y: 100, handleIn: null, handleOut: null },
    ];
    const to = [
      { x: 50, y: 50, handleIn: null, handleOut: null },
      { x: 200, y: 0, handleIn: null, handleOut: null },
    ];
    const result = interpolatePath(from, to, 0.5);
    expect(result[0]?.x).toBe(25);
    expect(result[0]?.y).toBe(25);
    expect(result[1]?.x).toBe(150);
    expect(result[1]?.y).toBe(50);
  });

  it('interpolates bezier handles', () => {
    const from = [{ x: 0, y: 0, handleIn: null, handleOut: { x: 50, y: 0 } }];
    const to = [{ x: 100, y: 100, handleIn: null, handleOut: { x: 0, y: 50 } }];
    const result = interpolatePath(from, to, 0.5);
    expect(result[0]?.handleOut?.x).toBe(25);
    expect(result[0]?.handleOut?.y).toBe(25);
  });

  it('throws on mismatched vertex count', () => {
    const from = [{ x: 0, y: 0, handleIn: null, handleOut: null }];
    const to = [
      { x: 0, y: 0, handleIn: null, handleOut: null },
      { x: 100, y: 100, handleIn: null, handleOut: null },
    ];
    expect(() => interpolatePath(from, to, 0.5)).toThrow('vertex count mismatch');
  });

  it('handles null handles gracefully', () => {
    const from = [{ x: 0, y: 0, handleIn: null, handleOut: null }];
    const to = [{ x: 100, y: 100, handleIn: null, handleOut: null }];
    const result = interpolatePath(from, to, 0.5);
    expect(result[0]?.handleIn).toBeNull();
    expect(result[0]?.handleOut).toBeNull();
  });

  it('handles partial handles (from has handle, to does not)', () => {
    const from = [{ x: 0, y: 0, handleIn: { x: -10, y: 0 }, handleOut: { x: 10, y: 0 } }];
    const to = [{ x: 100, y: 100, handleIn: null, handleOut: null }];
    const result = interpolatePath(from, to, 0.5);
    expect(result[0]?.handleIn).toBeNull();
    expect(result[0]?.handleOut).toBeNull();
  });
});

describe('interpolateArray', () => {
  it('interpolates element-wise for numeric arrays', () => {
    const result = interpolateValue([0, 10], [100, 20], 0.5);
    expect(result).toEqual([50, 15]);
  });

  it('interpolates mixed-type arrays', () => {
    const from = [{ x: 0 }, { y: 10 }];
    const to = [{ x: 100 }, { y: 20 }];
    const r = interpolateValue(from, to, 0.5) as Array<Record<string, unknown>>;
    const r0 = r[0] as Record<string, unknown>;
    const r1 = r[1] as Record<string, unknown>;
    expect(r0.x).toBe(50);
    expect(r1.y).toBe(15);
  });

  it('handles arrays of different lengths', () => {
    const result = interpolateValue([1, 2, 3], [10, 20], 0.5) as number[];
    expect(result).toEqual([5.5, 11]);
  });

  it('handles empty arrays', () => {
    const result = interpolateValue([], [], 0.5);
    expect(result).toEqual([]);
  });
});

describe('interpolateObject', () => {
  it('interpolates matching keys', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 200 };
    const result = interpolateValue(from, to, 0.5) as Record<string, unknown>;
    expect(result.x).toBe(50);
    expect(result.y).toBe(100);
  });

  it('handles partial key overlap', () => {
    const from = { x: 0, y: 10 };
    const to = { x: 100, z: 20 };
    const result = interpolateValue(from, to, 0.5) as Record<string, unknown>;
    expect(result.x).toBe(50); // interpolated
    // y and z: discrete at midpoint
    expect(result.y).toBe(10);
    expect(result.z).toBe(20);
  });

  it('handles nested objects', () => {
    const from = { position: { x: 0, y: 0 } };
    const to = { position: { x: 100, y: 200 } };
    const result = interpolateValue(from, to, 0.5) as Record<string, unknown>;
    expect((result.position as Record<string, unknown>).x).toBe(50);
    expect((result.position as Record<string, unknown>).y).toBe(100);
  });
});

describe('interpolateSpatialBezier', () => {
  it('interpolates array positions along a cubic bezier curve', () => {
    const from = [0, 0];
    const to = [100, 0];
    const fromTangent = { ti: [0, 0] as [number, number], to: [50, 100] as [number, number] };
    const toTangent = { ti: [50, -100] as [number, number], to: [0, 0] as [number, number] };
    const result = interpolateSpatialBezier(from, to, 0.5, fromTangent, toTangent) as number[];
    expect(result[0]).toBe(50);
    expect(result[1]).toBe(75);
  });

  it('returns from position at t=0', () => {
    const from = [10, 20];
    const to = [100, 200];
    const fromT = { ti: [0, 0] as [number, number], to: [30, 40] as [number, number] };
    const toT = { ti: [10, 10] as [number, number], to: [0, 0] as [number, number] };
    const result = interpolateSpatialBezier(from, to, 0, fromT, toT) as number[];
    expect(result[0]).toBe(10);
    expect(result[1]).toBe(20);
  });

  it('returns to position at t=1', () => {
    const from = [10, 20];
    const to = [100, 200];
    const fromT = { ti: [0, 0] as [number, number], to: [30, 40] as [number, number] };
    const toT = { ti: [10, 10] as [number, number], to: [0, 0] as [number, number] };
    const result = interpolateSpatialBezier(from, to, 1, fromT, toT) as number[];
    expect(result[0]).toBe(100);
    expect(result[1]).toBe(200);
  });

  it('interpolates object {x, y} positions', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 0 };
    const fromT = { ti: [0, 0] as [number, number], to: [50, 100] as [number, number] };
    const toT = { ti: [50, -100] as [number, number], to: [0, 0] as [number, number] };
    const result = interpolateSpatialBezier(from, to, 0.5, fromT, toT) as Record<string, number>;
    expect(result.x).toBe(50);
    expect(result.y).toBe(75);
  });

  it('with zero tangents produces linear interpolation', () => {
    const from = [0, 0];
    const to = [100, 200];
    const zeroT = { ti: [0, 0] as [number, number], to: [0, 0] as [number, number] };
    const result = interpolateSpatialBezier(from, to, 0.5, zeroT, zeroT) as number[];
    expect(result[0]).toBe(50);
    expect(result[1]).toBe(100);
  });

  it('falls back to interpolateValue for non-2D values', () => {
    const result = interpolateSpatialBezier(
      0,
      100,
      0.5,
      { ti: [0, 0], to: [0, 0] },
      { ti: [0, 0], to: [0, 0] },
    );
    expect(result).toBe(50);
  });

  it('produces a curved path with non-zero tangents', () => {
    const from = [0, 0];
    const to = [100, 0];
    const fromT = { ti: [0, 0] as [number, number], to: [0, 100] as [number, number] };
    const toT = { ti: [0, -100] as [number, number], to: [0, 0] as [number, number] };
    const mid = interpolateSpatialBezier(from, to, 0.5, fromT, toT) as number[];
    expect(mid[1]).toBeGreaterThan(0);
    expect(mid[0]).toBe(50);
  });
});
