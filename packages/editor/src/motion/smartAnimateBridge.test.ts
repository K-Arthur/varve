import { createDocument, makeFrameNode, makeShapeNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { computeSmartAnimateTransition } from './smartAnimateBridge';

describe('computeSmartAnimateTransition', () => {
  it('returns null when no matching layer names', () => {
    const doc = createDocument('test');
    const f1 = makeFrameNode('f1', { name: 'Screen A', w: 400, h: 800 });
    const f2 = makeFrameNode('f2', { name: 'Screen B', w: 400, h: 800 });
    const s1 = makeShapeNode('s1', { kind: 'rect', w: 100, h: 100 }, { name: 'Box A' });
    const s2 = makeShapeNode('s2', { kind: 'rect', w: 100, h: 100 }, { name: 'Box B' });
    doc.nodes[f1.id] = f1;
    doc.nodes[f2.id] = f2;
    doc.nodes[s1.id] = s1;
    doc.nodes[s2.id] = s2;
    f1.children = [s1.id];
    f2.children = [s2.id];
    doc.rootChildren = [f1.id, f2.id];

    expect(computeSmartAnimateTransition(doc, f1.id, f2.id)).toBeNull();
  });

  it('computes values for matching layer names', () => {
    const doc = createDocument('test');
    const f1 = makeFrameNode('f1', { name: 'Screen A', w: 400, h: 800 });
    const f2 = makeFrameNode('f2', { name: 'Screen B', w: 400, h: 800 });
    const s1 = makeShapeNode('s1', { kind: 'rect', w: 100, h: 100 }, { name: 'Hero' });
    const s2 = makeShapeNode('s2', { kind: 'rect', w: 120, h: 120 }, { name: 'Hero' });
    doc.nodes[f1.id] = f1;
    doc.nodes[f2.id] = f2;
    doc.nodes[s1.id] = s1;
    doc.nodes[s2.id] = s2;
    f1.children = [s1.id];
    f2.children = [s2.id];
    doc.rootChildren = [f1.id, f2.id];

    const result = computeSmartAnimateTransition(doc, f1.id, f2.id);
    expect(result).not.toBeNull();
    expect(result?.values.Hero).toBeDefined();
  });
});
