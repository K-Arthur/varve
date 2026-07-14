import { makeFrameNode, makeGroupNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { canCullDescendantsWithContainerBounds } from './containerCulling';

describe('canCullDescendantsWithContainerBounds', () => {
  it('does not cull descendants of an unclipped frame that may overflow into view', () => {
    expect(
      canCullDescendantsWithContainerBounds(
        makeFrameNode('frame', { w: 100, h: 100, clipContent: false }),
      ),
    ).toBe(false);
  });

  it('can cull clipped frames and groups whose bounds include descendants', () => {
    expect(canCullDescendantsWithContainerBounds(makeFrameNode('frame', { w: 100, h: 100 }))).toBe(
      true,
    );
    expect(canCullDescendantsWithContainerBounds(makeGroupNode('group'))).toBe(true);
  });
});
