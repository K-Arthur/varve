import { describe, expect, it } from 'vitest';
import type { AdjustmentNode, NodeId, SceneNode } from './types';
import {
  repairDocument,
  validateAndRepairDocument,
  validateDocument,
  type DocumentLike,
} from './document-utils';

function leaf(id: NodeId): SceneNode {
  return { kind: 'shape', id, name: id, visible: true } as unknown as SceneNode;
}

function baseDoc(): DocumentLike {
  return {
    rootChildren: ['a', 'b'],
    nodes: { a: leaf('a'), b: leaf('b') },
  };
}

function hasComponentId(n: SceneNode): n is SceneNode & { componentId: NodeId } {
  return 'componentId' in n;
}

describe('validateDocument — reference integrity (section 8/128)', () => {
  it('passes a clean document', () => {
    const result = validateDocument(baseDoc());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('flags an adjustment with a dangling scope target', () => {
    const doc = baseDoc();
    const adj = {
      kind: 'adjustment',
      id: 'adj',
      name: 'adj',
      visible: true,
      scope: { mode: 'explicit-targets', targetNodeIds: ['missing'] as NodeId[] },
    } as unknown as SceneNode;
    doc.nodes.adj = adj;
    doc.rootChildren.push('adj');

    const result = validateDocument(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('adj') && e.includes('missing'))).toBe(true);
  });

  it('flags an effect mask whose source node is missing', () => {
    const doc = baseDoc();
    const c = {
      kind: 'shape',
      id: 'c',
      name: 'c',
      visible: true,
      effects: [
        {
          id: 'e1',
          type: 'blur',
          mask: { source: { kind: 'scene-node', nodeId: 'ghost' as NodeId }, type: 'alpha' },
        },
      ],
    } as unknown as SceneNode;
    doc.nodes.c = c;
    doc.rootChildren.push('c');

    const result = validateDocument(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('effect[0]') && e.includes('ghost'))).toBe(true);
  });

  it('flags a component instance whose master node is missing', () => {
    const doc = baseDoc();
    const d = {
      kind: 'group',
      id: 'd',
      name: 'd',
      visible: true,
      children: [] as NodeId[],
      componentId: 'ghost' as NodeId,
    } as unknown as SceneNode;
    doc.nodes.d = d;
    doc.rootChildren.push('d');

    const result = validateDocument(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('component instance') && e.includes('ghost'))).toBe(
      true,
    );
  });

  it('validates deeply nested trees without using the call stack', () => {
    const depth = 4000;
    const nodes: Record<NodeId, SceneNode> = {};
    for (let i = depth - 1; i >= 0; i -= 1) {
      const id = `g${i}` as NodeId;
      nodes[id] = {
        kind: 'group',
        id,
        name: id,
        visible: true,
        children: i === depth - 1 ? ['leaf'] : [`g${i + 1}`],
      } as unknown as SceneNode;
    }
    nodes.leaf = leaf('leaf');

    expect(() => validateDocument({ rootChildren: ['g0'], nodes })).not.toThrow();
    expect(validateDocument({ rootChildren: ['g0'], nodes }).valid).toBe(true);
  });

  it('reports a deep containment cycle without overflowing', () => {
    const depth = 2500;
    const nodes: Record<NodeId, SceneNode> = {};
    for (let i = depth - 1; i >= 0; i -= 1) {
      const id = `g${i}` as NodeId;
      nodes[id] = {
        kind: 'group',
        id,
        name: id,
        visible: true,
        children: [i === depth - 1 ? 'g0' : `g${i + 1}`],
      } as unknown as SceneNode;
    }

    const result = validateDocument({ rootChildren: ['g0'], nodes });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('Cycle detected'))).toBe(true);
  });
});

