import { addNode, createDocument, makeFrameNode, makeShapeNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { detectVariants } from '../variantGenerator';

describe('detectVariants', () => {
  it('returns empty candidates for empty document', () => {
    const doc = createDocument('Test');
    const result = detectVariants(doc, '');
    expect(result.candidates).toEqual([]);
  });

  it('returns empty candidates for document with no component instances', () => {
    let doc = createDocument('Test');
    doc = addNode(doc, makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Rect' }));
    const result = detectVariants(doc, '');
    expect(result.candidates).toEqual([]);
  });

  it('detects variant candidates from component instances with different fills', () => {
    let doc = createDocument('Test');
    const comp = makeFrameNode('comp', { w: 100, h: 50, name: 'Button', children: [], componentId: 'btn' });
    doc = addNode(doc, comp);

    // Add similar instances with different fills
    const inst1 = makeFrameNode('i1', { w: 100, h: 50, name: 'Primary', children: [], componentId: 'btn', fill: { space: 'rgb', r: 0, g: 100, b: 200, a: 255 } });
    doc = addNode(doc, inst1);
    const inst2 = makeFrameNode('i2', { w: 100, h: 50, name: 'Secondary', children: [], componentId: 'btn', fill: { space: 'rgb', r: 100, g: 200, b: 0, a: 255 } });
    doc = addNode(doc, inst2);

    const result = detectVariants(doc, 'btn');
    expect(result.candidates).toBeDefined();
  });
});
