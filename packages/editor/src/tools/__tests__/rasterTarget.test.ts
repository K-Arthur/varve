import { makeRasterLayerNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { findEditableRasterLayer } from '../rasterTarget';
import type { ToolContext } from '../types';

function makeContext(
  overrides: Partial<ToolContext> = {},
  transforms: Record<string, [number, number, number, number, number, number]> = {},
): ToolContext {
  const bounded = makeRasterLayerNode('bounded', { width: 80, height: 60 });
  return {
    document: {
      nodes: { bounded },
      rootChildren: ['bounded'],
    } as unknown as ToolContext['document'],
    selection: [],
    getWorldTransform: (id) => transforms[id] ?? [1, 0, 0, 1, 0, 0],
    ...overrides,
  } as ToolContext;
}

describe('findEditableRasterLayer', () => {
  it('uses an unselected raster fallback only when the pointer is inside its bounds', () => {
    const ctx = makeContext();

    expect(findEditableRasterLayer(ctx, { x: 20, y: 30 })).toBe('bounded');
    expect(findEditableRasterLayer(ctx, { x: 81, y: 30 })).toBeNull();
    expect(findEditableRasterLayer(ctx, { x: 20, y: 61 })).toBeNull();
  });

  it('checks transformed raster bounds in local coordinates', () => {
    const ctx = makeContext({}, { bounded: [0, 1, -1, 0, 100, 50] });

    expect(findEditableRasterLayer(ctx, { x: 70, y: 60 })).toBe('bounded');
    expect(findEditableRasterLayer(ctx, { x: 70, y: 140 })).toBeNull();
  });

  it('keeps explicit selected-layer semantics outside the raster bounds', () => {
    const ctx = makeContext({ selection: ['bounded'] });

    expect(findEditableRasterLayer(ctx, { x: 800, y: 900 })).toBe('bounded');
  });

  it('continues searching after a bounded fallback that does not cover the pointer', () => {
    const first = makeRasterLayerNode('first', { width: 20, height: 20 });
    const second = makeRasterLayerNode('second', { width: 80, height: 60 });
    const ctx = makeContext({
      document: {
        nodes: { first, second },
        rootChildren: ['first', 'second'],
      } as unknown as ToolContext['document'],
    });

    expect(findEditableRasterLayer(ctx, { x: 40, y: 30 })).toBe('second');
  });
});
