import type { Document } from '@varve/scene';
import {
  addChild,
  addNode,
  createDocument,
  createLiveBooleanDoc,
  makeGroupNode,
  makeShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { computeDocumentBounds, exportDocumentToSvg } from './index';
import { exportNodeToSvg } from './svg';

describe('SVG path export', () => {
  it('exports a live Boolean as its resolved compound path', () => {
    let doc = createDocument('Live Boolean export', true);
    doc = addNode(doc, makeShapeNode('base', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }));
    doc = addNode(doc, makeShapeNode('cut', { kind: 'rect', x: 25, y: 25, w: 50, h: 50 }));
    const created = createLiveBooleanDoc(doc, ['base', 'cut'], 'subtract');
    expect(created).not.toBeNull();
    if (!created) return;
    doc = created.doc;

    const live = {
      ...doc.nodes[created.nodeId]!,
      transform: [1, 0, 0, 1, 40, 30] as const,
    };
    doc = { ...doc, nodes: { ...doc.nodes, [created.nodeId]: live } };
    const selectedSvg = exportNodeToSvg(live, doc, { background: 'transparent' });
    expect(selectedSvg).toContain('viewBox="40 30 100 100"');
    expect(selectedSvg).toContain('<path');
    expect(selectedSvg).toContain('fill-rule="evenodd"');
    expect(selectedSvg).toContain('M 75 25 L 75 75 L 25 75 L 25 25 Z');
    expect(selectedSvg).not.toContain('<rect x="0" y="0" width="100" height="100"');

    const documentSvg = exportDocumentToSvg(doc);
    // Only the document backdrop remains a rect; the live group's source
    // operands must not leak into a document export.
    expect(documentSvg.match(/<rect /g)?.length).toBe(1);
    expect(documentSvg).toContain('fill-rule="evenodd"');
    expect(documentSvg).toContain('transform="matrix(1,0,0,1,40,30)"');
  });

  it('exports shape path nodes as SVG path data', () => {
    const node = makeShapeNode(
      'p1',
      {
        kind: 'path',
        closed: true,
        tolerance: 1,
        points: [
          { x: 0, y: 0, handleIn: null, handleOut: null },
          { x: 10, y: 0, handleIn: null, handleOut: null },
          { x: 10, y: 10, handleIn: null, handleOut: null },
          { x: 0, y: 10, handleIn: null, handleOut: null },
        ],
      },
      { fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
    );
    const doc = {
      ...createDocument('Path export', true),
      rootChildren: ['p1'],
      nodes: { p1: node },
    };

    const svg = exportDocumentToSvg(doc);

    expect(svg).toContain('<path');
    expect(svg).toContain('d="M 0 0 L 10 0 L 10 10 L 0 10 Z"');
  });

  it('exports compound path holes with evenodd fill-rule', () => {
    const node = makeShapeNode(
      'p1',
      {
        kind: 'path',
        closed: true,
        tolerance: 1,
        fillRule: 'evenodd',
        points: [
          { x: 0, y: 0, handleIn: null, handleOut: null },
          { x: 20, y: 0, handleIn: null, handleOut: null },
          { x: 20, y: 20, handleIn: null, handleOut: null },
          { x: 0, y: 20, handleIn: null, handleOut: null },
        ],
        holes: [
          [
            { x: 5, y: 5, handleIn: null, handleOut: null },
            { x: 15, y: 5, handleIn: null, handleOut: null },
            { x: 15, y: 15, handleIn: null, handleOut: null },
            { x: 5, y: 15, handleIn: null, handleOut: null },
          ],
        ],
      },
      { fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
    );
    const doc = {
      ...createDocument('Compound path export', true),
      rootChildren: ['p1'],
      nodes: { p1: node },
    };

    const svg = exportDocumentToSvg(doc);

    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('M 5 5 L 15 5 L 15 15 L 5 15 Z');
  });

  it('sizes a selected trace group SVG to its path children', () => {
    const group = makeGroupNode('g1', { name: 'Trace', transform: [1, 0, 0, 1, 40, 30] });
    const path = makeShapeNode('p1', {
      kind: 'path',
      closed: true,
      tolerance: 1,
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: null },
        { x: 250, y: 0, handleIn: null, handleOut: null },
        { x: 250, y: 10, handleIn: null, handleOut: null },
        { x: 0, y: 10, handleIn: null, handleOut: null },
      ],
    });
    let doc: Document = {
      ...createDocument('Trace export', true),
      rootChildren: ['g1'],
      nodes: { g1: group },
    };
    doc = addChild(doc, 'g1', path);

    const svg = exportNodeToSvg(doc.nodes.g1!, doc);

    expect(svg).toContain('viewBox="40 30 250 10"');

    const documentSvg = exportDocumentToSvg(doc);
    const viewBox = documentSvg.match(/viewBox="[^ ]+ [^ ]+ ([^ ]+) ([^"]+)"/);
    expect(computeDocumentBounds(doc).w).toBeGreaterThanOrEqual(250);
    expect(Number(viewBox?.[1])).toBeGreaterThanOrEqual(250);
  });
});
