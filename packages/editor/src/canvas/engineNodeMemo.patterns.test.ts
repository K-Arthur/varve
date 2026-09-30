import type { SceneNode as EngineNode } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { EngineNodeMemo } from './engineNodeMemo';

describe('EngineNodeMemo pattern definition invalidation', () => {
  it('rebuilds linked fill conversion when a shared definition changes', () => {
    const memo = new EngineNodeMemo();
    const source = { id: 'shape-1' };
    const world = [1, 0, 0, 1, 0, 0];
    const result = {
      id: 'shape-1',
      name: 'shape-1',
      transform: [1, 0, 0, 1, 0, 0],
    } as unknown as EngineNode;

    memo.beginFrame(undefined, undefined, undefined, '', { pattern: { revision: 1 } });
    memo.set('shape-1', source, world, result);

    memo.beginFrame(undefined, undefined, undefined, '', { pattern: { revision: 2 } });

    expect(memo.get('shape-1', source, world)).toBeUndefined();
  });
});
