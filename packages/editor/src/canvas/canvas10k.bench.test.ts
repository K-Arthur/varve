/**
 * Canvas draw-path performance benchmarks — viewport culling + IR build at scale.
 */
import { createDocument, makeShapeNode } from '@strata/scene';
import { isWorldRectInViewport } from '@strata/shared';
import { describe, expect, it } from 'vitest';
import { nodeWorldBounds } from '../scene/world';

describe('canvas 10k bench', () => {
  it('viewport cull 10k nodes under 500ms', () => {
    let doc = createDocument('bench', true);
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
      doc = {
        ...doc,
        nodes: { ...doc.nodes, [id]: node },
        rootChildren: [...doc.rootChildren, id],
      };
      ids.push(id);
    }

    const cam = { pan: { x: 0, y: 0 }, zoom: 1, rotation: 0 };
    const vp = { width: 1200, height: 800 };

    const t0 = performance.now();
    let visible = 0;
    for (const id of ids) {
      const b = nodeWorldBounds(doc, id);
      if (b && isWorldRectInViewport(cam, vp, b)) visible++;
    }
    const elapsed = performance.now() - t0;

    expect(visible).toBeGreaterThan(0);
    expect(visible).toBeLessThan(ids.length);
    expect(elapsed).toBeLessThan(500);
  });
});
