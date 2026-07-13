import type { Document } from '@strata/scene';
import { addChild, createDocument, makeGroupNode, makeShapeNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { computeDocumentBounds, exportDocumentToSvg } from './index';
import { exportNodeToSvg } from './svg';

describe('SVG path export', () => {
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
