/**
 * @vitest-environment jsdom
 *
 * Compound-path insert: holes become evenodd subpaths on the outer ring.
 */

import type { RasterTraceResult } from '@varve/engine';
import { createDocument, makeImageShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { insertTraceGroup } from './imageOperations';

describe('trace hole handling', () => {
  it('inserts compound paths with evenodd holes', () => {
    let doc = createDocument('Images', true);
    const image = makeImageShapeNode('img1', {
      name: 'Logo',
      w: 20,
      h: 20,
      src: 'data:image/png;base64,AAAA',
    });
    doc = { ...doc, nodes: { ...doc.nodes, [image.id]: image }, rootChildren: [image.id] };

    const traced: RasterTraceResult = {
      width: 20,
      height: 20,
      omittedHoles: 0,
      paths: [
        {
          closed: true,
          area: 100,
          bounds: { x: 0, y: 0, w: 10, h: 10 },
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
          holes: [
            [
              { x: 3, y: 3 },
              { x: 7, y: 3 },
              { x: 7, y: 7 },
              { x: 3, y: 7 },
            ],
          ],
        },
      ],
    };

    const result = insertTraceGroup(doc, image.id, traced);
    const group = result.doc.nodes[result.nodeId];
    expect(group?.kind).toBe('group');
    if (group?.kind !== 'group') return;
    const child = result.doc.nodes[group.children[0] as string];
    expect(child?.kind).toBe('shape');
    if (child?.kind !== 'shape' || child.shape.kind !== 'path') return;
    expect(child.shape.holes).toHaveLength(1);
    expect(child.shape.fillRule).toBe('evenodd');
    expect(child.shape.holes?.[0]).toHaveLength(4);
  });

  it('still inserts when omittedHoles is reported (diagnostic only)', () => {
    let doc = createDocument('Images', true);
    const image = makeImageShapeNode('img1', {
      name: 'Logo',
      w: 20,
      h: 20,
      src: 'data:image/png;base64,AAAA',
    });
    doc = { ...doc, nodes: { ...doc.nodes, [image.id]: image }, rootChildren: [image.id] };

    const traced: RasterTraceResult = {
      width: 20,
      height: 20,
      omittedHoles: 2,
      paths: [
        {
          closed: true,
          area: 100,
          bounds: { x: 0, y: 0, w: 10, h: 10 },
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        },
      ],
    };

    expect(() => insertTraceGroup(doc, image.id, traced)).not.toThrow();
  });
});

describe('centerline stroke output', () => {
  it('inserts open centerline paths as stroked nodes with no fill', () => {
    let doc = createDocument('Images', true);
    const image = makeImageShapeNode('img2', {
      name: 'Sketch',
      w: 20,
      h: 20,
      src: 'data:image/png;base64,AAAA',
    });
    doc = { ...doc, nodes: { ...doc.nodes, [image.id]: image }, rootChildren: [image.id] };

    const traced: RasterTraceResult = {
      width: 20,
      height: 20,
      omittedHoles: 0,
      paths: [
        {
          closed: false,
          strokeWidth: 3,
          area: 20,
          bounds: { x: 2, y: 2, w: 16, h: 4 },
          points: [
            { x: 2, y: 4 },
            { x: 8, y: 4 },
            { x: 18, y: 4 },
          ],
        },
      ],
    };

    const result = insertTraceGroup(doc, image.id, {
      ...traced,
      traceMode: 'centerline',
      centerlineWidth: 3,
    });
    const group = result.doc.nodes[result.nodeId];
    expect(group?.kind).toBe('group');
    const childId = group?.kind === 'group' ? group.children[0] : undefined;
    const child = childId ? result.doc.nodes[childId] : undefined;
    expect(child?.kind).toBe('shape');
    if (child?.kind !== 'shape') return;
    expect(child.shape.kind).toBe('path');
    if (child.shape.kind !== 'path') return;
    expect(child.shape.closed).toBe(false);
    expect(child.fill).toEqual({ space: 'rgb', r: 0, g: 0, b: 0, a: 0 });
    expect(child.strokes).toHaveLength(1);
    expect(child.strokes[0]?.weight).toBe(3);
    expect(child.strokes[0]?.color).toEqual({ space: 'rgb', r: 0, g: 0, b: 0, a: 255 });
  });

  it('still fills closed pixel-art style paths', () => {
    let doc = createDocument('Images', true);
    const image = makeImageShapeNode('img3', {
      name: 'Sprite',
      w: 8,
      h: 8,
      src: 'data:image/png;base64,AAAA',
    });
    doc = { ...doc, nodes: { ...doc.nodes, [image.id]: image }, rootChildren: [image.id] };

    const traced: RasterTraceResult = {
      width: 8,
      height: 8,
      omittedHoles: 0,
      paths: [
        {
          closed: true,
          area: 4,
          bounds: { x: 2, y: 2, w: 2, h: 2 },
          points: [
            { x: 2, y: 2 },
            { x: 4, y: 2 },
            { x: 4, y: 4 },
            { x: 2, y: 4 },
          ],
          fill: { r: 255, g: 0, b: 0, a: 255 },
        },
      ],
    };

    const result = insertTraceGroup(doc, image.id, traced);
    const group = result.doc.nodes[result.nodeId];
    const childId = group?.kind === 'group' ? group.children[0] : undefined;
    const child = childId ? result.doc.nodes[childId] : undefined;
    if (child?.kind !== 'shape') return;
    expect(child.shape.kind).toBe('path');
    if (child.shape.kind !== 'path') return;
    expect(child.shape.closed).toBe(true);
    expect(child.fill).toEqual({ space: 'rgb', r: 255, g: 0, b: 0, a: 255 });
    expect(child.strokes).toHaveLength(0);
  });
});
