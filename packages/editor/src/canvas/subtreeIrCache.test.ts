import type { RenderItem } from '@strata/engine';
import { describe, expect, it } from 'vitest';
import { SubtreeIrCache } from './subtreeIrCache';

describe('SubtreeIrCache', () => {
  it('returns cached item when hash matches', () => {
    const cache = new SubtreeIrCache();
    const item = {
      id: 'n1',
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
      opacity: 1,
      blendMode: 'normal' as const,
      primitive: { kind: 'rect' as const, w: 10, h: 10 },
    } as unknown as RenderItem;
    const hash = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 0, 0], '');
    cache.set('n1', hash, item);
    expect(cache.get('n1', hash)).toEqual(item);
  });

  it('misses when hash changes', () => {
    const cache = new SubtreeIrCache();
    const item = {
      id: 'n1',
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
      opacity: 1,
      blendMode: 'normal' as const,
      primitive: { kind: 'rect' as const, w: 10, h: 10 },
    } as unknown as RenderItem;
    cache.set('n1', 'hash-a', item);
    expect(cache.get('n1', 'hash-b')).toBeNull();
  });

  it('invalidates all entries', () => {
    const cache = new SubtreeIrCache();
    const item = {
      id: 'n1',
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
      opacity: 1,
      blendMode: 'normal' as const,
      primitive: { kind: 'rect' as const, w: 10, h: 10 },
    } as unknown as RenderItem;
    cache.set('n1', 'h', item);
    cache.invalidate();
    expect(cache.get('n1', 'h')).toBeNull();
  });

  describe('nodeHash', () => {
    it('is stable for identical content across separate calls', () => {
      // CanvasArea.tsx computes a fresh hash on every draw pass and looks it
      // up against the previous pass's stored hash — an unrelated node's
      // hash must stay IDENTICAL across two edits elsewhere in the document
      // for that node's cache entry to ever be reused. Regression coverage
      // for a bug where a global, ever-incrementing docVersion was mixed
      // into every node's hash, so any edit anywhere invalidated every
      // other node's entry too, defeating selective invalidation entirely.
      const a = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 5, 5], 'style-a', ['rect', '10', '10']);
      const b = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 5, 5], 'style-a', ['rect', '10', '10']);
      expect(a).toBe(b);
    });

    it('changes when transform, styleKey, or content parts differ', () => {
      const base = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 0, 0], 'style-a', ['rect']);
      const movedTransform = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 9, 0], 'style-a', ['rect']);
      const differentStyle = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 0, 0], 'style-b', ['rect']);
      const differentContent = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 0, 0], 'style-a', [
        'ellipse',
      ]);
      expect(movedTransform).not.toBe(base);
      expect(differentStyle).not.toBe(base);
      expect(differentContent).not.toBe(base);
    });
  });
});
