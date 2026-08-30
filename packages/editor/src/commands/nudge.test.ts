import {
  addChild,
  addNode,
  createDocument,
  type Document,
  makeFrameNode,
  makeGroupNode,
  makeImageNode,
  makeShapeNode,
  makeTextNode,
  type NodeId,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import { describe, expect, it, vi } from 'vitest';
import { nodeWorldTransform } from '../scene/world';
import {
  canNudge,
  createNudgeGestureSession,
  executeNudge,
  getNudgeDisabledReason,
  getNudgeStep,
  planNudge,
  planNudgeRepeat,
} from './nudge';

const EPSILON = 1e-8;

function rect(id: string, x: number, y: number) {
  return makeShapeNode(
    id,
    { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
    { name: id, transform: [1, 0, 0, 1, x, y] },
  );
}

function makeCtx(document: Document, selection: NodeId[]) {
  const setNodePosition = vi.fn<(id: NodeId, x: number, y: number) => void>();
  const setNodePositions =
    vi.fn<(positions: ReadonlyArray<{ id: NodeId; x: number; y: number }>) => void>();
  return {
    document,
    selection,
    setNodePosition,
    setNodePositions,
  };
}

function positionsFrom(ctx: ReturnType<typeof makeCtx>) {
  const positions = ctx.setNodePositions.mock.calls[0]?.[0];
  return positions ?? [];
}

function withPositions(
  document: Document,
  positions: ReadonlyArray<{ id: NodeId; x: number; y: number }>,
): Document {
  const nodes = { ...document.nodes };
  for (const { id, x, y } of positions) {
    const node = nodes[id];
    if (!node) continue;
    const transform = node.transform ?? ([1, 0, 0, 1, 0, 0] as Affine);
    nodes[id] = {
      ...node,
      transform: [transform[0], transform[1], transform[2], transform[3], x, y] as Affine,
    };
  }
  return { ...document, nodes };
}

function worldOrigin(document: Document, id: NodeId) {
  const transform = nodeWorldTransform(document, id);
  return { x: transform[4], y: transform[5] };
}

function expectClose(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(EPSILON);
}

describe('getNudgeStep', () => {
  it('returns the canonical document-space increments', () => {
    expect(getNudgeStep('standard')).toBe(1);
    expect(getNudgeStep('large')).toBe(10);
    expect(getNudgeStep('fine')).toBe(0.5);
  });
});

describe('canNudge / getNudgeDisabledReason', () => {
  it('requires a selection', () => {
    expect(canNudge(['a'])).toBe(true);
    expect(canNudge([])).toBe(false);
    expect(getNudgeDisabledReason([])).toBe('No selection');
    expect(getNudgeDisabledReason(['a'])).toBeNull();
  });
});

describe('executeNudge', () => {
  it('moves an untransformed root exactly one document unit', () => {
    let document = createDocument('root nudge');
    const node = rect('node', 100.25, -3.75);
    document = addNode(document, node);
    const ctx = makeCtx(document, [node.id]);
    const before = worldOrigin(document, node.id);

    const result = executeNudge('right', getNudgeStep('standard'), ctx);
    const after = worldOrigin(withPositions(document, positionsFrom(ctx)), node.id);

    expectClose(after.x - before.x, 1);
    expectClose(after.y - before.y, 0);
    expect(positionsFrom(ctx)).toEqual([{ id: node.id, x: 101.25, y: -3.75 }]);
    expect(result).toEqual({ moved: 1, locked: 0, skipped: 0, total: 1 });
  });

  it('moves an empty transform container without requiring drawable bounds', () => {
    let document = createDocument('empty group nudge');
    const group = makeGroupNode('empty-group', { transform: [1, 0, 0, 1, 12, -4] });
    document = addNode(document, group);
    const ctx = makeCtx(document, [group.id]);
    const before = worldOrigin(document, group.id);

    executeNudge('down', 10, ctx);
    const after = worldOrigin(withPositions(document, positionsFrom(ctx)), group.id);

    expectClose(after.x - before.x, 0);
    expectClose(after.y - before.y, 10);
  });

  it('moves a rotated selected object along document axes without changing its rotation', () => {
    let document = createDocument('rotated selected node');
    const theta = Math.PI / 4;
    const node = {
      ...rect('node', 100, 100),
      transform: [
        Math.cos(theta),
        Math.sin(theta),
        -Math.sin(theta),
        Math.cos(theta),
        100,
        100,
      ] as Affine,
    };
    document = addNode(document, node);
    const ctx = makeCtx(document, [node.id]);
    const before = worldOrigin(document, node.id);

    executeNudge('right', 1, ctx);
    const afterDoc = withPositions(document, positionsFrom(ctx));
    const after = worldOrigin(afterDoc, node.id);

    expectClose(after.x - before.x, 1);
    expectClose(after.y - before.y, 0);
    expect(afterDoc.nodes[node.id]?.transform.slice(0, 4)).toEqual(node.transform.slice(0, 4));
  });

  it('converts a world delta through a rotated, non-uniformly scaled parent', () => {
    let document = createDocument('transformed parent');
    const theta = Math.PI / 6;
    const parent = makeFrameNode('parent', {
      w: 300,
      h: 200,
      transform: [
        Math.cos(theta) * 2,
        Math.sin(theta) * 2,
        -Math.sin(theta) * 3,
        Math.cos(theta) * 3,
        400,
        -20,
      ],
    });
    const child = rect('child', 25, 30);
    document = addNode(document, parent);
    document = addChild(document, parent.id, child);
    const ctx = makeCtx(document, [child.id]);
    const before = worldOrigin(document, child.id);

    executeNudge('right', 1, ctx);
    const after = worldOrigin(withPositions(document, positionsFrom(ctx)), child.id);

    expectClose(after.x - before.x, 1);
    expectClose(after.y - before.y, 0);
  });

  it('reuses a held-key session without changing transformed-parent nudge geometry', () => {
    let document = createDocument('nudge repeat session');
    const theta = Math.PI / 6;
    const parent = makeFrameNode('parent', {
      w: 300,
      h: 200,
      transform: [
        Math.cos(theta) * 2,
        Math.sin(theta) * 2,
        -Math.sin(theta) * 3,
        Math.cos(theta) * 3,
        400,
        -20,
      ],
    });
    const child = rect('child', 25, 30);
    document = addNode(document, parent);
    document = addChild(document, parent.id, child);
    const selection = [child.id];
    const first = planNudge('right', 1, document, selection);
    const session = createNudgeGestureSession(document, selection, first);
    expect(session).not.toBeNull();

    document = withPositions(document, first.positions);
    const repeated = planNudgeRepeat(session!, 'down', 10, document, selection);

    expect(repeated).toEqual(planNudge('down', 10, document, selection));
  });

  it('falls back from a held-key session when an ancestor changes', () => {
    let document = createDocument('nudge repeat invalidation');
    const parent = makeFrameNode('parent', { w: 200, h: 100 });
    const child = rect('child', 10, 20);
    document = addNode(document, parent);
    document = addChild(document, parent.id, child);
    const selection = [child.id];
    const first = planNudge('right', 1, document, selection);
    const session = createNudgeGestureSession(document, selection, first);
    document = withPositions(document, first.positions);
    document = {
      ...document,
      nodes: { ...document.nodes, [parent.id]: { ...parent, locked: true } },
    };

    expect(planNudgeRepeat(session!, 'right', 1, document, selection)).toBeNull();
  });

  it('preserves a cross-container multi-selection’s world-space spacing', () => {
    let document = createDocument('cross-container nudge');
    const frameA = makeFrameNode('frame-a', {
      w: 300,
      h: 200,
      transform: [0.8660254, 0.5, -0.5, 0.8660254, 100, 80],
    });
    const frameB = makeFrameNode('frame-b', {
      w: 300,
      h: 200,
      transform: [-1.5, 0, 0, 0.75, 500, 240],
    });
    const a = rect('a', 20, 40);
    const b = rect('b', 50, 60);
    document = addNode(document, frameA);
    document = addNode(document, frameB);
    document = addChild(document, frameA.id, a);
    document = addChild(document, frameB.id, b);
    const ctx = makeCtx(document, [a.id, b.id]);
    const beforeA = worldOrigin(document, a.id);
    const beforeB = worldOrigin(document, b.id);

    executeNudge('down', 10, ctx);
    const afterDoc = withPositions(document, positionsFrom(ctx));
    const afterA = worldOrigin(afterDoc, a.id);
    const afterB = worldOrigin(afterDoc, b.id);

    expectClose(afterA.x - beforeA.x, 0);
    expectClose(afterA.y - beforeA.y, 10);
    expectClose(afterB.x - beforeB.x, 0);
    expectClose(afterB.y - beforeB.y, 10);
    expectClose(afterB.x - afterA.x, beforeB.x - beforeA.x);
    expectClose(afterB.y - afterA.y, beforeB.y - beforeA.y);
  });

  it('moves selected text and image objects without rewriting their content', () => {
    let document = createDocument('text and image nudge');
    const text = makeTextNode('text', 'Move me', {
      w: 120,
      h: 32,
      transform: [0, 1, -1, 0, 42, 55],
    });
    const image = makeImageNode('image', {
      src: 'asset://photo',
      imageFit: 'fill',
      w: 80,
      h: 60,
      transform: [1, 0, 0, 1, -12, 6],
    });
    document = addNode(document, text);
    document = addNode(document, image);
    const originalText = document.nodes[text.id]!;
    const originalImage = document.nodes[image.id]!;
    const ctx = makeCtx(document, [text.id, image.id]);

    executeNudge('up', 1, ctx);
    const afterDoc = withPositions(document, positionsFrom(ctx));
    const afterText = afterDoc.nodes[text.id]!;
    const afterImage = afterDoc.nodes[image.id]!;

    expect({ ...afterText, transform: originalText.transform }).toEqual(originalText);
    expect(afterText.transform).toEqual([0, 1, -1, 0, 42, 54]);
    expect({ ...afterImage, transform: originalImage.transform }).toEqual(originalImage);
    expect(afterImage.transform).toEqual([1, 0, 0, 1, -12, 5]);
  });

  it('moves only independent transform roots when a parent and child are selected', () => {
    let document = createDocument('parent child selection');
    const parent = makeFrameNode('parent', { w: 200, h: 100, transform: [1, 0, 0, 1, 40, 50] });
    const child = rect('child', 10, 20);
    document = addNode(document, parent);
    document = addChild(document, parent.id, child);
    const ctx = makeCtx(document, [parent.id, child.id]);
    const before = worldOrigin(document, child.id);

    const result = executeNudge('right', 1, ctx);
    const afterDoc = withPositions(document, positionsFrom(ctx));
    const after = worldOrigin(afterDoc, child.id);

    expect(positionsFrom(ctx)).toEqual([{ id: parent.id, x: 41, y: 50 }]);
    expect(afterDoc.nodes[child.id]?.transform).toEqual(child.transform);
    expectClose(after.x - before.x, 1);
    expectClose(after.y - before.y, 0);
    expect(result).toEqual({ moved: 1, locked: 0, skipped: 1, total: 2 });
  });

  it('does not bypass an ancestor lock', () => {
    let document = createDocument('ancestor lock');
    const parent = makeFrameNode('parent', {
      w: 200,
      h: 100,
      locked: true,
      transform: [1, 0, 0, 1, 40, 50],
    });
    const child = rect('child', 10, 20);
    document = addNode(document, parent);
    document = addChild(document, parent.id, child);
    const ctx = makeCtx(document, [child.id]);

    const result = executeNudge('right', 1, ctx);

    expect(positionsFrom(ctx)).toEqual([]);
    expect(result).toEqual({ moved: 0, locked: 1, skipped: 0, total: 1 });
  });

  it('does not bypass an ancestor visibility lockout', () => {
    let document = createDocument('ancestor hidden');
    const parent = {
      ...makeFrameNode('parent', { w: 200, h: 100, transform: [1, 0, 0, 1, 40, 50] }),
      visible: false,
    };
    const child = rect('child', 10, 20);
    document = addNode(document, parent);
    document = addChild(document, parent.id, child);
    const ctx = makeCtx(document, [child.id]);

    const result = executeNudge('right', 1, ctx);

    expect(ctx.setNodePositions).not.toHaveBeenCalled();
    expect(result).toEqual({ moved: 0, locked: 1, skipped: 0, total: 1 });
  });

  it('leaves flow-managed auto-layout children untouched but moves absolute children', () => {
    let document = createDocument('layout eligibility');
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
    const flow = rect('flow', 0, 0);
    const absolute = { ...rect('absolute', 80, 0), layoutPosition: 'absolute' as const };
    document = addNode(document, parent);
    document = addChild(document, parent.id, flow);
    document = addChild(document, parent.id, absolute);
    const ctx = makeCtx(document, [flow.id, absolute.id]);

    const result = executeNudge('right', 1, ctx);

    expect(positionsFrom(ctx)).toEqual([{ id: absolute.id, x: 81, y: 0 }]);
    expect(result).toEqual({ moved: 1, locked: 0, skipped: 1, total: 2 });
  });

  it('skips missing nodes without mutating', () => {
    const document = createDocument('missing node');
    const ctx = makeCtx(document, ['missing']);

    const result = executeNudge('right', 1, ctx);

    expect(positionsFrom(ctx)).toEqual([]);
    expect(result).toEqual({ moved: 0, locked: 0, skipped: 1, total: 1 });
  });

  it('rejects a child of a non-invertible parent without producing invalid positions', () => {
    let document = createDocument('singular parent');
    const parent = makeFrameNode('parent', { w: 200, h: 100, transform: [0, 0, 0, 1, 40, 50] });
    const child = rect('child', 10, 20);
    document = addNode(document, parent);
    document = addChild(document, parent.id, child);
    const ctx = makeCtx(document, [child.id]);

    const result = executeNudge('right', 1, ctx);

    expect(ctx.setNodePositions).not.toHaveBeenCalled();
    expect(result).toEqual({ moved: 0, locked: 0, skipped: 1, total: 1 });
  });

  it('rejects malformed world transforms without producing invalid positions', () => {
    let document = createDocument('malformed rotation');
    const node = { ...rect('node', 10, 20), rotation: Number.NaN };
    document = addNode(document, node);
    const ctx = makeCtx(document, [node.id]);

    const result = executeNudge('right', 1, ctx);

    expect(ctx.setNodePositions).not.toHaveBeenCalled();
    expect(result).toEqual({ moved: 0, locked: 0, skipped: 1, total: 1 });
  });

  it('rejects malformed cyclic ancestry without producing invalid positions', () => {
    const base = createDocument('cyclic ancestry');
    const parent = makeGroupNode('parent', { children: ['child'] });
    const child = makeGroupNode('child', { children: ['parent'] });
    const document = {
      ...base,
      nodes: { ...base.nodes, [parent.id]: parent, [child.id]: child },
      rootChildren: [parent.id],
    };
    const ctx = makeCtx(document, [parent.id]);

    const result = executeNudge('right', 1, ctx);

    expect(ctx.setNodePositions).not.toHaveBeenCalled();
    expect(result).toEqual({ moved: 0, locked: 0, skipped: 1, total: 1 });
  });
});
