import { describe, expect, it } from 'vitest';
import { cloneStrokesWithFreshIds, normalizeStrokeIds } from './strokeIdentity';
import type { Stroke } from './types';

const stroke = (overrides: Partial<Stroke> = {}): Stroke =>
  ({
    color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    weight: 2,
    align: 'center',
    dashPattern: [],
    dashOffset: 0,
    cap: 'round',
    join: 'miter',
    miterLimit: 4,
    visible: true,
    ...overrides,
  }) as Stroke;

describe('stroke identity', () => {
  it('normalizes legacy strokes to deterministic identities', () => {
    const normalized = normalizeStrokeIds('node-7', [stroke(), stroke()]);
    expect(normalized?.map((entry) => entry.id)).toEqual(['stroke-node-7-0', 'stroke-node-7-1']);
    expect(normalizeStrokeIds('node-7', [stroke(), stroke()])).toEqual(normalized);
  });

  it('preserves authored IDs and disambiguates duplicates without changing values', () => {
    const normalized = normalizeStrokeIds('node-7', [stroke({ id: 'ink' }), stroke({ id: 'ink' })]);
    expect(normalized?.map((entry) => entry.id)).toEqual(['ink', 'ink-2']);
    expect(normalized?.map((entry) => entry.weight)).toEqual([2, 2]);
  });

  it('gives copied stroke stacks independent identities', () => {
    const source = [stroke({ id: 'source-1' }), stroke({ id: 'source-2' })];
    const copied = cloneStrokesWithFreshIds(source);
    expect(copied.map((entry) => entry.id)).not.toEqual(source.map((entry) => entry.id));
    expect(copied.map((entry) => entry.weight)).toEqual(source.map((entry) => entry.weight));
  });
});
