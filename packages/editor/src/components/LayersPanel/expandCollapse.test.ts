/**
 * Tests for layers tree expand/collapse utilities.
 *
 * Research basis: Figma Collapse All, Alt+click subtree expand pattern,
 * Penpot/Inkscape Shift+click collapse subtree.
 */

import type { Document } from '@strata/scene';
import {
  addChild,
  addNode,
  createDocument,
  makeFrameNode,
  makeShapeNode,
  nextNodeId,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';

// Import the utility functions (they'll be exported from LayersTree.tsx)
import {
  collapseAll,
  collapseAllDescendants,
  collapseOthers,
  expandAllDescendants,
} from './LayersTree';

function makeNestedDoc(): { doc: Document; f1: string; f2: string; f3: string; r1: string } {
  let doc = createDocument();
  const { id: f1, doc: d2 } = nextNodeId(doc);
  doc = d2;
  doc = addNode(doc, makeFrameNode(f1, { name: 'F1', w: 100, h: 100, children: [] }));

  const { id: f2, doc: d3 } = nextNodeId(doc);
  doc = d3;
  doc = addChild(doc, f1, makeFrameNode(f2, { name: 'F2', w: 50, h: 50, children: [] }));

  const { id: f3, doc: d4 } = nextNodeId(doc);
  doc = d4;
  doc = addChild(doc, f2, makeFrameNode(f3, { name: 'F3', w: 25, h: 25, children: [] }));

  const { id: r1, doc: d5 } = nextNodeId(doc);
  doc = d5;
  doc = addNode(doc, makeShapeNode(r1, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'R1' }));

  return { doc, f1, f2, f3, r1 };
}

describe('expandAllDescendants', () => {
  it('expands all descendant containers recursively', () => {
    const { doc, f1, f2, f3 } = makeNestedDoc();
    const expanded = new Set<string>();
    const result = expandAllDescendants(doc, f1, expanded);

    expect(result.has(f1)).toBe(true);
    expect(result.has(f2)).toBe(true);
    expect(result.has(f3)).toBe(false);
  });

  it('does not expand non-container leaf nodes', () => {
    const { doc, f1, r1 } = makeNestedDoc();
    const expanded = new Set<string>();
    // f1 is a container, r1 is a shape — expandAllDescendants on f1
    const result = expandAllDescendants(doc, f1, expanded);

    expect(result.has(f1)).toBe(true);
    // r1 should NOT be in the result (it's not a descendant of f1)
    expect(result.has(r1)).toBe(false);
  });

  it('preserves existing expanded state beyond the subtree', () => {
    const { doc: baseDoc, f1, f2, f3 } = makeNestedDoc();

    // Also create a separate branch
    const { id: otherF, doc: d2 } = nextNodeId(baseDoc);
    let doc = d2;
    doc = addNode(doc, makeFrameNode(otherF, { name: 'Other', w: 50, h: 50, children: [] }));

    const expanded = new Set<string>([otherF]);
    const result = expandAllDescendants(doc, f1, expanded);

    expect(result.has(otherF)).toBe(true);
    expect(result.has(f1)).toBe(true);
    expect(result.has(f2)).toBe(true);
    expect(result.has(f3)).toBe(false);
  });

  it('returns same set when called on a non-container', () => {
    const { doc, r1 } = makeNestedDoc();
    const expanded = new Set<string>();
    const result = expandAllDescendants(doc, r1, expanded);

    expect(result.size).toBe(0);
  });

  it('does not add containers with no children', () => {
    const { doc, f1, f3 } = makeNestedDoc();
    const expanded = new Set<string>();
    const result = expandAllDescendants(doc, f1, expanded);

    // f3 has no children — expanding it is a no-op so it's not added
    expect(result.has(f3)).toBe(false);
  });
});

