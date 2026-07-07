import {
  addChild,
  addPage,
  createDocument,
  makeGroupNode,
  makeShapeNode,
  nextNodeId,
  type Page,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { collectActivePageNodeIds, computeActivePageLayerCount } from './layerCounts';

describe('computeActivePageLayerCount', () => {
  it('is 0 for a brand-new blank document (contentRoot is not a layer)', () => {
    const doc = createDocument();
    expect(computeActivePageLayerCount(doc)).toBe(0);
  });

  it('counts only the active page, not other pages in the same document', () => {
    let doc = createDocument();
    const page1ContentRoot = doc.nodes[doc.rootChildren[0]!]!;
    expect(page1ContentRoot.kind).toBe('group');

    const { id: rectId, doc: d1 } = nextNodeId(doc);
    doc = d1;
    doc = addChild(
      doc,
      page1ContentRoot.id,
      makeShapeNode(rectId, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
    );

    // Add a second page and put two shapes on it.
    doc = addPage(doc, { name: 'Page 2' });
    const page2 = doc.pages?.[1] as Page;
    const { id: rect2Id, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addChild(
      doc,
      page2.contentRoot,
      makeShapeNode(rect2Id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
    );
    const { id: rect3Id, doc: d3 } = nextNodeId(doc);
    doc = d3;
    doc = addChild(
      doc,
      page2.contentRoot,
      makeShapeNode(rect3Id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
    );

    // Still viewing page 1 by default: only the 1 shape on page 1 counts.
    expect(doc.activePageId).toBe(doc.pages?.[0]?.id);
    expect(computeActivePageLayerCount(doc)).toBe(1);

    // Switch to page 2: only its 2 shapes count, not page 1's.
    doc = { ...doc, activePageId: page2.id };
    expect(computeActivePageLayerCount(doc)).toBe(2);
  });

  it('counts nested descendants (group/frame children), recursively', () => {
    let doc = createDocument();
    const page1ContentRoot = doc.nodes[doc.rootChildren[0]!]!;

    const { id: groupId, doc: d1 } = nextNodeId(doc);
    doc = d1;
    const { id: childId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const group = makeGroupNode(groupId, { name: 'Group', children: [childId] });
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [childId]: makeShapeNode(childId, { kind: 'rect', x: 0, y: 0, w: 5, h: 5 }),
      },
    };
    doc = addChild(doc, page1ContentRoot.id, group);

    // The group itself + its 1 child = 2 layers.
    expect(computeActivePageLayerCount(doc)).toBe(2);
    expect(collectActivePageNodeIds(doc)).toContain(childId);
  });
});
