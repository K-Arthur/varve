/**
 * Tests for resolveDragMoveIds — deciding which nodes move when a
 * multi-selected row is dragged.
 *
 * Research basis: Figma/Sketch/Illustrator all drag the entire multi-selection
 * together, not just the row under the pointer.
 */

import type { Document } from '@varve/scene';
import {
  addChild,
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
  computeMultiMoveSteps,
  isNoOpMove,
  resolveDragMoveIds,
  resolveDropClipTarget,
} from './LayersTree';
import type { FlatEntry } from './useFlatTree';
import { flattenTree } from './useFlatTree';

function makeSiblingsDoc(): { doc: Document; a: string; b: string; c: string; d: string } {
  let doc = createDocument();

  const { id: a, doc: d1 } = nextNodeId(doc);
  doc = d1;
  doc = addNode(doc, makeShapeNode(a, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'A' }));

  const { id: b, doc: d2 } = nextNodeId(doc);
  doc = d2;
  doc = addNode(doc, makeShapeNode(b, { kind: 'rect', x: 20, y: 0, w: 10, h: 10 }, { name: 'B' }));

  const { id: c, doc: d3 } = nextNodeId(doc);
  doc = d3;
  doc = addNode(doc, makeShapeNode(c, { kind: 'rect', x: 40, y: 0, w: 10, h: 10 }, { name: 'C' }));

  const { id: d, doc: d4 } = nextNodeId(doc);
  doc = d4;
  doc = addNode(doc, makeShapeNode(d, { kind: 'rect', x: 60, y: 0, w: 10, h: 10 }, { name: 'D' }));

  return { doc, a, b, c, d };
}

function entriesFor(doc: Document): FlatEntry[] {
  return flattenTree(doc, new Set(doc.rootChildren));
}

