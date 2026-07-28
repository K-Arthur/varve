/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { applyPropertyPath } from './propertyPath';

describe('applyPropertyPath', () => {
  it('sets top-level properties', () => {
    const target: Record<string, unknown> = { opacity: 0 };
    applyPropertyPath(target, 'opacity', 0.5);
    expect(target.opacity).toBe(0.5);
  });

  it('sets nested object properties', () => {
    const target: Record<string, unknown> = { fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } };
    applyPropertyPath(target, 'fill.r', 128);
    expect(target.fill).toEqual({ space: 'rgb', r: 128, g: 0, b: 0, a: 255 });
  });

  it('sets array indices', () => {
    const target: Record<string, unknown> = { transform: [1, 0, 0, 1, 0, 0] };
    applyPropertyPath(target, 'transform[4]', 100);
    expect(target.transform).toEqual([1, 0, 0, 1, 100, 0]);
  });

  it('sets nested array object properties', () => {
    const target: Record<string, unknown> = {
      fills: [{ type: 'solid', color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } }],
    };
    applyPropertyPath(target, 'fills[0].color.r', 255);
    expect(target.fills).toEqual([
      { type: 'solid', color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
    ]);
  });

  it('does not mutate the original nested object', () => {
    const original = { space: 'rgb', r: 0, g: 0, b: 0, a: 255 };
    const target: Record<string, unknown> = { fill: original };
    applyPropertyPath(target, 'fill.r', 128);
    expect(original.r).toBe(0);
  });

  it('does not mutate the original array', () => {
    const original = [1, 0, 0, 1, 0, 0];
    const target: Record<string, unknown> = { transform: original };
    applyPropertyPath(target, 'transform[4]', 100);
    expect(original[4]).toBe(0);
  });
});
