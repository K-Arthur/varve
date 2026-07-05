import { addChild, addNode, createDocument, makeFrameNode, makeShapeNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import {
  getOrCreateParentCache,
  getParentFast,
  isDescendantFast,
  type ParentIndexCache,
} from '../parentIndexCache';

function buildDoc() {
  let doc = createDocument();

  const frameA = makeFrameNode('f1', { name: 'FrameA', w: 200, h: 200 });
  doc = addNode(doc, frameA);

  const rect1 = makeShapeNode('r1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 }, { name: 'Rect1' });
  doc = addChild(doc, 'f1', rect1);

  const rect2 = makeShapeNode('r2', { kind: 'rect', x: 60, y: 0, w: 50, h: 50 }, { name: 'Rect2' });
  doc = addChild(doc, 'f1', rect2);

  const innerFrame = makeFrameNode('f2', { name: 'InnerFrame', w: 100, h: 100 });
  doc = addChild(doc, 'f1', innerFrame);

  const rect3 = makeShapeNode('r3', { kind: 'rect', x: 0, y: 0, w: 30, h: 30 }, { name: 'Rect3' });
  doc = addChild(doc, 'f2', rect3);

  const rectRoot = makeShapeNode('root_r', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }, { name: 'RootRect' });
  doc = addNode(doc, rectRoot);

  return doc;
}

describe('parentIndexCache', () => {
  it('getOrCreateParentCache returns cached when docRef matches', () => {
    const doc = buildDoc();
    const cache1: ParentIndexCache = {
      parentMap: new Map([['r1', 'f1']]),
      docRef: doc,
    };
    const result = getOrCreateParentCache(doc, cache1);
    expect(result).toBe(cache1);
    expect(result.parentMap.get('r1')).toBe('f1');
  });

  it('getOrCreateParentCache rebuilds when docRef changes', () => {
    const doc1 = buildDoc();
    const doc2 = buildDoc();
    const cache1: ParentIndexCache = {
      parentMap: new Map([['r1', 'f1']]),
      docRef: doc1,
    };
    const result = getOrCreateParentCache(doc2, cache1);
    expect(result).not.toBe(cache1);
    expect(result.docRef).toBe(doc2);
    expect(result.parentMap.get('r1')).toBe('f1');
  });

  it('getOrCreateParentCache builds fresh cache when no cache provided', () => {
    const doc = buildDoc();
    const result = getOrCreateParentCache(doc);
    expect(result.docRef).toBe(doc);
    expect(result.parentMap.get('r1')).toBe('f1');
    expect(result.parentMap.get('r2')).toBe('f1');
    expect(result.parentMap.get('f2')).toBe('f1');
    expect(result.parentMap.get('r3')).toBe('f2');
  });

  it('getParentFast returns correct parent', () => {
    const doc = buildDoc();
    const cache = getOrCreateParentCache(doc);
    expect(getParentFast(doc, 'r1', cache)).toBe('f1');
    expect(getParentFast(doc, 'r3', cache)).toBe('f2');
  });

  it('getParentFast returns null for root node', () => {
    const doc = buildDoc();
    const cache = getOrCreateParentCache(doc);
    const rootChildren = doc.rootChildren;
    for (const id of rootChildren) {
      expect(getParentFast(doc, id, cache)).toBeNull();
    }
  });

  it('getParentFast returns null for non-existent node', () => {
    const doc = buildDoc();
    const cache = getOrCreateParentCache(doc);
    expect(getParentFast(doc, 'nonexistent', cache)).toBeNull();
  });

  it('isDescendantFast returns true for direct child', () => {
    const doc = buildDoc();
    const cache = getOrCreateParentCache(doc);
    expect(isDescendantFast(doc, 'f1', 'r1', cache)).toBe(true);
    expect(isDescendantFast(doc, 'f1', 'r2', cache)).toBe(true);
  });

  it('isDescendantFast returns true for deep descendant', () => {
    const doc = buildDoc();
    const cache = getOrCreateParentCache(doc);
    expect(isDescendantFast(doc, 'f1', 'r3', cache)).toBe(true);
    expect(isDescendantFast(doc, 'f1', 'f2', cache)).toBe(true);
    expect(isDescendantFast(doc, 'f2', 'r3', cache)).toBe(true);
  });

  it('isDescendantFast returns false for non-descendant', () => {
    const doc = buildDoc();
    const cache = getOrCreateParentCache(doc);
    expect(isDescendantFast(doc, 'f2', 'r1', cache)).toBe(false);
    expect(isDescendantFast(doc, 'f1', 'root_r', cache)).toBe(false);
    expect(isDescendantFast(doc, 'f2', 'root_r', cache)).toBe(false);
  });

  it('isDescendantFast returns true for self (node is ancestor of itself)', () => {
    const doc = buildDoc();
    const cache = getOrCreateParentCache(doc);
    expect(isDescendantFast(doc, 'f1', 'f1', cache)).toBe(true);
    expect(isDescendantFast(doc, 'r1', 'r1', cache)).toBe(true);
  });

  it('getParentFast falls back to O(n) when no cache provided', () => {
    const doc = buildDoc();
    expect(getParentFast(doc, 'r1')).toBe('f1');
    expect(getParentFast(doc, 'root_r')).toBeNull();
  });

  it('isDescendantFast falls back to O(n) when no cache provided', () => {
    const doc = buildDoc();
    expect(isDescendantFast(doc, 'f1', 'r3')).toBe(true);
    expect(isDescendantFast(doc, 'f2', 'r1')).toBe(false);
  });
});
