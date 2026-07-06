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
    const hash = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 0, 0], 1, '');
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
});
