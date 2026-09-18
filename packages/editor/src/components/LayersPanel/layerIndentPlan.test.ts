/**
 * Tests for the indent/outdent planners — the non-drag reparenting path
 * (WCAG 2.5.7 alternative; keyboard Ctrl+Alt+[ / ] and the context menu).
 *
 * Order model reminder: children[] is back-to-front, the panel displays
 * front-most first, so entries[0] is the top displayed row.
 */

import type { Document } from '@varve/scene';
import { addChild, createDocument, makeFrameNode, makeShapeNode, nextNodeId } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { containerForPlan, orderRootsForAppend, planIndent, planOutdent } from './layerIndentPlan';
import { flattenTree } from './useFlatTree';

/**
 * Document shape (visual panel order top→bottom):
 *   F2            (frame, page content root, front-most)
 *   F1            (frame, page content root)
 *   G1            (group inside F1)
 *   S-g1          (leaf inside G1)
 *   S-back        (leaf inside F1, back-most of F1)
 */
function makeNestedDoc(): {
  doc: Document;
  rootId: string;
  f1: string;
  f2: string;
  g1: string;
  sBack: string;
  sG1: string;
} {
  let doc = createDocument();
  const page = doc.pages?.[0];
  const rootId = page?.contentRoot as string;
  const { id: f1, doc: d1 } = nextNodeId(doc);
  doc = d1;
  doc = addChild(doc, rootId, makeFrameNode(f1, { name: 'F1', w: 100, h: 100, children: [] }));

  const { id: sBack, doc: d2 } = nextNodeId(doc);
  doc = d2;
  doc = addChild(
    doc,
    f1,
    makeShapeNode(sBack, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'S-back' }),
  );

  const { id: g1, doc: d3 } = nextNodeId(doc);
  doc = d3;
  doc = addChild(doc, f1, makeFrameNode(g1, { name: 'G1', w: 50, h: 50, children: [] }));

  const { id: sG1, doc: d4 } = nextNodeId(doc);
  doc = d4;
  doc = addChild(
    doc,
    g1,
    makeShapeNode(sG1, { kind: 'rect', x: 0, y: 0, w: 5, h: 5 }, { name: 'S-g1' }),
  );

  const { id: f2, doc: d5 } = nextNodeId(doc);
  doc = d5;
  doc = addChild(doc, rootId, makeFrameNode(f2, { name: 'F2', w: 80, h: 80, children: [] }));

  return { doc, rootId, f1, f2, g1, sBack, sG1 };
}

function entriesFor(doc: Document) {
  return flattenTree(doc, new Set(Object.keys(doc.nodes)), undefined, undefined, doc.activePageId);
}

describe('planIndent', () => {
  it('targets the container displayed directly above the focused row', () => {
    const { doc, g1, sG1 } = makeNestedDoc();
    const entries = entriesFor(doc);
    // Display order: f2, f1, g1, sG1, sBack — G1's row sits directly above S-g1.
    const sG1Idx = entries.findIndex((e) => e.node.id === sG1);
    const plan = planIndent(doc, entries, sG1Idx, [sG1], null);
    expect(plan).toEqual({ kind: 'indent', containerId: g1 });
  });

  it('refuses to indent under a leaf row', () => {
    const { doc, sG1, sBack } = makeNestedDoc();
    const entries = entriesFor(doc);
    const sBackIdx = entries.findIndex((e) => e.node.id === sBack);
    // sanity: the row above S-back is the leaf S-g1
    expect(entries[sBackIdx - 1]?.node.id).toBe(sG1);
    const plan = planIndent(doc, entries, sBackIdx, [sBack], null);
    expect(plan).toEqual({ kind: 'invalid', reason: 'row-above-not-container' });
  });

  it('reports no-row-above when the focused row is the first displayed row', () => {
    const { doc, f2 } = makeNestedDoc();
    const entries = entriesFor(doc);
    const f2Idx = entries.findIndex((e) => e.node.id === f2);
    expect(f2Idx).toBe(0);
    const plan = planIndent(doc, entries, f2Idx, [f2], null);
    expect(plan).toEqual({ kind: 'invalid', reason: 'no-row-above' });
  });

  it('skips rows inside another moved subtree and lands on the nearest real target', () => {
    const { doc, f1, f2, sBack } = makeNestedDoc();
    const entries = entriesFor(doc);
    const sBackIdx = entries.findIndex((e) => e.node.id === sBack);
    // Moving F1 and S-back together: rows above S-back (S-g1, G1, F1) all
    // belong to F1's moved subtree — skipped — so the target is F2.
    const plan = planIndent(doc, entries, sBackIdx, [f1, sBack], null);
    expect(plan).toEqual({ kind: 'indent', containerId: f2 });
  });

  it('skips a moved container row above the focus and retargets its parent container', () => {
    const { doc, f1, g1, sG1 } = makeNestedDoc();
    const entries = entriesFor(doc);
    const sG1Idx = entries.findIndex((e) => e.node.id === sG1);
    // Moving G1 and S-g1 together: G1's own row sits directly above S-g1 and
    // belongs to the moved set — skipped — so the target is F1 (G1's parent;
    // appending there is the legal nearest reposition, not a cycle).
    const plan = planIndent(doc, entries, sG1Idx, [g1, sG1], null);
    expect(plan).toEqual({ kind: 'indent', containerId: f1 });
  });
});

describe('planOutdent', () => {
  it('inserts at the parent slot in the grandparent, landing below the parent block', () => {
    const { doc, f1, g1, sG1 } = makeNestedDoc();
    const entries = entriesFor(doc);
    const sG1Idx = entries.findIndex((e) => e.node.id === sG1);
    expect(entries[sG1Idx]?.parentId).toBe(g1);
    const plan = planOutdent(doc, sG1, undefined, null);
    // G1's slot inside F1's children: F1.children is [sBack, g1] (raw
    // back-to-front), so G1's index is 1.
    expect(plan).toEqual({ kind: 'outdent', parentId: f1, index: 1 });
  });

  it('outdents a frame child onto the page content root at the frame slot', () => {
    const { doc, rootId, f1, sBack } = makeNestedDoc();
    const plan = planOutdent(doc, sBack, undefined, null);
    // S-back lives in F1; F1 sits at index 0 of the content root's children.
    expect(plan).toEqual({ kind: 'outdent', parentId: rootId, index: 0 });
    void f1;
  });

  it('refuses to outdent a row that is already at the top level', () => {
    const { doc, f2 } = makeNestedDoc();
    const plan = planOutdent(doc, f2, undefined, null);
    expect(plan).toEqual({ kind: 'invalid', reason: 'already-root' });
  });
});

describe('orderRootsForAppend', () => {
  it('returns roots back-most first so sequential appends keep their stacking', () => {
    const { doc, sBack, sG1, f2 } = makeNestedDoc();
    const entries = entriesFor(doc);
    // Display order top→bottom: f2, f1, g1, sG1, sBack. Appending in the
    // returned order (sBack, sG1, f2) makes F2 the last child = front-most,
    // matching the selection's original stacking.
    const ordered = orderRootsForAppend(entries, [sBack, f2, sG1]);
    expect(ordered).toEqual([sBack, sG1, f2]);
  });
});

describe('containerForPlan', () => {
  it('resolves containers and rejects leaves', () => {
    const { doc, g1, sG1 } = makeNestedDoc();
    expect(containerForPlan(doc, g1)?.name).toBe('G1');
    expect(containerForPlan(doc, sG1)).toBeUndefined();
  });
});
