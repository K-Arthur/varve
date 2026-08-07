import { describe, expect, it } from 'vitest';
import { deepCloneSubtree } from '../clone';
import type { Document } from '../document';
import {
  addNode,
  createDocument,
  isContainer,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  makeTableNode,
  makeTextNode,
  nextNodeId,
} from '../document';
import { setCellSceneContent } from '../tableOps';
import type { FrameNode, GroupNode, NodeId, ShapeNode } from '../types';

function shape(doc: Document, name: string, opts?: Partial<ShapeNode>) {
  const { id, doc: d2 } = nextNodeId(doc);
  doc = d2;
  return {
    id,
    node: makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name, ...opts }),
    doc,
  };
}

function frame(doc: Document, name: string, opts?: Partial<FrameNode>) {
  const { id, doc: d2 } = nextNodeId(doc);
  doc = d2;
  return {
    id,
    node: makeFrameNode(id, { name, w: 200, h: 160, ...opts }),
    doc,
  };
}

function group(doc: Document, name: string, opts?: Partial<GroupNode>) {
  const { id, doc: d2 } = nextNodeId(doc);
  doc = d2;
  return {
    id,
    node: makeGroupNode(id, { name, ...opts }),
    doc,
  };
}

describe('deepCloneSubtree', () => {
  it('clones a leaf shape node', () => {
    let doc = createDocument();
    const a = shape(doc, 'Rect 1');
    doc = a.doc;
    doc = addNode(doc, a.node);

    const result = deepCloneSubtree(doc.nodes, doc.nextId, a.id);

    expect(result.rootId).not.toBe(a.id);
    expect(Object.keys(result.nodes)).toHaveLength(1);
    const cloned = result.nodes[result.rootId]!;
    expect(cloned).toBeDefined();
    expect(cloned.id).toBe(result.rootId);
    expect(cloned.name).toBe('Rect 1');
    expect(cloned.kind).toBe('shape');
    expect(cloned.id).not.toBe(a.id);
    expect(result.idMap.get(a.id)).toBe(result.rootId);
  });

  it('clones a group with children', () => {
    let doc = createDocument();
    const a = shape(doc, 'Child A');
    doc = a.doc;
    const b = shape(doc, 'Child B');
    doc = b.doc;
    doc = addNode(doc, a.node);
    doc = addNode(doc, b.node);
    const g = group(doc, 'Group 1', { children: [a.id, b.id] });
    doc = g.doc;
    doc = addNode(doc, g.node);

    const result = deepCloneSubtree(doc.nodes, doc.nextId, g.id);

    expect(result.rootId).not.toBe(g.id);
    const clonedGroup = result.nodes[result.rootId] as GroupNode;
    expect(clonedGroup.kind).toBe('group');
    expect(clonedGroup.name).toBe('Group 1');
    expect(clonedGroup.children).toHaveLength(2);
    expect(clonedGroup.children[0]!).not.toBe(a.id);
    expect(clonedGroup.children[1]!).not.toBe(b.id);

    const child0 = result.nodes[clonedGroup.children[0]!];
    const child1 = result.nodes[clonedGroup.children[1]!];
    expect(child0).toBeDefined();
    expect(child1).toBeDefined();
    expect(child0?.name).toBe('Child A');
    expect(child1?.name).toBe('Child B');

    expect(result.idMap.get(a.id)).toBe(clonedGroup.children[0]);
    expect(result.idMap.get(b.id)).toBe(clonedGroup.children[1]);
    expect(result.idMap.get(g.id)).toBe(result.rootId);
    expect(result.idMap.size).toBe(3);
  });

  it('clones a deeply nested tree (3+ levels)', () => {
    let doc = createDocument();

    const leaf = shape(doc, 'Leaf');
    doc = leaf.doc;
    doc = addNode(doc, leaf.node);
    const g1 = group(doc, 'Level 2', { children: [leaf.id] });
    doc = g1.doc;
    doc = addNode(doc, g1.node);
    const g2 = group(doc, 'Level 1', { children: [g1.id] });
    doc = g2.doc;
    doc = addNode(doc, g2.node);

    const result = deepCloneSubtree(doc.nodes, doc.nextId, g2.id);

    const clonedG2 = result.nodes[result.rootId] as GroupNode;
    expect(clonedG2.name).toBe('Level 1');
    expect(clonedG2.children).toHaveLength(1);

    const clonedG1 = result.nodes[clonedG2.children[0]!] as GroupNode;
    expect(clonedG1).toBeDefined();
    expect(clonedG1.name).toBe('Level 2');
    expect(clonedG1.children).toHaveLength(1);

    const clonedLeaf = result.nodes[clonedG1.children[0]!];
    expect(clonedLeaf).toBeDefined();
    expect(clonedLeaf?.name).toBe('Leaf');
    expect(clonedLeaf?.kind).toBe('shape');
  });

  it('preserves parent-child relationships in cloned nodes', () => {
    let doc = createDocument();
    const a = shape(doc, 'A');
    doc = a.doc;
    const b = shape(doc, 'B');
    doc = b.doc;
    doc = addNode(doc, a.node);
    doc = addNode(doc, b.node);
    const g = group(doc, 'Parent', { children: [a.id, b.id] });
    doc = g.doc;
    doc = addNode(doc, g.node);

    const result = deepCloneSubtree(doc.nodes, doc.nextId, g.id);

    const clonedGroup = result.nodes[result.rootId] as GroupNode;
    expect(clonedGroup.children).toHaveLength(2);

    for (const [nid] of Object.entries(result.nodes)) {
      if (nid === result.rootId) continue;
      const isReferenced = Object.values(result.nodes).some(
        (n) => isContainer(n) && (n as GroupNode | FrameNode).children.includes(nid as NodeId),
      );
      expect(isReferenced).toBe(true);
    }
  });

  it('generates unique new IDs (no collisions with existing)', () => {
    let doc = createDocument();
    const a = shape(doc, 'A');
    doc = a.doc;
    const b = shape(doc, 'B');
    doc = b.doc;
    doc = addNode(doc, a.node);
    doc = addNode(doc, b.node);
    const g = group(doc, 'G', { children: [a.id, b.id] });
    doc = g.doc;
    doc = addNode(doc, g.node);

    const result = deepCloneSubtree(doc.nodes, doc.nextId, g.id);
    const originalNodes = { ...doc.nodes };

    for (const newId of result.idMap.values()) {
      expect(originalNodes[newId]).toBeUndefined();
    }

    const ids = new Set(result.idMap.values());
    expect(ids.size).toBe(result.idMap.size);
  });

  it('returns correct idMap with old→new mapping', () => {
    let doc = createDocument();
    const a = shape(doc, 'A');
    doc = a.doc;
    doc = addNode(doc, a.node);
    const g = group(doc, 'G', { children: [a.id] });
    doc = g.doc;
    doc = addNode(doc, g.node);

    const result = deepCloneSubtree(doc.nodes, doc.nextId, g.id);

    expect(result.idMap.get(g.id)).toBe(result.rootId);
    expect(result.idMap.get(a.id)).toBe((result.nodes[result.rootId] as GroupNode).children[0]!);
  });

  it('clones frame slots with remapped child IDs', () => {
    let doc = createDocument();
    const slotChild = shape(doc, 'Slot Filler');
    doc = slotChild.doc;
    doc = addNode(doc, slotChild.node);
    const f = frame(doc, 'F', {
      slots: { header: slotChild.id },
      children: [slotChild.id],
    });
    doc = f.doc;
    doc = addNode(doc, f.node);

    const result = deepCloneSubtree(doc.nodes, doc.nextId, f.id);

    const clonedFrame = result.nodes[result.rootId] as FrameNode;
    expect(clonedFrame.slots).toBeDefined();
    const newSlotChildId = clonedFrame.children[0]!;
    expect(clonedFrame.slots?.header).toBe(newSlotChildId);
    expect(clonedFrame.slots?.header).not.toBe(slotChild.id);
  });

  it('clones mask references with remapped source ID', () => {
    let doc = createDocument();
    const maskChild = shape(doc, 'Mask Source');
    doc = maskChild.doc;
    doc = addNode(doc, maskChild.node);
    const g = group(doc, 'Masked', { children: [maskChild.id] });
    doc = g.doc;
    doc = addNode(doc, g.node);
    // mask is not in makeGroupNode Pick, so set it manually via document patch
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [g.id]: {
          ...doc.nodes[g.id],
          mask: { type: 'clip', sourceNodeId: maskChild.id, visible: true },
        } as GroupNode,
      },
    };

    const result = deepCloneSubtree(doc.nodes, doc.nextId, g.id);

    const clonedGroup = result.nodes[result.rootId] as GroupNode;
    expect(clonedGroup.mask).toBeDefined();
    expect(clonedGroup.mask?.sourceNodeId).toBe(clonedGroup.children[0]!);
    expect(clonedGroup.mask?.sourceNodeId).not.toBe(maskChild.id);
    expect(clonedGroup.mask?.type).toBe('clip');
  });

  it('preserves node properties (name, fill, visible, locked)', () => {
    let doc = createDocument();
    const a = shape(doc, 'Special Shape', {
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      visible: false,
      locked: true,
    });
    doc = a.doc;
    doc = addNode(doc, a.node);

    const result = deepCloneSubtree(doc.nodes, doc.nextId, a.id);

    const cloned = result.nodes[result.rootId] as ShapeNode;
    expect(cloned.name).toBe('Special Shape');
    expect(cloned.fill).toEqual({ space: 'rgb', r: 255, g: 0, b: 0, a: 255 });
    expect(cloned.visible).toBe(false);
    expect(cloned.locked).toBe(true);
  });

  it('handles empty group (no children)', () => {
    let doc = createDocument();
    const g = group(doc, 'Empty Group', { children: [] });
    doc = g.doc;
    doc = addNode(doc, g.node);

    const result = deepCloneSubtree(doc.nodes, doc.nextId, g.id);

    expect(result.rootId).not.toBe(g.id);
    const clonedGroup = result.nodes[result.rootId] as GroupNode;
    expect(clonedGroup.children).toHaveLength(0);
    expect(Object.keys(result.nodes)).toHaveLength(1);
    expect(result.idMap.size).toBe(1);
  });

  it('clones a frame with children (container) preserving all properties', () => {
    let doc = createDocument();
    const child = shape(doc, 'Frame Child');
    doc = child.doc;
    doc = addNode(doc, child.node);
    const f = frame(doc, 'My Frame', {
      children: [child.id],
      w: 400,
      h: 300,
      clipContent: true,
    });
    doc = f.doc;
    doc = addNode(doc, f.node);

    const result = deepCloneSubtree(doc.nodes, doc.nextId, f.id);

    expect(result.rootId).not.toBe(f.id);
    const clonedFrame = result.nodes[result.rootId] as FrameNode;
    expect(clonedFrame.kind).toBe('frame');
    expect(clonedFrame.w).toBe(400);
    expect(clonedFrame.h).toBe(300);
    expect(clonedFrame.clipContent).toBe(true);
    expect(clonedFrame.children).toHaveLength(1);
    expect(clonedFrame.children[0]!).not.toBe(child.id);

    const clonedChild = result.nodes[clonedFrame.children[0]!];
    expect(clonedChild).toBeDefined();
    expect(clonedChild?.name).toBe('Frame Child');
  });

  it('clones adjustment nodes', () => {
    let doc = createDocument();
    const { id, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const adjNode: import('../types').AdjustmentNode = {
      id,
      kind: 'adjustment',
      adjustmentType: 'curves',
      params: {
        channel: 'rgb',
        points: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.6 },
          { x: 1, y: 1 },
        ],
      },
      transform: [1, 0, 0, 1, 0, 0],
      clipping: true,
      name: 'Curves 1',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      effects: [],
    };
    doc = addNode(doc, adjNode);

    const result = deepCloneSubtree(doc.nodes, doc.nextId, id);

    expect(result.rootId).not.toBe(id);
    const cloned = result.nodes[result.rootId] as import('../types').AdjustmentNode;
    expect(cloned.kind).toBe('adjustment');
    expect(cloned.adjustmentType).toBe('curves');
    expect(cloned.clipping).toBe(true);
    expect(cloned.params).toEqual(adjNode.params);
  });

  it('remaps pathId references on text nodes', () => {
    let doc = createDocument();
    const pathNode = shape(doc, 'Path Target');
    doc = pathNode.doc;
    doc = addNode(doc, pathNode.node);
    const textNode = makeTextNode('', 'Hello');
    const { id: textId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const textWithPath: import('../types').TextNode = {
      ...textNode,
      id: textId,
      name: 'Text',
      pathId: pathNode.id,
    };
    doc = addNode(doc, textWithPath);

    const result = deepCloneSubtree(doc.nodes, doc.nextId, textId);

    const cloned = result.nodes[result.rootId] as import('../types').TextNode;
    // pathId references a node outside the subtree, so it's preserved verbatim
    expect(cloned.pathId).toBe(pathNode.id);
  });

  it('remaps scene-content cell references and clones the referenced nodes', () => {
    let doc = createDocument();
    // Content node (image) referenced by a table cell.
    const content = frame(doc, 'Cell image');
    doc = content.doc;
    doc = addNode(doc, content.node);
    // Table node with a scene-content cell.
    const tableNode = makeTableNode('', { rows: 2, columns: 2 });
    const { id: tableId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const table: import('../types').TableNode = {
      ...tableNode,
      id: tableId,
      name: 'Table 1',
      table: setCellSceneContent(
        tableNode.table,
        Object.keys(tableNode.table.cells)[0]!,
        content.id,
      ),
    };
    doc = addNode(doc, table);

    const result = deepCloneSubtree(doc.nodes, doc.nextId, tableId);

    const cloned = result.nodes[result.rootId] as import('../types').TableNode;
    // Cell reference points at the CLONED content node, not the original.
    const clonedContentId = Object.values(cloned.table.cells)[0]!.content;
    expect(clonedContentId.kind).toBe('scene');
    if (clonedContentId.kind === 'scene') {
      expect(clonedContentId.nodeId).not.toBe(content.id);
      expect(result.nodes[clonedContentId.nodeId]).toBeDefined();
    }
    // The content node was cloned into the result map.
    const clonedContent =
      result.nodes[clonedContentId.kind === 'scene' ? clonedContentId.nodeId : ''];
    expect(clonedContent).toBeDefined();
    expect(clonedContent?.id).not.toBe(content.id);
  });
});
