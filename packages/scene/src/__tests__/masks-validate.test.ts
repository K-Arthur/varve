import { describe, expect, it } from 'vitest';
import {
  addNode,
  createDocument,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  removeNode,
} from '../document';
import { clearMaskSource, findNodesUsingMaskSource, isMaskSource, validateMasks } from '../masks';

describe('findNodesUsingMaskSource', () => {
  it('returns empty array when no masks use source', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    const doc = addNode(createDocument(), shape);
    expect(findNodesUsingMaskSource(doc, 'n1')).toEqual([]);
  });

  it('returns node IDs that reference the source', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    expect(findNodesUsingMaskSource(doc, 'n1')).toEqual(['f1']);
  });

  it('finds masks on groups AND frames', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    const group = makeGroupNode('g1', { children: ['n1'] });
    group.mask = { type: 'alpha', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = addNode(doc, group);
    const result = findNodesUsingMaskSource(doc, 'n1');
    expect(result).toContain('f1');
    expect(result).toContain('g1');
  });
});

describe('clearMaskSource', () => {
  it('removes mask from nodes referencing source', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = clearMaskSource(doc, 'n1');
    const updatedFrame = doc.nodes.f1 as { mask?: unknown };
    expect(updatedFrame.mask).toBeUndefined();
  });

  it('is idempotent (already cleared)', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = clearMaskSource(doc, 'n1');
    const doc2 = clearMaskSource(doc, 'n1');
    const updatedFrame = doc2.nodes.f1 as { mask?: unknown };
    expect(updatedFrame.mask).toBeUndefined();
  });
});

describe('validateMasks', () => {
  it('returns empty for clean document', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    expect(validateMasks(doc)).toEqual([]);
  });

  it('finds dangling mask reference', () => {
    const frame = makeFrameNode('f1');
    frame.mask = { type: 'clip', sourceNodeId: 'nonexistent', visible: true };
    const doc = addNode(createDocument(), frame);
    expect(validateMasks(doc)).toEqual(['f1']);
  });
});

describe('removeNode mask cleanup', () => {
  it('clears masks that reference removed node', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = removeNode(doc, 'n1');
    const updatedFrame = doc.nodes.f1 as { mask?: unknown };
    expect(updatedFrame.mask).toBeUndefined();
  });
});

describe('isMaskSource', () => {
  it('returns true when node is used as mask', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    expect(isMaskSource(doc, 'n1')).toBe(true);
  });

  it('returns false when node is not used as mask', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    const doc = addNode(createDocument(), shape);
    expect(isMaskSource(doc, 'n1')).toBe(false);
  });
});
