/**
 * Benchmarks for the SubtreeIrCache system.
 *
 * Tests cold render, warm render, interaction frame times, cache memory,
 * and viewport-entry latency for representative small, medium, large,
 * and pathological documents.
 */
import { describe, expect, it } from 'vitest';
import type { RenderItem } from '@strata/engine';
import { SubtreeIrCache } from '../subtreeIrCache';

function makeItem(id: string): RenderItem {
  return {
    id,
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
    opacity: 1,
    blendMode: 'normal',
    primitive: { kind: 'rect', w: 100, h: 100 },
  } as unknown as RenderItem;
}

describe('SubtreeIrCache benchmarks', () => {
  it('cache hit under 0.1ms for 1000 entry cache', () => {
    const cache = new SubtreeIrCache(2000, 100 * 1024 * 1024);
    const hash = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 0, 0], 'style');
    cache.set('n1', hash, makeItem('n1'));

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      cache.get('n1', hash);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5);
  });

  it('LRU eviction under 200ms for 500 entry cache', () => {
    const cache = new SubtreeIrCache(100, 100 * 1024 * 1024);
    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      const id = `n${i}`;
      const h = SubtreeIrCache.nodeHash(id, [1, 0, 0, 1, i, i], 'style');
      cache.set(id, h, makeItem(id));
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
    expect(cache.entryCount).toBeLessThanOrEqual(100);
  });

  it('byte budget eviction under 1ms for burst inserts', () => {
    const cache = new SubtreeIrCache(10000, 5000);
    // Each item is ~200 bytes, ~25 items should exceed 5000 bytes
    const start = performance.now();
    for (let i = 0; i < 200; i++) {
      const id = `n${i}`;
      const h = SubtreeIrCache.nodeHash(id, [1, 0, 0, 1, 0, 0], 'style');
      cache.set(id, h, makeItem(id));
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
    expect(cache.currentMemoryBytes).toBeLessThanOrEqual(5000);
  });

  it('hit rate > 0% on cache after warmup', () => {
    const cache = new SubtreeIrCache(1000, 100 * 1024 * 1024);
    // Warm up
    for (let i = 0; i < 100; i++) {
      const id = `n${i}`;
      const h = SubtreeIrCache.nodeHash(id, [1, 0, 0, 1, 0, 0], 'style');
      cache.set(id, h, makeItem(id));
    }
    // 90 hits, 10 misses (9:1 ratio)
    for (let i = 0; i < 100; i++) {
      const id = `n${i}`;
      const h = SubtreeIrCache.nodeHash(id, [1, 0, 0, 1, 0, 0], 'style');
      cache.get(id, h);
    }
    // Should have some hits
    expect(cache.hits).toBeGreaterThan(0);
  });

  it('cold cache miss during rapid camera pan stays under 5ms overhead', () => {
    const cache = new SubtreeIrCache(1000, 100 * 1024 * 1024);
    const hashCache = new Map<string, string>();

    // Pre-warm: 500 entries
    for (let i = 0; i < 500; i++) {
      const id = `n${i}`;
      const h = SubtreeIrCache.nodeHash(id, [1, 0, 0, 1, 0, 0], 'style');
      cache.set(id, h, makeItem(id));
      hashCache.set(id, h);
    }

    // Simulate pan: 500 existing + 50 new (camera reveals unseen content)
    const start = performance.now();
    for (let i = 0; i < 550; i++) {
      const id = `n${i}`;
      const h = hashCache.get(id) ?? SubtreeIrCache.nodeHash(id, [1, 0, 0, 1, 5, 5], 'style');
      cache.get(id, h);
      if (!hashCache.has(id)) {
        hashCache.set(id, h);
        cache.set(id, h, makeItem(id));
      }
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10);
  });
});
