/**
 * Mask/clipping invariant tests for the editing operations that historically
 * could corrupt the clipping graph:
 *
 *  - setMaskSourceNode must reject cycles (it bypassed the addMask pre-check)
 *  - frame/group containers cannot clip to an adjustment node (no geometry)
 *  - reparenting a mask source out of its container must release the mask
 *    instead of leaving a dangling reference
 *  - deepCloneSubtree must remap mask sources and adjustment scopes through
 *    the clone idMap, and drop foreign references on cross-document paste
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
  setMaskSourceNode,
  validateMasks,
} from '../index';

function maskOf(doc: import('../types').Document, id: string) {
  return (doc.nodes[id] as { mask?: import('../types').Mask }).mask;
}

/**
 * Build a nested tree the way the editor does — nodes enter the document at
 * root level via addNode and are nested via reparentNode (which removes the
 * child from rootChildren). addChild alone leaves the node in both
 * rootChildren and the container, which defeats getParent.
 */
function nest(doc: import('../types').Document, childId: string, parentId: string, index: number) {
  return reparentNode(doc, childId, parentId, index);
}

function clipGroupFixture(): import('../types').Document {
  let doc = createDocument('clip-fixture', true);
  doc = addNode(doc, makeGroupNode('root', { children: [] }));
  doc = addNode(doc, makeGroupNode('g', { children: [] }));
  doc = addNode(doc, makeShapeNode('matte', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 }));
  doc = addNode(doc, makeShapeNode('content', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 }));
  doc = nest(doc, 'g', 'root', 0);
  doc = nest(doc, 'matte', 'g', 0);
  doc = nest(doc, 'content', 'g', 1);
  return doc;
}

describe('mask invariants', () => {
  it('addMask rejects an adjustment->adjustment mask cycle', () => {
    // Only adjustments may mask arbitrary nodes, so the only reachable
    // cycle is two adjustments masking each other.
    let doc = createDocument('adj-cycle', true);
    const adjA = makeAdjustmentNode('adjA', 'levels', { channel: 'rgb' });
    const adjB = makeAdjustmentNode('adjB', 'levels', { channel: 'rgb' });
    doc = addNode(doc, adjA);
    doc = addNode(doc, adjB);

    doc = addMask(doc, 'adjA', 'adjB', 'alpha');
    expect(maskOf(doc, 'adjA')?.sourceNodeId).toBe('adjB');

    // adjB masking adjA completes the cycle — must be rejected.
    doc = addMask(doc, 'adjB', 'adjA', 'alpha');
    expect(maskOf(doc, 'adjB')).toBeUndefined();
  });

  it('setMaskSourceNode rejects a cycle introduced by retargeting', () => {
    let doc = createDocument('adj-cycle-2', true);
    const adjA = makeAdjustmentNode('adjA', 'levels', { channel: 'rgb' });
    const adjB = makeAdjustmentNode('adjB', 'levels', { channel: 'rgb' });
    const adjC = makeAdjustmentNode('adjC', 'levels', { channel: 'rgb' });
    const leaf = makeShapeNode('leaf', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    doc = addNode(doc, adjA);
    doc = addNode(doc, adjB);
    doc = addNode(doc, adjC);
    doc = addNode(doc, leaf);

    // Chain A → B → C. No cycle yet.
    doc = addMask(doc, 'adjA', 'adjB', 'alpha');
    doc = addMask(doc, 'adjB', 'adjC', 'alpha');
    expect(maskOf(doc, 'adjB')?.sourceNodeId).toBe('adjC');

    // Give adjC a legal mask, then retarget it to adjA — that closes the
    // A → B → C → A loop, which setMaskSourceNode must reject (it previously
    // bypassed the addMask cycle pre-check).
    doc = addMask(doc, 'adjC', 'leaf', 'alpha');
    expect(maskOf(doc, 'adjC')?.sourceNodeId).toBe('leaf');
    doc = setMaskSourceNode(doc, 'adjC', 'adjA');
    expect(maskOf(doc, 'adjC')?.sourceNodeId).toBe('leaf');

    // Retargeting without closing a loop stays legal: adjC → adjA is fine
    // once adjA no longer points at adjB (A→leaf, B→C, C→A is acyclic).
    doc = setMaskSourceNode(doc, 'adjA', 'leaf');
    expect(maskOf(doc, 'adjA')?.sourceNodeId).toBe('leaf');
    doc = setMaskSourceNode(doc, 'adjC', 'adjA');
    expect(maskOf(doc, 'adjC')?.sourceNodeId).toBe('adjA');
  });

  it('rejects a frame/group mask whose source is an adjustment node', () => {
    let doc = createDocument('adj-source', true);
    doc = addNode(doc, makeGroupNode('g', { children: [] }));
    doc = addNode(doc, makeAdjustmentNode('adj', 'levels', { channel: 'rgb' }));
    doc = nest(doc, 'adj', 'g', 0);

    doc = addMask(doc, 'g', 'adj', 'clip');
    expect(maskOf(doc, 'g')).toBeUndefined();
    expect(validateMasks(doc)).toEqual([]);
  });

  it('setMaskSourceNode rejects an adjustment source for a frame/group', () => {
    let doc = createDocument('adj-source-2', true);
    doc = addNode(doc, makeGroupNode('g', { children: [] }));
    doc = addNode(doc, makeShapeNode('s', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
    doc = addNode(doc, makeAdjustmentNode('adj', 'levels', { channel: 'rgb' }));
    doc = nest(doc, 's', 'g', 0);
    doc = nest(doc, 'adj', 'g', 1);

    doc = addMask(doc, 'g', 's', 'clip');
    expect(maskOf(doc, 'g')?.sourceNodeId).toBe('s');
    doc = setMaskSourceNode(doc, 'g', 'adj');
    expect(maskOf(doc, 'g')?.sourceNodeId).toBe('s');
  });

  it('reparenting a mask source out of its container releases the mask', () => {
    let doc = clipGroupFixture();
    doc = addMask(doc, 'g', 'matte', 'clip');
    expect(maskOf(doc, 'g')?.sourceNodeId).toBe('matte');

    // Drag the matte out of the group → the mask must not dangle.
    doc = reparentNode(doc, 'matte', 'root', 0);
    expect(maskOf(doc, 'g')).toBeUndefined();
    expect(validateMasks(doc)).toEqual([]);
    expect(doc.nodes.matte !== undefined).toBe(true);
  });

  it('moving the mask source within its container keeps the mask', () => {
    let doc = clipGroupFixture();
    doc = addNode(doc, makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 }));
    doc = nest(doc, 'a', 'g', 1);
    doc = addMask(doc, 'g', 'matte', 'clip');

    // Reorder the matte within the run — still a child, still valid.
    doc = reparentNode(doc, 'matte', 'g', 2);
    expect(maskOf(doc, 'g')?.sourceNodeId).toBe('matte');
    expect(validateMasks(doc)).toEqual([]);
  });
});
