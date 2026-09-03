/**
 * @vitest-environment jsdom
 *
 * Compound-path insert: holes become evenodd subpaths on the outer ring.
 */

import type { RasterTraceResult } from '@varve/engine';
import { createDocument, makeImageShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { insertTraceGroup, replaceTraceGroup } from './imageOperations';

describe('trace hole handling', () => {
  it('retains and scales provider-fitted cubic handles exactly once', () => {
    let doc = createDocument('Images', true);
    const image = makeImageShapeNode('img-curves', {
      name: 'Curves',
      w: 20,
      h: 20,
      src: 'data:image/png;base64,AAAA',
    });
    doc = { ...doc, nodes: { ...doc.nodes, [image.id]: image }, rootChildren: [image.id] };

    const result = insertTraceGroup(doc, image.id, {
      width: 10,
      height: 10,
      paths: [
        {
          closed: true,
          curveFitted: true,
          points: [
            { x: 1, y: 1, handleIn: [-1, 0], handleOut: [1, 2] },
            { x: 9, y: 1 },
            { x: 9, y: 9 },
            { x: 1, y: 9 },
          ],
        },
      ],
    });
    const group = result.doc.nodes[result.nodeId];
    const childId = group?.kind === 'group' ? group.children[0] : undefined;
    const child = childId ? result.doc.nodes[childId] : undefined;
    expect(child?.kind).toBe('shape');
    if (child?.kind !== 'shape' || child.shape.kind !== 'path') return;
    expect(child.shape.points[0]).toEqual({
      x: 2,
      y: 2,
      handleIn: [-2, 0],
      handleOut: [2, 4],
    });
  });

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
  it('scales source-pixel stroke width with the inserted trace geometry', () => {
    let doc = createDocument('Images', true);
    const image = makeImageShapeNode('img-scale-stroke', {
      name: 'Scaled sketch',
      w: 20,
      h: 20,
      src: 'data:image/png;base64,AAAA',
    });
    doc = { ...doc, nodes: { ...doc.nodes, [image.id]: image }, rootChildren: [image.id] };

    const result = insertTraceGroup(doc, image.id, {
      width: 10,
      height: 10,
      centerlineWidth: 3,
      paths: [
        {
          closed: false,
          strokeWidth: 3,
          points: [
            { x: 1, y: 5 },
            { x: 9, y: 5 },
          ],
        },
      ],
    });
    const group = result.doc.nodes[result.nodeId];
    const childId = group?.kind === 'group' ? group.children[0] : undefined;
    const child = childId ? result.doc.nodes[childId] : undefined;
    if (child?.kind !== 'shape') return;
    expect(child.strokes[0]?.weight).toBe(6);
  });

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

describe('trace metadata and re-trace', () => {
  function makeDoc() {
    let doc = createDocument('Images', true);
    const image = makeImageShapeNode('img-m1', {
      name: 'Sprite',
      w: 10,
      h: 10,
      src: 'data:image/png;base64,AAAA',
    });
    doc = { ...doc, nodes: { ...doc.nodes, [image.id]: image }, rootChildren: [image.id] };
    return { doc, image };
  }

  const metadata = {
    schemaVersion: 1 as const,
    sourceNodeId: 'img-m1',
    mode: 'pixel-art' as const,
    traceMode: 'silhouette' as const,
    threshold: 128,
    foreground: 'dark' as const,
    alphaThreshold: 1,
    minArea: 1,
    simplifyTolerance: 0,
    maxPaths: 1000,
    maxColors: 16,
    compoundHoles: true,
    cornerAngle: 135,
    centerlineWidth: 2,
    centerlinePrune: 4,
    engine: 'native' as const,
    stats: { pathCount: 3, pointCount: 24, holeCount: 1, omittedHoles: 0 },
    createdAt: 1234,
  };

  const traced: RasterTraceResult = {
    width: 10,
    height: 10,
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
        fill: { r: 10, g: 20, b: 30, a: 255 },
      },
    ],
  };

  it('stores traceMetadata on the inserted group', () => {
    const { doc, image } = makeDoc();
    const result = insertTraceGroup(doc, image.id, { ...traced, metadata });
    const group = result.doc.nodes[result.nodeId];
    expect(group?.kind).toBe('group');
    if (group?.kind !== 'group') return;
    expect(group.traceMetadata).toEqual(metadata);
  });

  it('replaces an existing trace group in place at the same paint order', () => {
    const { doc, image } = makeDoc();
    const first = insertTraceGroup(doc, image.id, { ...traced, metadata });
    const before = first.doc.rootChildren.indexOf(first.nodeId);
    expect(before).toBe(1);

    const second = replaceTraceGroup(first.doc, image.id, first.nodeId, {
      ...traced,
      metadata: { ...metadata, createdAt: 5678 },
    });
    expect(second.nodeId).not.toBe(first.nodeId);
    // The old group is gone and the new one sits at the old position.
    expect(second.doc.nodes[first.nodeId]).toBeUndefined();
    expect(second.doc.rootChildren.indexOf(second.nodeId)).toBe(before);
    const group = second.doc.nodes[second.nodeId];
    if (group?.kind !== 'group') return;
    expect(group.traceMetadata?.createdAt).toBe(5678);
  });

  it('metadata settings round-trip restores editable settings', async () => {
    const { settingsFromTraceMetadata, buildTraceMetadata, traceEngineLabel } = await import(
      './logo/vectorization/metadata'
    );
    const { DEFAULT_VECTORIZATION_SETTINGS } = await import('./logo/vectorization/settings');
    const built = buildTraceMetadata(
      'img-m1',
      { ...DEFAULT_VECTORIZATION_SETTINGS, mode: 'pixel-art', maxColors: 16, minArea: 1 },
      { pathCount: 3, pointCount: 24, holeCount: 1, omittedHoles: 0, complexity: 72 },
      0,
      traceEngineLabel(),
    );
    const restored = settingsFromTraceMetadata(built);
    expect(restored.mode).toBe('pixel-art');
    expect(restored.maxColors).toBe(16);
    expect(restored.minArea).toBe(1);
    expect(restored.prep.grayscale).toBe(DEFAULT_VECTORIZATION_SETTINGS.prep.grayscale);
  });
});
