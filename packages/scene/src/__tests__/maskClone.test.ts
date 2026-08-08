/**
 * deepCloneSubtree mask/scope remapping:
 *
 *  - in-document duplicate: the matte id and scope target ids must be
 *    remapped to the cloned copies
 *  - cross-document paste (dropForeignReferences): mask/scope references
 *    pointing outside the pasted subtree must be dropped, never left
 *    dangling against the source document's ids
 */
import { describe, expect, it } from 'vitest';
import {
  addMask,
  addNode,
  createDocument,
  deepCloneSubtree,
  makeAdjustmentNode,
  makeGroupNode,
  makeShapeNode,
  reparentNode,
  validateMasks,
} from '../index';

function nest(doc: import('../types').Document, childId: string, parentId: string, index: number) {
  return reparentNode(doc, childId, parentId, index);
}

function clipGroupFixture(): import('../types').Document {
  let doc = createDocument('clone-fixture', true);
  doc = addNode(doc, makeGroupNode('root', { children: [] }));
  doc = addNode(doc, makeGroupNode('g', { children: [] }));
  doc = addNode(doc, makeShapeNode('matte', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 }));
  doc = addNode(doc, makeShapeNode('content', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 }));
  doc = nest(doc, 'g', 'root', 0);
  doc = nest(doc, 'matte', 'g', 0);
  doc = nest(doc, 'content', 'g', 1);
  doc = addMask(doc, 'g', 'matte', 'clip', { hideMaskSource: true });
  return doc;
}

