import { describe, expect, it } from 'vitest';
import {
  parsePropertyPath,
  getNestedValue,
  setNestedValue,
  INTERPOLABLE_PROPERTIES,
} from './property-path';

describe('parsePropertyPath', () => {
  it('parses simple property', () => {
    expect(parsePropertyPath('opacity')).toEqual(['opacity']);
  });

  it('parses nested dotted property', () => {
    expect(parsePropertyPath('shape.w')).toEqual(['shape', 'w']);
  });

  it('parses array index with brackets', () => {
    expect(parsePropertyPath('transform[4]')).toEqual(['transform', '4']);
  });

  it('parses deeply nested path', () => {
    expect(parsePropertyPath('fills[0].color')).toEqual(['fills', '0', 'color']);
  });

  it('parses multiple array indices', () => {
    expect(parsePropertyPath('strokes[0].dashPattern[1]')).toEqual([
      'strokes',
      '0',
      'dashPattern',
      '1',
    ]);
  });

  it('returns empty array for empty string', () => {
    expect(parsePropertyPath('')).toEqual([]);
  });

  it('handles plain dot notation without brackets', () => {
    expect(parsePropertyPath('fills.color.r')).toEqual(['fills', 'color', 'r']);
  });
});

describe('getNestedValue', () => {
  const obj = {
    opacity: 0.5,
    shape: { w: 100, h: 200 },
    fills: [{ color: [255, 0, 0, 255] }],
    transform: [1, 0, 0, 1, 50, 50],
  };

  it('gets a top-level property', () => {
    expect(getNestedValue(obj, ['opacity'])).toBe(0.5);
  });

  it('gets a nested property', () => {
    expect(getNestedValue(obj, ['shape', 'w'])).toBe(100);
  });

  it('gets an array indexed property', () => {
    expect(getNestedValue(obj, ['fills', '0', 'color'])).toEqual([255, 0, 0, 255]);
  });

  it('gets a transform element', () => {
    expect(getNestedValue(obj, ['transform', '4'])).toBe(50);
  });

  it('returns undefined for missing property', () => {
    expect(getNestedValue(obj, ['nonexistent'])).toBeUndefined();
  });

  it('returns undefined for deep missing path', () => {
    expect(getNestedValue(obj, ['shape', 'z', 'x'])).toBeUndefined();
  });

  it('returns undefined for null object', () => {
    expect(getNestedValue(null, ['a'])).toBeUndefined();
  });
});

describe('setNestedValue', () => {
  it('sets a top-level property', () => {
    const result = setNestedValue({ a: 1 }, ['a'], 2);
    expect(result.a).toBe(2);
  });

  it('sets a nested property immutably', () => {
    const original = { shape: { w: 100, h: 200 } };
    const result = setNestedValue(original, ['shape', 'w'], 150);
    expect(original.shape.w).toBe(100);
    expect(result.shape.w).toBe(150);
    expect(result.shape.h).toBe(200);
  });

  it('creates intermediate objects for deep paths', () => {
    const result = setNestedValue({}, ['a', 'b', 'c'], 42);
    expect(result.a.b.c).toBe(42);
  });

  it('sets array index', () => {
    const original = { fills: [{ color: [255, 0, 0, 255] }] };
    const result = setNestedValue(original, ['fills', '0', 'color'], [0, 0, 255, 255]);
    expect(result.fills[0].color).toEqual([0, 0, 255, 255]);
    expect(original.fills[0].color).toEqual([255, 0, 0, 255]);
  });

  it('returns a shallow copy when path is empty', () => {
    const original = { a: 1 };
    const result = setNestedValue(original, [], 99);
    expect(result).toEqual({ a: 1 });
    expect(result).not.toBe(original);
  });
});

describe('INTERPOLABLE_PROPERTIES', () => {
  it('lists basic animatable properties', () => {
    expect(INTERPOLABLE_PROPERTIES.opacity).toBe('number');
    expect(INTERPOLABLE_PROPERTIES.rotation).toBe('number');
    expect(INTERPOLABLE_PROPERTIES['fill[0]']).toBe('number');
  });

  it('lists shape properties', () => {
    expect(INTERPOLABLE_PROPERTIES['shape.w']).toBe('number');
    expect(INTERPOLABLE_PROPERTIES['shape.points']).toBe('path');
  });

  it('lists frame properties', () => {
    expect(INTERPOLABLE_PROPERTIES.w).toBe('number');
    expect(INTERPOLABLE_PROPERTIES.h).toBe('number');
  });

  it('lists text properties', () => {
    expect(INTERPOLABLE_PROPERTIES.fontSize).toBe('number');
    expect(INTERPOLABLE_PROPERTIES.letterSpacing).toBe('number');
  });
});
