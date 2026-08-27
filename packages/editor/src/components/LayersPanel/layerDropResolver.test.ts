/**
 * Tests for the canonical Layers drop-target resolver.
 *
 * These exercise the resolver the way the panel drives it: a pointer Y, the
 * tree's clip bounds, and the virtualizer's row extents. Because the resolver
 * is the *only* thing that decides where a drag lands, the values asserted
 * here are literally what the indicator paints and what drag end commits.
 */

import type { Document, NodeId } from '@varve/scene';
import {
  addNode,
  createDocument,
  makeFrameNode,
  makeShapeNode,
  nextNodeId,
  reparentNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  computeDropZone,
  findRowIndexAtOffset,
  type ResolveLayerDropTargetArgs,
  type RowGeometry,
  resolveLayerDropTarget,
  resolveRootLevelSiblings,
  siblingsOf,
} from './layerDropResolver';
import { flattenTree } from './useFlatTree';

const ROW = 28;

/** Row extents exactly as the virtualizer lays them out: contiguous, 28px. */
function geometryFor(count: number): RowGeometry[] {
  return Array.from({ length: count }, (_, i) => ({ start: i * ROW, end: (i + 1) * ROW }));
}

/**
 * Four root-level rects named A..D, in creation (back-to-front) order.
 *
 * Flat documents keep page-content resolution out of the index arithmetic
 * under test; `resolveRootLevelSiblings` against a real page contentRoot has
 * its own describe block below.
 */
function makeSiblingsDoc(): { doc: Document; ids: NodeId[] } {
  let doc = createDocument('siblings', true);
  const ids: NodeId[] = [];
  for (const name of ['A', 'B', 'C', 'D']) {
    const { id, doc: next } = nextNodeId(doc);
    doc = addNode(next, makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name }));
    ids.push(id);
  }
  return { doc, ids };
}

/**
 * A frame holding one child, plus a loose sibling rect:
 *   Frame
 *   └── Child
 *   Loose
 */
