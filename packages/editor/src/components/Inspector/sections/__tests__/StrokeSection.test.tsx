// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

describe('StrokeSection isLineOrPath', () => {
  function isLineOrPath(n: { kind: string; shape?: { kind: string } }): boolean {
    if (n.kind !== 'shape') return false;
    const s = n.shape;
    if (!s) return false;
    return s.kind === 'line' || s.kind === 'arrow' || s.kind === 'path';
  }

  it('returns true for line shapes', () => {
    expect(isLineOrPath({ kind: 'shape', shape: { kind: 'line' } })).toBe(true);
  });

  it('returns true for arrow shapes', () => {
    expect(isLineOrPath({ kind: 'shape', shape: { kind: 'arrow' } })).toBe(true);
  });

  it('returns true for path shapes', () => {
    expect(isLineOrPath({ kind: 'shape', shape: { kind: 'path' } })).toBe(true);
  });

  it('returns false for rect shapes', () => {
    expect(isLineOrPath({ kind: 'shape', shape: { kind: 'rect' } })).toBe(false);
  });

  it('returns false for frame nodes', () => {
    expect(isLineOrPath({ kind: 'frame' })).toBe(false);
  });

  it('returns false for text nodes', () => {
    expect(isLineOrPath({ kind: 'text' })).toBe(false);
  });
});
