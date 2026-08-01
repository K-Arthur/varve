/**
 * Regression guard for SubtreeIrCache eviction cost.
 *
 * evictIfNeeded used to re-sort the entire entry map on every single eviction,
 * so shedding K entries cost K × O(n log n). Any document with more nodes than
 * maxEntries sits permanently over the entry cap, which makes every set()
 * evict — so this ran on the drag hot path, not just on document load.
 *
 * Measured on the dev machine (contended): filling a 500-entry cache with 4000
 * items cost 1050ms before and 9.2ms after. The bound below is deliberately
 * generous — it exists to catch reintroduction of the quadratic shape, not to
 * act as a performance budget, because wall-clock on a loaded machine is noisy.
 */

import type { RenderItem } from '@strata/engine';
import { describe, expect, it } from 'vitest';
import { SubtreeIrCache } from './subtreeIrCache';

const item = (id: string): RenderItem =>
  ({ kind: 'rect', id, x: 0, y: 0, w: 10, h: 10 }) as unknown as RenderItem;

/**
 * Count comparator invocations made by Array.prototype.sort during `run`.
 *
 * This is the deterministic form of the guard: eviction is now O(1) per entry
 * off the front of an LRU-ordered Map, so it must not sort at all. A wall-clock
 * assertion was tried first and rejected — on a contended machine the ratio
 * between two sample sizes swung between 4x and 10x, which would have made the
 * guard flaky rather than protective.
 */
function countSortComparisons(run: () => void): number {
  const original = Array.prototype.sort;
  let comparisons = 0;
  // biome-ignore lint/complexity/useArrowFunction: needs `this` binding
  Array.prototype.sort = function <T>(this: T[], cmp?: (a: T, b: T) => number) {
    return original.call(
      this,
      cmp
        ? (a: T, b: T) => {
            comparisons++;
            return cmp(a, b);
          }
        : undefined,
    );
  } as typeof Array.prototype.sort;
  try {
    run();
  } finally {
    Array.prototype.sort = original;
  }
  return comparisons;
}

describe('SubtreeIrCache eviction cost', () => {
  it('evicts without sorting, however far past capacity it is filled', () => {
    const comparisons = countSortComparisons(() => {
      const cache = new SubtreeIrCache(500, 50 * 1024 * 1024);
      for (let i = 0; i < 4000; i++) cache.set(`n${i}`, `h${i}`, item(`n${i}`));
    });
    expect(comparisons).toBe(0);
  });

  it('keeps the entry cap while filling far past it', () => {
    const cache = new SubtreeIrCache(500, 50 * 1024 * 1024);
    for (let i = 0; i < 4000; i++) cache.set(`n${i}`, `h${i}`, item(`n${i}`));
    expect(cache.diagnostics().entries).toBeLessThanOrEqual(500);
  });

  it('evicts least-recently-used entries first', () => {
    const cache = new SubtreeIrCache(3, 50 * 1024 * 1024);
    cache.set('a', 'ha', item('a'));
    cache.set('b', 'hb', item('b'));
    cache.set('c', 'hc', item('c'));
    // Touch 'a' so 'b' becomes the least-recently-used entry.
    expect(cache.get('a', 'ha')).not.toBeNull();
    cache.set('d', 'hd', item('d'));

    expect(cache.get('b', 'hb')).toBeNull();
    expect(cache.get('a', 'ha')).not.toBeNull();
    expect(cache.get('c', 'hc')).not.toBeNull();
    expect(cache.get('d', 'hd')).not.toBeNull();
  });

  it('honours the entry cap exactly', () => {
    const cache = new SubtreeIrCache(10, 50 * 1024 * 1024);
    for (let i = 0; i < 100; i++) cache.set(`n${i}`, `h${i}`, item(`n${i}`));
    expect(cache.diagnostics().entries).toBe(10);
  });
});
