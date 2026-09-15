/**
 * Tests for the Web Component emitter.
 */

import { createDocument, makeShapeNode, makeTextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { exportNodeToWebComponent, webComponentTargetGaps } from '../web-component';

describe('exportNodeToWebComponent', () => {
  it('emits a custom element class for a rect shape', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 }, { name: 'Box' });
    const wc = exportNodeToWebComponent(node, doc);
    expect(wc).toContain('class Box extends HTMLElement');
    expect(wc).toContain('customElements.define(');
    expect(wc).toContain('template.innerHTML');
    expect(wc).toContain('display: block');
  });

  it('emits Shadow DOM by default', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Rect' });
    const wc = exportNodeToWebComponent(node, doc);
    expect(wc).toContain('attachShadow');
  });

  it('emits without Shadow DOM when useShadowDom=false', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Rect' });
    const wc = exportNodeToWebComponent(node, doc, { useShadowDom: false });
    expect(wc).not.toContain('attachShadow');
  });

  it('emits text as a span', () => {
    const doc = createDocument('Test');
    const node = makeTextNode('t1', 'Hello WebC', { fontSize: 16 });
    const wc = exportNodeToWebComponent(node, doc);
    expect(wc).toContain('<span');
    expect(wc).toContain('Hello WebC');
  });
});

describe('webComponentTargetGaps', () => {
  it('reports gaps for gradient fills', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Box' });
    (node as unknown as Record<string, unknown>).fills = [
      {
        type: 'gradient',
        gradient: { type: 'angular', stops: [] },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ];
    const gaps = webComponentTargetGaps(node, doc);
    expect(gaps.length).toBeGreaterThan(0);
  });

  it('no gaps for basic rect', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Box' });
    const gaps = webComponentTargetGaps(node, doc);
    expect(gaps.length).toBe(0);
  });
});
