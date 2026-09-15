import { createAreaSelection } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { deserializeAreaSelection, serializeAreaSelection } from './savedAreaSelections';

describe('saved area selection persistence', () => {
  it('round-trips analytical and raster coverage without sharing mutable bytes', () => {
    const selection = createAreaSelection({
      kind: 'raster-mask',
      x: 4,
      y: 5,
      w: 2,
      h: 2,
      width: 2,
      height: 2,
      data: new Uint8Array([0, 64, 192, 255]),
      boundary: [],
      transform: [1, 0, 0, 1, 4, 5],
      inverseTransform: [1, 0, 0, 1, -4, -5],
      feather: 0,
      antialias: false,
    });
    expect(selection).not.toBeNull();
    const saved = serializeAreaSelection(selection!);
    const restored = deserializeAreaSelection({
      id: 'saved-1',
      name: 'Selection 1',
      selection: saved,
      createdAt: 1,
    });
    expect(restored?.expression).toMatchObject({
      kind: 'shape',
      shape: { kind: 'raster-mask', x: 4, y: 5, width: 2, height: 2 },
    });
    if (restored?.expression.kind !== 'shape' || restored.expression.shape.kind !== 'raster-mask') {
      return;
    }
    expect([...restored.expression.shape.data]).toEqual([0, 64, 192, 255]);
    expect(restored.expression.shape.data).not.toBe((selection!.expression as any).shape.data);
  });
});
