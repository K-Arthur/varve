// @vitest-environment jsdom

import { createEngine } from '@varve/engine';
import type { SceneNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';

describe('image→pattern fill conversion IR (regression)', () => {
  it('flattens a pattern fill that also carries a stale image payload', async () => {
    const TILE = 'data:image/png;base64,AAAA';
    const node: SceneNode = {
      id: 'n1',
      name: 'Rect',
      kind: 'shape',
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      // Exact shape produced by converting Image → Pattern in the Inspector:
      // type switched, pattern set, but the image payload is retained
      // (per-type state preservation).
      fills: [
        {
          type: 'pattern',
          pattern: { tileSrc: TILE, spacing: 0, rotation: 0 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      transform: [1, 0, 0, 1, 0, 0],
      shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    const engine = await createEngine();
    const items = await engine.buildIr({ nodes: [node], paintOrder: ['n1'] });
    const fill = items[0]?.fills?.[0];
    expect(fill?.type).toBe('pattern');
    if (fill?.type === 'pattern') {
      expect(fill.tileSrc).toBe(TILE);
      expect(fill.spacing).toBe(0);
    }
  });
});