function makeNestedDoc(): { doc: Document; frame: NodeId; child: NodeId; loose: NodeId } {
  let doc = createDocument('nested', true);
  const f = nextNodeId(doc);
  doc = addNode(f.doc, makeFrameNode(f.id, { w: 100, h: 100, children: [], name: 'Frame' }));
  const c = nextNodeId(doc);
  doc = addNode(
    c.doc,
    makeShapeNode(c.id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Child' }),
  );
  doc = reparentNode(doc, c.id, f.id, 0);
  const l = nextNodeId(doc);
  doc = addNode(
    l.doc,
    makeShapeNode(l.id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Loose' }),
  );
  return { doc, frame: f.id, child: c.id, loose: l.id };
}

/** Resolve at a pointer Y, with the tree's top edge and content top at 0. */
function resolveAt(
  doc: Document,
  pointerY: number,
  activeIds: NodeId[],
  overrides: Partial<ResolveLayerDropTargetArgs> = {},
) {
  const expanded = new Set<NodeId>(Object.keys(doc.nodes) as NodeId[]);
  const entries = flattenTree(doc, expanded, undefined, undefined, doc.activePageId);
  return resolveLayerDropTarget({
    doc,
    entries,
    geometry: geometryFor(entries.length),
    pointerY,
    viewport: { top: 0, bottom: 400 },
    contentTop: 0,
    activeIds,
    isDescendant: (ancestorId, nodeId) => {
      if (ancestorId === nodeId) return true;
      const walk = (id: NodeId): boolean => {
        const node = doc.nodes[id];
        if (!node || !('children' in node) || !node.children) return false;
        return (node.children as NodeId[]).some((c) => c === nodeId || walk(c));
      };
      return walk(ancestorId);
    },
    ...overrides,
  });
}

describe('findRowIndexAtOffset', () => {
  const geometry = geometryFor(4);

  it('finds the row containing an offset', () => {
    expect(findRowIndexAtOffset(geometry, 0)).toBe(0);
    expect(findRowIndexAtOffset(geometry, 27)).toBe(0);
    expect(findRowIndexAtOffset(geometry, 28)).toBe(1);
    expect(findRowIndexAtOffset(geometry, 111)).toBe(3);
  });

  it('reports no row above the first or below the last', () => {
    expect(findRowIndexAtOffset(geometry, -1)).toBe(-1);
    expect(findRowIndexAtOffset(geometry, 112)).toBe(-1);
    expect(findRowIndexAtOffset([], 0)).toBe(-1);
  });

  it('addresses a row far outside the mounted window', () => {
    // 5,000 rows: only ~20 are ever mounted, so a DOM-rect scan could not
    // reach row 4,321 at all.
    const big = geometryFor(5000);
    expect(findRowIndexAtOffset(big, 4321 * ROW + 5)).toBe(4321);
  });
});

describe('computeDropZone', () => {
  it('splits a leaf row cleanly in half', () => {
    expect(computeDropZone(0.0, false, false)).toBe('before');
    expect(computeDropZone(0.49, false, false)).toBe('before');
    expect(computeDropZone(0.5, false, false)).toBe('after');
    expect(computeDropZone(1.0, false, false)).toBe('after');
  });

  it('reserves a container row’s middle band for "into"', () => {
    expect(computeDropZone(0.29, true, false)).toBe('before');
    expect(computeDropZone(0.5, true, false)).toBe('into');
    expect(computeDropZone(0.71, true, false)).toBe('after');
  });

  it('never offers "into" on a descendant of the dragged node', () => {
    expect(computeDropZone(0.5, true, true)).toBe('after');
  });
});

describe('resolveLayerDropTarget — pointer authority', () => {
  it('claims nothing when the pointer is outside the tree viewport', () => {
    const { doc, ids } = makeSiblingsDoc();
    expect(resolveAt(doc, -20, [ids[0]!])).toBeNull();
    expect(resolveAt(doc, 900, [ids[0]!], { viewport: { top: 0, bottom: 400 } })).toBeNull();
  });

  it('resolves the row the pointer is actually over, top band = before', () => {
    const { doc, ids } = makeSiblingsDoc();
    // Panel order is front-most first: D, C, B, A. Row 1 is C.
    const target = resolveAt(doc, ROW + 3, [ids[3]!]);
    expect(target?.targetId).toBe(ids[2]);
    expect(target?.zone).toBe('before');
    expect(target?.valid).toBe(true);
  });

  it('resolves the bottom band of the same row as after', () => {
    const { doc, ids } = makeSiblingsDoc();
    const target = resolveAt(doc, ROW + 25, [ids[3]!]);
    expect(target?.targetId).toBe(ids[2]);
    expect(target?.zone).toBe('after');
  });
});

describe('resolveLayerDropTarget — reorder index mapping', () => {
  it('maps "before" (visually above) to the slot after the target in the array', () => {
    const { doc, ids } = makeSiblingsDoc();
    const [a, b, , d] = ids;
    // Drag D (top row) to the top band of B's row.
    const entriesOrder = ['D', 'C', 'B', 'A'];
    expect(entriesOrder[2]).toBe('B');
    const target = resolveAt(doc, 2 * ROW + 3, [d!]);
    expect(target?.targetId).toBe(b);
    expect(target?.zone).toBe('before');
    expect(target?.targetParentId).toBeNull();
    // Raw children are [A, B, C, D]; visually above B is index 2.
    expect(resolveRootLevelSiblings(doc)).toEqual([a, b, ids[2], d]);
    expect(target?.insertionIndex).toBe(2);
  });

  it('maps "after" (visually below) to the target’s own array slot', () => {
    const { doc, ids } = makeSiblingsDoc();
    const target = resolveAt(doc, 2 * ROW + 25, [ids[3]!]);
    expect(target?.zone).toBe('after');
    expect(target?.insertionIndex).toBe(1);
  });

  it('places first-visual-row and last-visual-row targets at the array bounds', () => {
    const { doc, ids } = makeSiblingsDoc();
    const siblings = resolveRootLevelSiblings(doc);
    // Above the very top row (D, array index 3) → array index 4 == append.
    const top = resolveAt(doc, 2, [ids[0]!]);
    expect(top?.insertionIndex).toBe(siblings.length);
    // Below the very bottom row (A, array index 0) → array index 0.
    const bottom = resolveAt(doc, 3 * ROW + 25, [ids[3]!]);
    expect(bottom?.insertionIndex).toBe(0);
  });
});

describe('resolveLayerDropTarget — containers', () => {
  it('reparents into a container from its middle band', () => {
    const { doc, frame, loose } = makeNestedDoc();
    // Panel order: Loose, Frame, Child. Frame is row 1.
    const target = resolveAt(doc, ROW + 14, [loose]);
    expect(target?.targetId).toBe(frame);
    expect(target?.zone).toBe('into');
    expect(target?.targetParentId).toBe(frame);
    expect(target?.valid).toBe(true);
  });

  it('appends into a container at the end of its raw children (visual top)', () => {
    const { doc, loose } = makeNestedDoc();
    const target = resolveAt(doc, ROW + 14, [loose]);
    expect(target?.insertionIndex).toBe(1);
  });

  it('treats an empty container as a valid drop target', () => {
    let doc = createDocument('empty-container', true);
    doc = addNode(doc, makeFrameNode('f', { w: 100, h: 100, children: [], name: 'Frame' }));
    doc = addNode(doc, makeShapeNode('s', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
    // Panel order: s, f. Frame is row 1, with no children row to aim at.
    const target = resolveAt(doc, ROW + 14, ['s' as NodeId]);
    expect(target?.targetId).toBe('f');
    expect(target?.zone).toBe('into');
    expect(target?.insertionIndex).toBe(0);
    expect(target?.valid).toBe(true);
  });

  it('never offers "into" on a leaf row', () => {
    const { doc, ids } = makeSiblingsDoc();
    const target = resolveAt(doc, ROW + 14, [ids[3]!]);
    expect(target?.zone).not.toBe('into');
  });
});

describe('resolveLayerDropTarget — moving out of a container', () => {
  it('drops at the page root when the pointer is below the last row', () => {
    const { doc, child } = makeNestedDoc();
    // Three rows → content ends at 84. Aim below it.
    const target = resolveAt(doc, 3 * ROW + 10, [child]);
    expect(target).not.toBeNull();
    expect(target?.targetId).toBeNull();
    expect(target?.targetParentId).toBeNull();
    // Visual bottom of the panel is index 0 of the raw array.
    expect(target?.insertionIndex).toBe(0);
    expect(target?.valid).toBe(true);
  });

  it('still reports a root drop when the container holds every other layer', () => {
    let doc = createDocument('all-nested', true);
    doc = addNode(doc, makeFrameNode('f', { w: 100, h: 100, children: [], name: 'Frame' }));
    doc = addNode(doc, makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
    doc = reparentNode(doc, 'a', 'f', 0);
    const target = resolveAt(doc, 2 * ROW + 10, ['a' as NodeId]);
    expect(target?.targetId).toBeNull();
    expect(target?.targetParentId).toBeNull();
  });
});

describe('resolveLayerDropTarget — validity', () => {
  it('rejects the dragged row itself', () => {
    const { doc, ids } = makeSiblingsDoc();
    // Row 0 is D (front-most); drag D onto itself.
    const target = resolveAt(doc, 5, [ids[3]!]);
    expect(target?.valid).toBe(false);
    expect(target?.reason).toBe('cycle');
  });

  it('rejects dropping a container into its own descendant, with a visible reason', () => {
    const { doc, frame, child } = makeNestedDoc();
    // Panel order: Loose, Frame, Child. Drag Frame onto Child (row 2).
    const target = resolveAt(doc, 2 * ROW + 14, [frame]);
    expect(target?.targetId).toBe(child);
    expect(target?.valid).toBe(false);
    expect(target?.reason).toBe('cycle');
  });

  it('rejects a drop into a locked container', () => {
    const { doc, frame, loose } = makeNestedDoc();
    const target = resolveAt(doc, ROW + 14, [loose], {
      isLocked: (id) => id === frame,
    });
    expect(target?.targetId).toBe(frame);
    expect(target?.valid).toBe(false);
    expect(target?.reason).toBe('locked');
  });

  it('resolves a target even while invalid, so the panel can show why', () => {
    const { doc, frame, child } = makeNestedDoc();
    const target = resolveAt(doc, 2 * ROW + 14, [frame]);
    expect(target).not.toBeNull();
    expect(target?.targetId).toBe(child);
  });
});

describe('resolveLayerDropTarget — scrolled tree', () => {
  it('resolves the same row whether it is reached by pointer or by scroll', () => {
    const { doc, ids } = makeSiblingsDoc();
    const expanded = new Set<NodeId>(Object.keys(doc.nodes) as NodeId[]);
    const entries = flattenTree(doc, expanded, undefined, undefined, doc.activePageId);
    const args = {
      doc,
      entries,
      geometry: geometryFor(entries.length),
      activeIds: [ids[3]!],
      isDescendant: (a: NodeId, b: NodeId) => a === b,
    };

    // Unscrolled: row 2 sits at content offset 56, pointer 59.
    const unscrolled = resolveLayerDropTarget({
      ...args,
      pointerY: 59,
      viewport: { top: 0, bottom: 100 },
      contentTop: 0,
    });

    // Scrolled by 56px: the content top has moved up, so the same row is now
    // under a pointer at 3. The resolved answer must be identical.
    const scrolled = resolveLayerDropTarget({
      ...args,
      pointerY: 3,
      viewport: { top: 0, bottom: 100 },
      contentTop: -56,
    });

    expect(scrolled?.targetId).toBe(unscrolled?.targetId);
    expect(scrolled?.zone).toBe(unscrolled?.zone);
    expect(scrolled?.insertionIndex).toBe(unscrolled?.insertionIndex);
  });
});

describe('siblingsOf', () => {
  it('falls back to rootChildren for a flat document with no pages', () => {
    const { doc, ids } = makeSiblingsDoc();
    expect(siblingsOf(doc, null)).toEqual(ids);
  });

  /**
   * The active page's contentRoot — not doc.rootChildren, which holds each
   * page's contentRoot id rather than page content. Getting this wrong means
   * a root-level drop computes its index against a list of pages.
   */
  it('resolves a null parent to the active page’s content root', () => {
    let doc = createDocument('paged');
    const contentRootId = doc.pages?.find((pg) => pg.id === doc.activePageId)?.contentRoot;
    expect(contentRootId).toBeTruthy();
    const a = nextNodeId(doc);
    doc = addNode(a.doc, makeShapeNode(a.id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
    doc = reparentNode(doc, a.id, contentRootId!, 0);

    expect(siblingsOf(doc, null)).toEqual([a.id]);
    expect(doc.rootChildren).toEqual([contentRootId]);
    expect(siblingsOf(doc, null)).not.toEqual(doc.rootChildren);
  });

  it('drops a page-rooted layer at the page content root, not at rootChildren', () => {
    let doc = createDocument('paged-drop');
    const contentRootId = doc.pages?.find((pg) => pg.id === doc.activePageId)?.contentRoot;
    const f = nextNodeId(doc);
    doc = addNode(f.doc, makeFrameNode(f.id, { w: 100, h: 100, children: [], name: 'Frame' }));
    doc = reparentNode(doc, f.id, contentRootId!, 0);
    const c = nextNodeId(doc);
    doc = addNode(c.doc, makeShapeNode(c.id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
    doc = reparentNode(doc, c.id, f.id, 0);

    // Rows: Frame, Child. Aim below both to move the child out to page root.
    const target = resolveAt(doc, 2 * ROW + 10, [c.id]);
    expect(target?.targetParentId).toBeNull();
    expect(siblingsOf(doc, target?.targetParentId ?? null)).toEqual([f.id]);
  });

  it('resolves a container parent to its children', () => {
    const { doc, frame, child } = makeNestedDoc();
    expect(siblingsOf(doc, frame)).toEqual([child]);
  });

  it('returns an empty list for a leaf parent', () => {
    const { doc, child } = makeNestedDoc();
    expect(siblingsOf(doc, child)).toEqual([]);
  });
});