describe('deepCloneSubtree mask/scope remapping', () => {
  it('duplicate remaps the clip mask source to the cloned matte', () => {
    const doc = clipGroupFixture();
    const cloned = deepCloneSubtree(doc.nodes, doc.nextId, 'g');
    const newGroup = cloned.nodes[cloned.rootId];
    const newMask = (newGroup as { mask?: { sourceNodeId?: string } }).mask;
    const expectedMatteId = cloned.idMap.get('matte');
    expect(newMask?.sourceNodeId).toBe(expectedMatteId);
    // The cloned matte must be a child of the cloned group.
    const children = (newGroup as { children: string[] }).children;
    expect(children).toContain(expectedMatteId);
    expect(children).toContain(cloned.idMap.get('content'));
  });

  it('paste (dropForeign) releases a mask whose matte is outside the subtree', () => {
    const doc = clipGroupFixture();
    // Paste only the content node — its group (with the mask) is not part of
    // the pasted subtree, so nothing to drop here; instead paste the whole
    // group minus the matte via a two-node subtree:
    const subtree = { ...doc.nodes };
    delete subtree.matte;
    const content = subtree.content as { mask?: unknown };
    delete content?.mask;
    // Deep-clone the group whose mask references the now-missing matte.
    const cloned = deepCloneSubtree(subtree, doc.nextId, 'g', {
      dropForeignReferences: true,
    });
    const newGroup = cloned.nodes[cloned.rootId] as {
      mask?: { sourceNodeId?: string; type?: string };
    };
    expect(newGroup.mask).toBeUndefined();
  });

  it('paste keeps a vector mask but drops its foreign visual source', () => {
    const doc = clipGroupFixture();
    // Convert the clip group's mask to a vector mask + visual source combo.
    const withVector = {
      ...doc,
      nodes: {
        ...doc.nodes,
        g: {
          ...doc.nodes.g,
          mask: {
            type: 'clip' as const,
            visible: true,
            sourceNodeId: 'matte',
            vectorMask: {
              points: [
                { x: 0, y: 0 },
                { x: 50, y: 0 },
                { x: 50, y: 50 },
                { x: 0, y: 50 },
              ],
              closed: true,
              fillRule: 'nonzero' as const,
            },
          },
        },
      },
    };
    // Clone the group alone (matte outside the subtree).
    const nodesWithoutMatte = { ...withVector.nodes };
    delete nodesWithoutMatte.matte;
    const cloned = deepCloneSubtree(nodesWithoutMatte, withVector.nextId, 'g', {
      dropForeignReferences: true,
    });
    const newGroup = cloned.nodes[cloned.rootId] as {
      mask?: {
        sourceNodeId?: string;
        vectorMask?: { points: unknown[] };
        type?: string;
      };
    };
    expect(newGroup.mask?.type).toBe('clip');
    expect(newGroup.mask?.vectorMask?.points.length).toBe(4);
    expect(newGroup.mask?.sourceNodeId).toBeUndefined();
  });

  it('duplicate remaps explicit-target adjustment scope to cloned targets', () => {
    let doc = clipGroupFixture();
    doc = addNode(doc, makeAdjustmentNode('adj', 'levels', { channel: 'rgb' }));
    doc = nest(doc, 'adj', 'root', 1);
    const adj = doc.nodes.adj as import('../types').AdjustmentNode;
    const withScope = {
      ...doc,
      nodes: {
        ...doc.nodes,
        adj: {
          ...adj,
          scope: {
            mode: 'explicit-targets' as const,
            targetNodeIds: ['content', 'matte'],
          },
        },
      },
    };
    // Clone the whole root subtree: everything (matte, content, adj) is
    // inside the cloned tree, so all scope targets must remap.
    const cloned = deepCloneSubtree(withScope.nodes, withScope.nextId, 'root');
    const newAdjId = cloned.idMap.get('adj');
    const newAdj = cloned.nodes[newAdjId!] as {
      scope?: { mode: string; targetNodeIds: string[] };
    };
    expect(newAdj.scope?.mode).toBe('explicit-targets');
    expect(newAdj.scope?.targetNodeIds).toContain(cloned.idMap.get('content'));
    expect(newAdj.scope?.targetNodeIds).toContain(cloned.idMap.get('matte'));
    expect(newAdj.scope?.targetNodeIds).not.toContain('content');
  });

  it('paste drops explicit targets outside the subtree', () => {
    let doc = clipGroupFixture();
    doc = addNode(doc, makeAdjustmentNode('adj', 'levels', { channel: 'rgb' }));
    doc = nest(doc, 'adj', 'root', 1);
    const adj = doc.nodes.adj as import('../types').AdjustmentNode;
    const withScope = {
      ...doc,
      nodes: {
        ...doc.nodes,
        adj: {
          ...adj,
          scope: {
            mode: 'explicit-targets' as const,
            targetNodeIds: ['content', 'matte'],
          },
        },
      },
    };
    // Paste the adjustment alone: both targets are foreign → scope dropped.
    const nodesOnly = { ...withScope.nodes };
    delete nodesOnly.content;
    delete nodesOnly.matte;
    delete nodesOnly.g;
    const cloned = deepCloneSubtree(nodesOnly, withScope.nextId, 'adj', {
      dropForeignReferences: true,
    });
    const newAdj = cloned.nodes[cloned.rootId] as { scope?: { mode: string } };
    expect(newAdj.scope).toBeUndefined();
  });

  it('paste keeps the explicit targets that were included and drops the rest', () => {
    let doc = clipGroupFixture();
    // Promote content to the root so it can be pasted together with the
    // adjustment without dragging the clipping group along.
    doc = reparentNode(doc, 'content', 'root', 1);
    doc = addNode(doc, makeAdjustmentNode('adj', 'levels', { channel: 'rgb' }));
    doc = nest(doc, 'adj', 'root', 2);
    const adj = doc.nodes.adj as import('../types').AdjustmentNode;
    const withScope = {
      ...doc,
      nodes: {
        ...doc.nodes,
        adj: {
          ...adj,
          scope: {
            mode: 'explicit-targets' as const,
            targetNodeIds: ['content', 'matte'],
          },
        },
      },
    };
    // Paste root + content + adj (matte and the clipping group left behind):
    // matte is dropped from the target list, content is remapped.
    const nodesOnly = { ...withScope.nodes };
    delete nodesOnly.matte;
    delete nodesOnly.g;
    const cloned = deepCloneSubtree(nodesOnly, withScope.nextId, 'root', {
      dropForeignReferences: true,
    });
    const newAdj = cloned.nodes[cloned.idMap.get('adj')!] as {
      scope?: { mode: string; targetNodeIds: string[] };
    };
    expect(newAdj.scope?.mode).toBe('explicit-targets');
    expect(newAdj.scope?.targetNodeIds).toEqual([cloned.idMap.get('content')]);
  });

  it('paste drops an image-local scope pointing outside the subtree', () => {
    let doc = clipGroupFixture();
    doc = addNode(doc, makeAdjustmentNode('adj', 'levels', { channel: 'rgb' }));
    doc = nest(doc, 'adj', 'root', 1);
    const adj = doc.nodes.adj as import('../types').AdjustmentNode;
    const withScope = {
      ...doc,
      nodes: {
        ...doc.nodes,
        adj: {
          ...adj,
          scope: { mode: 'image-local' as const, targetNodeId: 'content' },
        },
      },
    };
    const nodesOnly = { ...withScope.nodes };
    delete nodesOnly.content;
    delete nodesOnly.matte;
    delete nodesOnly.g;
    const cloned = deepCloneSubtree(nodesOnly, withScope.nextId, 'adj', {
      dropForeignReferences: true,
    });
    const newAdj = cloned.nodes[cloned.rootId] as { scope?: { mode: string } };
    expect(newAdj.scope).toBeUndefined();
  });

  it('paste remaps an image-local scope whose target is inside the subtree', () => {
    let doc = clipGroupFixture();
    doc = reparentNode(doc, 'content', 'root', 1);
    doc = addNode(doc, makeAdjustmentNode('adj', 'levels', { channel: 'rgb' }));
    doc = nest(doc, 'adj', 'root', 2);
    const adj = doc.nodes.adj as import('../types').AdjustmentNode;
    const withScope = {
      ...doc,
      nodes: {
        ...doc.nodes,
        adj: {
          ...adj,
          scope: { mode: 'image-local' as const, targetNodeId: 'content' },
        },
      },
    };
    const nodesOnly = { ...withScope.nodes };
    delete nodesOnly.matte;
    delete nodesOnly.g;
    const cloned = deepCloneSubtree(nodesOnly, withScope.nextId, 'root', {
      dropForeignReferences: true,
    });
    const newAdj = cloned.nodes[cloned.idMap.get('adj')!] as {
      scope?: { mode: string; targetNodeId: string };
    };
    expect(newAdj.scope?.mode).toBe('image-local');
    expect(newAdj.scope?.targetNodeId).toBe(cloned.idMap.get('content'));
  });

  it('paste drops a spatial mask whose source is outside the subtree', () => {
    let doc = clipGroupFixture();
    doc = addNode(doc, makeAdjustmentNode('adj', 'levels', { channel: 'rgb' }));
    doc = nest(doc, 'adj', 'root', 1);
    const adj = doc.nodes.adj as import('../types').AdjustmentNode;
    const withMask = {
      ...doc,
      nodes: {
        ...doc.nodes,
        adj: {
          ...adj,
          mask: { type: 'alpha' as const, visible: true, sourceNodeId: 'matte' },
        },
      },
    };
    const nodesOnly = { ...withMask.nodes };
    delete nodesOnly.matte;
    delete nodesOnly.g;
    delete nodesOnly.content;
    const cloned = deepCloneSubtree(nodesOnly, withMask.nextId, 'adj', {
      dropForeignReferences: true,
    });
    const newAdj = cloned.nodes[cloned.rootId] as { mask?: { sourceNodeId?: string } };
    expect(newAdj.mask).toBeUndefined();
    expect(
      validateMasks({ ...withMask, nodes: cloned.nodes } as import('../types').Document),
    ).toEqual([]);
  });
});
