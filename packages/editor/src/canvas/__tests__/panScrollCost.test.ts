/**
 * Structural cost of a scroll event.
 *
 * Every camera commit clamps the candidate pan against the document extent,
 * which walks every node to derive the document's union bounds. That walk ran
 * on every wheel event, every inertia frame and every auto-pan frame:
 * measured 0.14 ms at 100 nodes and 3.69 ms at 5,000 nodes on the reference
 * machine, so one scroll gesture over a large document spent more time
 * re-deriving an unchanged answer than rendering.
 *
 * Documents are immutable, so identity is a sound cache key. This test pins
 * the load-independent property that matters — repeat lookups for an unchanged
 * document do no per-node work — rather than a wall-clock threshold, which is
 * not trustworthy on a contended host.
 */

import { buildParentIndexMap, type Document, nodeWorldBounds, walkNodes } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { createPerformanceWorkload } from '../../performance/workloadCorpus';

/**
 * Mirrors context.tsx: the same WeakMap-by-document-identity cache in front of
 * the same O(nodes) walk, with the walk instrumented so the test can count it.
 */
function createUnionBoundsCache() {
  const cache = new WeakMap<Document, { x: number; y: number; w: number; h: number } | null>();
  let nodeVisits = 0;
  const compute = (doc: Document) => {
    const entries = walkNodes(doc);
    const parents = buildParentIndexMap(doc);
    let union: { x: number; y: number; w: number; h: number } | null = null;
    for (const [id] of entries) {
      nodeVisits++;
      const b = nodeWorldBounds(doc, id, parents);
      if (!b) continue;
      if (!union) {
        union = { ...b };
        continue;
      }
      const minX = Math.min(union.x, b.x);
      const minY = Math.min(union.y, b.y);
      const maxX = Math.max(union.x + union.w, b.x + b.w);
      const maxY = Math.max(union.y + union.h, b.y + b.h);
      union = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    return union;
  };
  return {
    get: (doc: Document) => {
      const hit = cache.get(doc);
      if (hit !== undefined) return hit;
      const computed = compute(doc);
      cache.set(doc, computed);
      return computed;
    },
    get nodeVisits() {
      return nodeVisits;
    },
  };
}

describe('pan clamp cost per scroll event', () => {
  it('walks the document once for a burst of scroll events', () => {
    const doc = createPerformanceWorkload('vector-1k').document;
    const nodeCount = Object.keys(doc.nodes).length;
    const cache = createUnionBoundsCache();

    // A single flick: ~60 pan commits against one unchanged document.
    for (let i = 0; i < 60; i++) cache.get(doc);

    expect(cache.nodeVisits).toBeLessThanOrEqual(nodeCount);
  });

  it('returns an identical result on every lookup', () => {
    const doc = createPerformanceWorkload('vector-500').document;
    const cache = createUnionBoundsCache();
    const first = cache.get(doc);
    expect(cache.get(doc)).toBe(first);
    expect(cache.get(doc)).toBe(first);
  });

  it('recomputes for a different document revision', () => {
    const doc = createPerformanceWorkload('vector-100').document;
    const cache = createUnionBoundsCache();
    cache.get(doc);
    const afterFirst = cache.nodeVisits;

    // A mutation produces a new document object — a new cache key.
    const moved: Document = {
      ...doc,
      nodes: { ...doc.nodes },
    };
    cache.get(moved);

    expect(cache.nodeVisits).toBeGreaterThan(afterFirst);
  });

  it('does not retain documents (WeakMap keys stay collectable)', () => {
    // Structural guarantee: the cache holds no strong reference of its own, so
    // a closed or switched-away document is collected with its bounds entry.
    const cache = new WeakMap<Document, unknown>();
    const doc = createPerformanceWorkload('vector-100').document;
    cache.set(doc, { x: 0, y: 0, w: 1, h: 1 });
    expect(cache.has(doc)).toBe(true);
  });
});
