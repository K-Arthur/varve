import { addChild, addNode, createDocument, makeFrameNode, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { getNudgeCapability } from './nudgeCapability';

function rect(id: string, x = 0, y = 0) {
  return makeShapeNode(
    id,
    { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
    { name: id, transform: [1, 0, 0, 1, x, y] },
  );
}

describe('getNudgeCapability', () => {
  it('enables a selection containing at least one independent movable root', () => {
    let document = createDocument('mixed nudge selection');
    const movable = rect('movable', 10, 20);
    const locked = { ...rect('locked', 30, 40), locked: true };
    document = addNode(document, movable);
    document = addNode(document, locked);

    expect(getNudgeCapability(document, [movable.id, locked.id])).toEqual({
      canNudge: true,
      reason: null,
    });
  });

  it('disables a child whose ancestor is locked', () => {
    let document = createDocument('locked ancestor');
    const parent = makeFrameNode('parent', { w: 200, h: 100, locked: true });
    const child = rect('child', 10, 20);
    document = addNode(document, parent);
    document = addChild(document, parent.id, child);

    expect(getNudgeCapability(document, [child.id])).toEqual({
      canNudge: false,
      reason: 'Selected layers are locked or hidden',
    });
  });

  it('disables flow-managed children but permits absolute children in the same layout frame', () => {
    let document = createDocument('layout nudge capability');
    const parent = makeFrameNode('parent', {
      w: 300,
      h: 100,
      layoutStyle: {
        mode: 'flex',
        direction: 'row',
        gap: 8,
        wrap: false,
        padding: [0, 0, 0, 0],
        grow: 0,
        shrink: 0,
      },
    });
    const flow = rect('flow');
    const absolute = { ...rect('absolute', 50), layoutPosition: 'absolute' as const };
    document = addNode(document, parent);
    document = addChild(document, parent.id, flow);
    document = addChild(document, parent.id, absolute);

    expect(getNudgeCapability(document, [flow.id])).toEqual({
      canNudge: false,
      reason: 'Selected layers are layout-managed',
    });
    expect(getNudgeCapability(document, [absolute.id])).toEqual({
      canNudge: true,
      reason: null,
    });
  });
});
