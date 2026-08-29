import {
  addChild,
  addNode,
  createDocument,
  type Document,
  makeFrameNode,
  makeShapeNode,
  type NodeId,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import { describe, expect, it, vi } from 'vitest';
import { nodeWorldTransform } from '../scene/world';
import type { NudgeContext } from './nudge';
import { canNudge, executeNudge, getNudgeDisabledReason, getNudgeStep } from './nudge';

const EPSILON = 1e-8;

function rect(id: string, x: number, y: number) {
  return makeShapeNode(
    id,
    { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
    { name: id, transform: [1, 0, 0, 1, x, y] },
  );
}

function makeCtx(
  document: Document,
  selection: NodeId[],
): NudgeContext & {
  setNodePositions: ReturnType<typeof vi.fn>;
  setNodePosition: ReturnType<typeof vi.fn>;
} {
  return {
    document,
    selection,
    getNode: (id) => document.nodes[id],
    setNodePosition: vi.fn(),
    setNodePositions: vi.fn(),
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
});
