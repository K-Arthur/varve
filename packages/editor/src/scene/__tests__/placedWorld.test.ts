/**
 * Placed-world helpers (ADR-0123): the editor's world space is the
 * pasteboard, so page-owned nodes carry their page's placement translation
 * while pasteboard/global items keep scene coordinates.
 */
import type { Document } from '@varve/scene';
import {
  addChild,
  addNode,
  addPage,
  createDocument,
  createLiveBooleanDoc,
  makeShapeNode,
  nextNodeId,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { buildPagePlacementMap, pagePlacementForNode } from '../pagePlacement';
import { nodeWorldBounds, nodeWorldTransform } from '../world';

function placedDoc(): Document {
  let doc = createDocument('placed', false);
  doc = addPage(doc, {});
  doc = {
    ...doc,
    pages: doc.pages!.map((p, i) => ({
      ...p,
      placement: { x: i * 500, y: i * 300 },
    })),
  };
  // One shape per page, page-local at (10, 10).
  for (const page of doc.pages!) {
    const { id, doc: d } = nextNodeId(doc);
    doc = addChild(
      d,
      page.contentRoot,
      makeShapeNode(
        id,
        { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
        { transform: [1, 0, 0, 1, 10, 10] as Affine },
      ),
    );
  }
  return doc;
}

describe('placed world transforms (ADR-0123)', () => {
  it('appends the containing page placement to node world transforms', () => {
    const doc = placedDoc();
    const [page1, page2] = [doc.pages![0]!, doc.pages![1]!];
    const child1 = (doc.nodes[page1.contentRoot] as { children: string[] }).children[0]!;
    const child2 = (doc.nodes[page2.contentRoot] as { children: string[] }).children[0]!;

    expect(nodeWorldTransform(doc, child1)).toEqual([1, 0, 0, 1, 10, 10]);
    expect(nodeWorldTransform(doc, child2)).toEqual([1, 0, 0, 1, 510, 310]);
  });

  it('shifts world bounds by the placement', () => {
    const doc = placedDoc();
    const page2 = doc.pages![1]!;
    const child2 = (doc.nodes[page2.contentRoot] as { children: string[] }).children[0]!;
    const bounds = nodeWorldBounds(doc, child2);
    expect(bounds).toEqual({ x: 510, y: 310, w: 50, h: 50 });
  });

  it('uses the visible Boolean result rather than raw operand bounds', () => {
    let doc = placedDoc();
    const page2 = doc.pages![1]!;
    const { id: cutterId, doc: withId } = nextNodeId(doc);
    doc = addChild(
      withId,
      page2.contentRoot,
      makeShapeNode(cutterId, { kind: 'rect', x: 20, y: 20, w: 20, h: 20 }),
    );
    const baseId = (doc.nodes[page2.contentRoot] as { children: string[] }).children[0]!;
    const created = createLiveBooleanDoc(doc, [baseId, cutterId], 'intersect');
    expect(created).not.toBeNull();
    if (!created) return;

    expect(nodeWorldBounds(created.doc, created.nodeId)).toEqual({
      x: 520,
      y: 320,
      w: 20,
      h: 20,
    });
  });

  it('leaves pasteboard items at scene coordinates', () => {
    let doc = createDocument('flat', true);
    const { id, doc: d } = nextNodeId(doc);
    doc = addNode(d, makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
    expect(nodeWorldTransform(doc, id)).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('buildPagePlacementMap covers content roots, backgrounds and descendants', () => {
    const doc = placedDoc();
    const map = buildPagePlacementMap(doc);
    const [page1, page2] = [doc.pages![0]!, doc.pages![1]!];
    expect(map.contentRoots.has(page1.contentRoot)).toBe(true);
    expect(pagePlacementForNode(map, page1.contentRoot)).toEqual({ x: 0, y: 0 });
    expect(pagePlacementForNode(map, page2.contentRoot)).toEqual({ x: 500, y: 300 });
    const child2 = (doc.nodes[page2.contentRoot] as { children: string[] }).children[0]!;
    expect(pagePlacementForNode(map, child2)).toEqual({ x: 500, y: 300 });
  });
});