describe('collapseAllDescendants', () => {
  it('collapses the container and all descendant containers', () => {
    const { doc, f1, f2, f3 } = makeNestedDoc();
    const expanded = new Set<string>([f1, f2, f3]);
    const result = collapseAllDescendants(doc, f1, expanded);

    expect(result.has(f1)).toBe(false);
    expect(result.has(f2)).toBe(false);
    expect(result.has(f3)).toBe(false);
  });

  it('keeps unrelated containers expanded', () => {
    const { doc: baseDoc, f1, f2 } = makeNestedDoc();

    const { id: otherF, doc: d2 } = nextNodeId(baseDoc);
    let doc = d2;
    doc = addNode(doc, makeFrameNode(otherF, { name: 'Other', w: 50, h: 50, children: [] }));

    const expanded = new Set<string>([f1, f2, otherF]);
    const result = collapseAllDescendants(doc, f1, expanded);

    expect(result.has(f1)).toBe(false);
    expect(result.has(f2)).toBe(false);
    expect(result.has(otherF)).toBe(true);
  });

  it('removes all descendant containers even if container not in expanded set', () => {
    const { doc, f1, f2, f3 } = makeNestedDoc();
    const expanded = new Set<string>([f2, f3]);
    const result = collapseAllDescendants(doc, f1, expanded);

    expect(result.has(f1)).toBe(false);
    expect(result.has(f2)).toBe(false);
    expect(result.has(f3)).toBe(false);
  });
});

describe('collapseAll (Collapse All button)', () => {
  it('collapse all containers then expands ancestors of selected node', () => {
    const { doc, f1, f2, f3 } = makeNestedDoc();
    // F2 is selected; F1 and F2 should stay expanded
    const expanded = new Set<string>([f1, f2, f3]);
    const result = collapseAll(doc, f2, expanded);

    expect(result.has(f1)).toBe(true); // ancestor of f2
    expect(result.has(f2)).toBe(true); // the selected node itself (or its container ancestor)
    expect(result.has(f3)).toBe(false); // not on ancestor chain
  });

  it('returns empty set when no selection', () => {
    const { doc, f1 } = makeNestedDoc();
    const expanded = new Set<string>([f1]);
    const result = collapseAll(doc, undefined, expanded);

    expect(result.size).toBe(0);
  });

  it('expands ancestor chain for selected leaf node', () => {
    const { doc: baseDoc, f1, f2, f3 } = makeNestedDoc();
    // child of F3 (a shape) exists - selected node is inside f3
    const { id: shapeId, doc: d2 } = nextNodeId(baseDoc);
    let doc = d2;
    const shape = makeShapeNode(
      shapeId,
      { kind: 'rect', x: 0, y: 0, w: 5, h: 5 },
      { name: 'Deep' },
    );
    doc = addChild(doc, f3, shape);

    const expanded = new Set<string>([f1, f2, f3]);
    // The shape has no direct ancestors in expanded set,
    // but f3's ancestor chain (f1, f2, f3) should be re-expanded
    const result = collapseAll(doc, shapeId, expanded);

    expect(result.has(f1)).toBe(true);
    expect(result.has(f2)).toBe(true);
    expect(result.has(f3)).toBe(true);
  });
});

describe('collapseOthers', () => {
  it('collapses all containers except the specified one', () => {
    const { doc: baseDoc, f1, f2 } = makeNestedDoc();

    const { id: otherA, doc: d2 } = nextNodeId(baseDoc);
    let doc = d2;
    doc = addNode(doc, makeFrameNode(otherA, { name: 'A', w: 50, h: 50, children: [] }));

    const { id: otherB, doc: d3 } = nextNodeId(doc);
    doc = d3;
    doc = addNode(doc, makeFrameNode(otherB, { name: 'B', w: 50, h: 50, children: [] }));

    const expanded = new Set<string>([f1, f2, otherA, otherB]);
    const result = collapseOthers(doc, f1, expanded);

    expect(result.has(f1)).toBe(true); // kept
    expect(result.has(f2)).toBe(true); // descendant of f1, kept (since f2 is not in others logic, it's f1's descendant)
    expect(result.has(otherA)).toBe(false); // others collapsed
    expect(result.has(otherB)).toBe(false); // others collapsed
  });

  it('does nothing when specified container is the only one', () => {
    const { doc, f1 } = makeNestedDoc();
    const expanded = new Set<string>([f1]);
    const result = collapseOthers(doc, f1, expanded);

    expect(result.has(f1)).toBe(true);
    expect(result.size).toBe(1);
  });
});