describe('repairDocument — safe neutralization of dangling references', () => {
  it('repairs a dangling explicit-targets adjustment scope and re-validates', () => {
    const doc = baseDoc();
    const adj = {
      kind: 'adjustment',
      id: 'adj',
      name: 'adj',
      visible: true,
      scope: { mode: 'explicit-targets', targetNodeIds: ['missing'] as NodeId[] },
    } as unknown as SceneNode;
    doc.nodes.adj = adj;
    doc.rootChildren.push('adj');

    const { doc: repaired, changed } = repairDocument(doc);
    expect(changed).toBe(true);
    expect(validateDocument(repaired).valid).toBe(true);

    const adjNode = repaired.nodes.adj as AdjustmentNode;
    expect(adjNode.scope?.mode).toBe('document');
  });

  it('drops a dangling effect-mask binding but keeps the effect', () => {
    const doc = baseDoc();
    const c = {
      kind: 'shape',
      id: 'c',
      name: 'c',
      visible: true,
      effects: [
        {
          id: 'e1',
          type: 'blur',
          mask: { source: { kind: 'scene-node', nodeId: 'ghost' as NodeId }, type: 'alpha' },
        },
      ],
    } as unknown as SceneNode;
    doc.nodes.c = c;
    doc.rootChildren.push('c');

    const { doc: repaired } = repairDocument(doc);
    const fixed = repaired.nodes.c! as SceneNode & { effects: Array<{ mask?: unknown }> };
    expect(fixed.effects[0]?.mask).toBeUndefined();
  });

  it('clears a dangling component master reference', () => {
    const doc = baseDoc();
    const d = {
      kind: 'group',
      id: 'd',
      name: 'd',
      visible: true,
      children: [] as NodeId[],
      componentId: 'ghost' as NodeId,
    } as unknown as SceneNode;
    doc.nodes.d = d;
    doc.rootChildren.push('d');

    const { doc: repaired } = repairDocument(doc);
    expect(hasComponentId(repaired.nodes.d!)).toBe(false);
  });

  it('repairs a dangling live matte source', () => {
    const doc = baseDoc();
    doc.nodes.a = {
      ...doc.nodes.a,
      mask: {
        type: 'alpha',
        visible: true,
        matteSource: { kind: 'scene-node', nodeId: 'ghost' as NodeId },
      },
    } as unknown as SceneNode;

    const { doc: repaired, changed } = repairDocument(doc);
    expect(changed).toBe(true);
    expect(repaired.nodes.a?.mask).toBeUndefined();
    expect(validateDocument(repaired).valid).toBe(true);
  });

  it('uses component definitions rather than treating component ids as node ids', () => {
    const doc = baseDoc();
    doc.components = { button: { masterRootId: 'a' } };
    doc.nodes.b = {
      ...doc.nodes.b,
      kind: 'frame',
      children: [],
      componentId: 'button',
    } as unknown as SceneNode;

    expect(validateDocument(doc).valid).toBe(true);
  });

  it('does not mutate the input document', () => {
    const doc = baseDoc();
    const adj = {
      kind: 'adjustment',
      id: 'adj',
      name: 'adj',
      visible: true,
      scope: { mode: 'explicit-targets', targetNodeIds: ['missing'] as NodeId[] },
    } as unknown as SceneNode;
    doc.nodes.adj = adj;
    doc.rootChildren.push('adj');

    const snapshot = JSON.stringify(doc);
    repairDocument(doc);
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it('validateAndRepairDocument returns a doc that re-validates clean', () => {
    const doc = baseDoc();
    const adj = {
      kind: 'adjustment',
      id: 'adj',
      name: 'adj',
      visible: true,
      scope: { mode: 'image-local', targetNodeId: 'missing' as NodeId },
    } as unknown as SceneNode;
    doc.nodes.adj = adj;
    doc.rootChildren.push('adj');

    const { result, repaired } = validateAndRepairDocument(doc);
    expect(result.valid).toBe(false);
    expect(repaired.changed).toBe(true);
    expect(validateDocument(repaired.doc).valid).toBe(true);
  });
});
