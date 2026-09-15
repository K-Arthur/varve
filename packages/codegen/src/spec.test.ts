import type { Document } from '@varve/scene';
import {
  addKeyframe,
  addNode,
  addTrack,
  createDocument,
  createTimeline,
  makeFrameNode,
  makeShapeNode,
  makeTextNode,
  nextNodeId,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { buildSpec, type SpecSheet, specToMarkdown } from './spec';

function shapeDoc(overrides?: Partial<Document>): Document {
  const doc = createDocument('Spec Test');
  return { ...doc, ...overrides };
}

describe('buildSpec', () => {
  it('returns empty spec for empty document', () => {
    const doc = shapeDoc();
    const spec = buildSpec(doc);
    expect(spec.nodes).toHaveLength(0);
    expect(spec.spacings).toHaveLength(0);
    expect(spec.typeStyles).toHaveLength(0);
    expect(spec.palette).toHaveLength(0);
  });

  it('collects shape node info', () => {
    let doc = shapeDoc();
    const r = nextNodeId(doc);
    const node = makeShapeNode(r.id, { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Box' });
    doc = addNode(r.doc, node);

    const spec = buildSpec(doc);
    expect(spec.nodes).toHaveLength(1);
    expect(spec.nodes[0]?.name).toBe('Box');
    expect(spec.nodes[0]?.rect.w).toBe(100);
    expect(spec.nodes[0]?.rect.h).toBe(50);
  });

  it('collects text node type styles', () => {
    let doc = shapeDoc();
    const r = nextNodeId(doc);
    const node = makeTextNode(r.id, 'Hello', { name: 'Title', fontSize: 24 });
    doc = addNode(r.doc, node);

    const spec = buildSpec(doc);
    expect(spec.typeStyles).toHaveLength(1);
    expect(spec.typeStyles[0]?.fontSize).toBe(24);
    expect(spec.typeStyles[0]?.count).toBe(1);
  });

  it('aggregates duplicate type styles', () => {
    let doc = shapeDoc();
    const r1 = nextNodeId(doc);
    doc = addNode(r1.doc, makeTextNode(r1.id, 'A', { fontSize: 16 }));
    const r2 = nextNodeId(doc);
    doc = addNode(r2.doc, makeTextNode(r2.id, 'B', { fontSize: 16 }));
    const r3 = nextNodeId(doc);
    doc = addNode(r3.doc, makeTextNode(r3.id, 'C', { fontSize: 24 }));

    const spec = buildSpec(doc);
    expect(spec.typeStyles).toHaveLength(2);
    const s16 = spec.typeStyles.find((t) => t.fontSize === 16);
    const s24 = spec.typeStyles.find((t) => t.fontSize === 24);
    expect(s16?.count).toBe(2);
    expect(s24?.count).toBe(1);
  });

  it('collects colors into palette', () => {
    let doc = shapeDoc();
    const r1 = nextNodeId(doc);
    doc = addNode(
      r1.doc,
      makeShapeNode(
        r1.id,
        { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        { name: 'A', fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
      ),
    );
    const r2 = nextNodeId(doc);
    doc = addNode(
      r2.doc,
      makeShapeNode(
        r2.id,
        { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        { name: 'B', fill: { space: 'rgb', r: 0, g: 255, b: 0, a: 255 } },
      ),
    );

    const spec = buildSpec(doc);
    expect(spec.palette).toHaveLength(2);
  });

  it('deduplicates colors', () => {
    let doc = shapeDoc();
    const r1 = nextNodeId(doc);
    doc = addNode(
      r1.doc,
      makeShapeNode(
        r1.id,
        { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        { name: 'A', fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 } },
      ),
    );
    const r2 = nextNodeId(doc);
    doc = addNode(
      r2.doc,
      makeShapeNode(
        r2.id,
        { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        { name: 'B', fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 } },
      ),
    );

    const spec = buildSpec(doc);
    expect(spec.palette).toHaveLength(1);
  });

  it('includes frame children recursively', () => {
    let doc = shapeDoc();
    const r1 = nextNodeId(doc);
    const r2 = nextNodeId(r1.doc);
    const child = makeShapeNode(
      r2.id,
      { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
      { name: 'Child' },
    );
    doc = addNode(r2.doc, makeFrameNode(r1.id, { name: 'Frame', children: [r2.id] }));
    doc = { ...doc, nodes: { ...doc.nodes, [r2.id]: child } };

    const spec = buildSpec(doc);
    expect(spec.nodes).toHaveLength(2);
  });

  it('includes timeline summary with track and keyframe counts', () => {
    let doc = createDocument('Motion Spec');
    const { doc: d1, id: tlId } = createTimeline(doc, 'Intro', 3000);
    const { doc: d2, trackId } = addTrack(
      d1,
      tlId,
      'node-x' as import('@varve/scene').NodeId,
      'opacity',
    );
    doc = addKeyframe(d2, tlId, trackId, { progress: 0, value: 0 });
    doc = addKeyframe(doc, tlId, trackId, { progress: 1, value: 1 });

    const spec = buildSpec(doc);
    expect(spec.timelines).toHaveLength(1);
    expect(spec.timelines[0]?.trackCount).toBe(1);
    expect(spec.timelines[0]?.keyframeCount).toBe(2);
    expect(spec.exportHash).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('specToMarkdown', () => {
  it('formats an empty spec', () => {
    const spec: SpecSheet = {
      spacings: [],
      typeStyles: [],
      assets: [],
      nodes: [],
      palette: [],
      timelines: [],
      exportHash: '00000000',
    };
    const md = specToMarkdown(spec);
    expect(md).toContain('# Design Spec');
  });

  it('includes type styles section', () => {
    const spec: SpecSheet = {
      spacings: [],
      typeStyles: [
        {
          id: 't1',
          name: 'Body',
          fontSize: 16,
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          count: 3,
        },
      ],
      assets: [],
      nodes: [],
      palette: [],
      timelines: [],
      exportHash: 'abc12345',
    };
    const md = specToMarkdown(spec);
    expect(md).toContain('## Type Styles');
    expect(md).toContain('**Body**: 16px, used 3x');
  });

  it('includes spacing section', () => {
    const spec: SpecSheet = {
      spacings: [{ name: 'padding', value: 8, count: 5 }],
      typeStyles: [],
      assets: [],
      nodes: [],
      palette: [],
      timelines: [],
      exportHash: 'abc12345',
    };
    const md = specToMarkdown(spec);
    expect(md).toContain('## Spacing');
    expect(md).toContain('8px, used 5x');
  });

  it('includes colors section', () => {
    const spec: SpecSheet = {
      spacings: [],
      typeStyles: [],
      assets: [],
      nodes: [],
      palette: [{ space: 'rgb', r: 57, g: 208, b: 198, a: 255 }],
      timelines: [],
      exportHash: 'abc12345',
    };
    const md = specToMarkdown(spec);
    expect(md).toContain('## Colors');
    expect(md).toContain('rgba(57, 208, 198, 1.00)');
  });

  it('includes motion timelines section', () => {
    const spec: SpecSheet = {
      spacings: [],
      typeStyles: [],
      assets: [],
      nodes: [],
      palette: [],
      exportHash: 'deadbeef',
      timelines: [
        {
          id: 'tl-1',
          name: 'Hero',
          durationMs: 2000,
          trackCount: 3,
          keyframeCount: 8,
          markerCount: 1,
        },
      ],
    };
    const md = specToMarkdown(spec);
    expect(md).toContain('## Motion Timelines');
    expect(md).toContain('**Hero** (2000ms): 3 tracks, 8 keyframes, 1 markers');
    expect(md).toContain('deadbeef');
  });
});