describe('resolveDragMoveIds', () => {
  it('returns only the active id when there is no multi-selection', () => {
    const { doc, a } = makeSiblingsDoc();
    const result = resolveDragMoveIds(doc, [a], entriesFor(doc), a);
    expect(result).toEqual([a]);
  });

  it('returns only the active id when the active id is not part of the selection', () => {
    const { doc, a, b, c } = makeSiblingsDoc();
    // Selection is [b, c] but the row being dragged (a) isn't in it.
    const result = resolveDragMoveIds(doc, [b, c], entriesFor(doc), a);
    expect(result).toEqual([a]);
  });

  it('returns the whole multi-selection, in visual order, when the dragged row is selected', () => {
    const { doc, a, b, c, d } = makeSiblingsDoc();
    // rootChildren is paint order (first = back), so the panel — like every
    // real layers panel — shows the most-recently-added (front-most) layer
    // first: visual order here is d, c, b, a. Selection recorded in click
    // order [b, d] must come back out as [d, b] to match that visual order.
    const result = resolveDragMoveIds(doc, [b, d], entriesFor(doc), b);
    expect(result).toEqual([d, b]);
    // 'a' and 'c' were never selected — must not be swept in.
    expect(result).not.toContain(a);
    expect(result).not.toContain(c);
  });

  it('excludes a selected descendant whose selected ancestor is also moving', () => {
    let doc = createDocument();
    const { id: frame, doc: d1 } = nextNodeId(doc);
    doc = d1;
    doc = addNode(doc, makeFrameNode(frame, { name: 'Frame', w: 100, h: 100, children: [] }));

    const { id: child, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addChild(
      doc,
      frame,
      makeShapeNode(child, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Child' }),
    );

    const expanded = new Set([frame]);
    const entries = flattenTree(doc, expanded);
    // Both the frame and its child are selected; dragging the frame should
    // only move the frame — the child rides along as part of its subtree.
    const result = resolveDragMoveIds(doc, [frame, child], entries, frame);
    expect(result).toEqual([frame]);
  });
});

describe('computeDropZone', () => {
  it('returns "before" in the top half of a non-container row', () => {
    expect(computeDropZone(0.2, false, false)).toBe('before');
  });

  it('returns "after" in the bottom half of a non-container row', () => {
    expect(computeDropZone(0.8, false, false)).toBe('after');
  });

  it('returns "into" in the middle third of a container row', () => {
    expect(computeDropZone(0.5, true, false)).toBe('into');
  });

  it('does not return "into" for a container row outside the middle third', () => {
    expect(computeDropZone(0.1, true, false)).toBe('before');
    expect(computeDropZone(0.9, true, false)).toBe('after');
  });

  it('never returns "into" when the target is a descendant of the dragged node', () => {
    // Even squarely in the middle band — dropping into your own descendant
    // would create a cycle.
    expect(computeDropZone(0.5, true, true)).not.toBe('into');
  });
});

describe('computeMultiMoveSteps', () => {
  it('lands a 2-node group contiguously at the target position, preserving relative order', () => {
    // targetSiblings is back-to-front paint order (index 0 = back): A,B,C,D,E.
    // moveIdsVisualOrder is panel order (front-to-back): entries would read
    // E,D,C,B,A here, so a group {B, D} appears as [D, B] in visual order.
    const targetSiblings = ['A', 'B', 'C', 'D', 'E'];
    const steps = computeMultiMoveSteps(targetSiblings, ['D', 'B'], 2);

    expect(steps).toEqual([
      { id: 'B', index: 1 },
      { id: 'D', index: 2 },
    ]);

    // Apply the steps exactly like handleDragEnd does — one splice per step,
    // sequentially, against the array left over from the previous step — and
    // confirm the final array matches hand-derived expectations.
    let arr = [...targetSiblings];
    for (const { id, index } of steps) {
      arr = arr.filter((x) => x !== id);
      arr.splice(index, 0, id);
    }
    expect(arr).toEqual(['A', 'B', 'D', 'C', 'E']);
  });

  it('matches today’s single-item formula exactly (no shift) when only one id moves', () => {
    const targetSiblings = ['A', 'B', 'C', 'D', 'E'];
    const steps = computeMultiMoveSteps(targetSiblings, ['D'], 2);
    expect(steps).toEqual([{ id: 'D', index: 2 }]);

    let arr = [...targetSiblings];
    for (const { id, index } of steps) {
      arr = arr.filter((x) => x !== id);
      arr.splice(index, 0, id);
    }
    expect(arr).toEqual(['A', 'B', 'D', 'C', 'E']);
  });

  it('handles ids moving in from a different container (not present in targetSiblings)', () => {
    const targetSiblings = ['A', 'B', 'C'];
    // 'X' and 'Y' are arriving from elsewhere; targeting the end (append).
    const steps = computeMultiMoveSteps(targetSiblings, ['Y', 'X'], targetSiblings.length);
    expect(steps).toEqual([
      { id: 'X', index: 3 },
      { id: 'Y', index: 4 },
    ]);

    let arr = [...targetSiblings];
    for (const { id, index } of steps) {
      arr = arr.filter((x) => x !== id);
      arr.splice(index, 0, id);
    }
    expect(arr).toEqual(['A', 'B', 'C', 'X', 'Y']);
  });

  /**
   * Each step is applied by a separate reparentNode call, so a plan is only
   * correct if it composes: members of the run that have not moved yet are
   * still occupying slots underneath the insertion point. Slot arithmetic
   * against the *original* array silently drifts by one per pending member,
   * which is what scrambled multi-row drags.
   */
  describe('composed application (one reparentNode call per step)', () => {
    const apply = (siblings: string[], steps: Array<{ id: string; index: number }>): string[] => {
      let arr = [...siblings];
      for (const { id, index } of steps) {
        arr = arr.filter((x) => x !== id);
        arr.splice(Math.max(0, Math.min(index, arr.length)), 0, id);
      }
      return arr;
    };

    it('moves a non-contiguous pair to the end of the list', () => {
      const siblings = ['A', 'B', 'C', 'D', 'E'];
      const steps = computeMultiMoveSteps(siblings, ['D', 'B'], siblings.length);
      expect(apply(siblings, steps)).toEqual(['A', 'C', 'E', 'B', 'D']);
    });

    it('moves a non-contiguous pair to the front of the list', () => {
      const siblings = ['A', 'B', 'C', 'D', 'E'];
      const steps = computeMultiMoveSteps(siblings, ['D', 'B'], 0);
      expect(apply(siblings, steps)).toEqual(['B', 'D', 'A', 'C', 'E']);
    });

    it('moves a contiguous pair downward past a stationary sibling', () => {
      const siblings = ['A', 'B', 'C', 'D', 'E'];
      const steps = computeMultiMoveSteps(siblings, ['C', 'B'], 4);
      expect(apply(siblings, steps)).toEqual(['A', 'D', 'B', 'C', 'E']);
    });

    it('moves a contiguous pair upward past a stationary sibling', () => {
      const siblings = ['A', 'B', 'C', 'D', 'E'];
      const steps = computeMultiMoveSteps(siblings, ['D', 'C'], 1);
      expect(apply(siblings, steps)).toEqual(['A', 'C', 'D', 'B', 'E']);
    });

    it('moves three non-adjacent nodes as one contiguous run', () => {
      const siblings = ['A', 'B', 'C', 'D', 'E', 'F'];
      const steps = computeMultiMoveSteps(siblings, ['E', 'C', 'A'], 6);
      expect(apply(siblings, steps)).toEqual(['B', 'D', 'F', 'A', 'C', 'E']);
    });

    it('keeps a single-node move on its existing formula', () => {
      const siblings = ['A', 'B', 'C'];
      expect(apply(siblings, computeMultiMoveSteps(siblings, ['A'], 3))).toEqual(['B', 'C', 'A']);
      expect(apply(siblings, computeMultiMoveSteps(siblings, ['C'], 0))).toEqual(['C', 'A', 'B']);
    });

    it('interleaves arrivals from another container with local movers', () => {
      const siblings = ['A', 'B', 'C'];
      // 'X' arrives from a different parent; 'B' is already here.
      const steps = computeMultiMoveSteps(siblings, ['X', 'B'], 2);
      expect(apply(siblings, steps)).toEqual(['A', 'B', 'X', 'C']);
    });

    it('clamps a base position past the end of the sibling list', () => {
      const siblings = ['A', 'B'];
      const steps = computeMultiMoveSteps(siblings, ['A'], 99);
      expect(apply(siblings, steps)).toEqual(['B', 'A']);
    });
  });
});

describe('isNoOpMove', () => {
  it('recognizes an adjacent drop that preserves the sibling list', () => {
    expect(isNoOpMove(['A', 'B', 'C'], [{ id: 'B', index: 1 }])).toBe(true);
  });

  it('recognizes a multi-node plan that preserves the sibling list', () => {
    expect(
      isNoOpMove(
        ['A', 'B', 'C', 'D'],
        [
          { id: 'B', index: 1 },
          { id: 'D', index: 3 },
        ],
      ),
    ).toBe(true);
  });

  it('rejects a plan that changes order', () => {
    expect(isNoOpMove(['A', 'B', 'C'], [{ id: 'C', index: 0 }])).toBe(false);
  });
});

describe('resolveDropClipTarget', () => {
  it('clips into the matte when dropping on a clipping mask source row', () => {
    let doc = createDocument('clip-drop', true);
    doc = addNode(doc, makeFrameNode('g', { w: 100, h: 100, children: [], name: 'Group' }));
    doc = addNode(doc, makeShapeNode('matte', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
    doc = addNode(doc, makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
    doc = reparentNode(doc, 'matte', 'g', 0);
    doc = reparentNode(doc, 'a', 'g', 1);
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        g: {
          ...(doc.nodes.g as unknown as Record<string, unknown>),
          mask: { type: 'clip', visible: true, sourceNodeId: 'matte' },
        } as never,
      },
    } as typeof doc;

    const target = resolveDropClipTarget(doc, 'matte', 'into');
    expect(target).not.toBeNull();
    expect(target!.clipInto).toBe(true);
    expect(target!.parentId).toBe('g');
    // Insertion right after the matte, keeping the matte at the head.
    expect(target!.index).toBe(1);
  });

  it('does not clip when dropping before/after the matte row', () => {
    let doc = createDocument('clip-drop-2', true);
    doc = addNode(doc, makeFrameNode('g', { w: 100, h: 100, children: [], name: 'Group' }));
    doc = addNode(doc, makeShapeNode('matte', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
    doc = reparentNode(doc, 'matte', 'g', 0);
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        g: {
          ...(doc.nodes.g as unknown as Record<string, unknown>),
          mask: { type: 'clip', visible: true, sourceNodeId: 'matte' },
        } as never,
      },
    } as typeof doc;

    expect(resolveDropClipTarget(doc, 'matte', 'before')?.clipInto).toBe(false);
    expect(resolveDropClipTarget(doc, 'matte', 'after')?.clipInto).toBe(false);
  });

  it('treats a plain container drop as a normal reparent (no clip semantics)', () => {
    let doc = createDocument('clip-drop-3', true);
    doc = addNode(doc, makeFrameNode('g', { w: 100, h: 100, children: [], name: 'Group' }));
    doc = addNode(doc, makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
    doc = reparentNode(doc, 'a', 'g', 0);

    const target = resolveDropClipTarget(doc, 'g', 'into');
    expect(target).not.toBeNull();
    expect(target!.clipInto).toBe(false);
    expect(target!.parentId).toBeNull();
  });

  it('does not clip when the mask is disabled', () => {
    let doc = createDocument('clip-drop-4', true);
    doc = addNode(doc, makeFrameNode('g', { w: 100, h: 100, children: [], name: 'Group' }));
    doc = addNode(doc, makeShapeNode('matte', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
    doc = reparentNode(doc, 'matte', 'g', 0);
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        g: {
          ...(doc.nodes.g as unknown as Record<string, unknown>),
          mask: { type: 'clip', visible: false, sourceNodeId: 'matte' },
        } as never,
      },
    } as typeof doc;

    expect(resolveDropClipTarget(doc, 'matte', 'into')?.clipInto).toBe(false);
  });
});
