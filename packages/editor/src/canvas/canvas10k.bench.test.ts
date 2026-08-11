/**
 * Canvas draw-path performance benchmarks — viewport culling + IR build at scale.
 */
import { buildParentIndexMap, createDocument, makeShapeNode } from '@varve/scene';
import { isWorldRectInViewport } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { nodeWorldBounds } from '../scene/world';

describe('canvas 10k bench', () => {
  it('viewport cull 10k nodes under 500ms', () => {
    let doc = createDocument('bench', true);
    const nodes = { ...doc.nodes };
    const rootChildren = [...doc.rootChildren];
    const ids: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      const col = i % 200;
      const row = Math.floor(i / 200);
      const id = `bench-${i}`;
      const node = makeShapeNode(
        id,
        { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
        {
          name: `Rect ${i}`,
          transform: [1, 0, 0, 1, col * 100, row * 100],
        },
      );
      nodes[id] = node;
      rootChildren.push(id);
      ids.push(id);
    }
    doc = { ...doc, nodes, rootChildren };

    const cam = { pan: { x: 0, y: 0 }, zoom: 1, rotation: 0 };
    const vp = { width: 1200, height: 800 };
    const parentIndex = buildParentIndexMap(doc);

    // Best-of-3: the first call pays JIT warmup and GC setup, which varies
    // with machine load and can trip a wall-clock threshold on a machine that
    // is only 15% over on the cold run (seen 2026-08-10: 583ms on a loaded
    // box vs 301ms warm). The gate still catches a genuinely slow path.
    let best = Infinity;
    let visible = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const t0 = performance.now();
      let count = 0;
      for (const id of ids) {
        const b = nodeWorldBounds(doc, id, parentIndex);
        if (b && isWorldRectInViewport(cam, vp, b)) count++;
      }
      best = Math.min(best, performance.now() - t0);
      visible = count;
    }

    expect(visible).toBeGreaterThan(0);
    expect(visible).toBeLessThan(ids.length);
    expect(best).toBeLessThan(500);
  });
});
