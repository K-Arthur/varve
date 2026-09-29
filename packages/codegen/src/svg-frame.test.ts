import {
  addChild,
  addNode,
  createDocument,
  type Document,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { exportNodeToSvg } from './svg';

function frameDoc(
  opts: { clipContent?: boolean; cornerRadius?: number | [number, number, number, number] } = {},
): { doc: Document; frameId: string } {
  let doc = createDocument('Frame fill');
  // `makeFrameNode`'s option list omits `cornerRadius`, so the frame's own
  // corner radius has to be applied on top of the factory result.
  const frame = {
    ...makeFrameNode('frame-1', {
      name: 'Panel',
      w: 320,
      h: 200,
      fill: { space: 'rgb', r: 16, g: 21, b: 31, a: 255 },
      ...(opts.clipContent !== undefined ? { clipContent: opts.clipContent } : {}),
    }),
    ...(opts.cornerRadius !== undefined ? { cornerRadius: opts.cornerRadius } : {}),
  };
  doc = addNode(doc, frame);
  doc = addChild(
    doc,
    'frame-1',
    makeShapeNode('child-1', { kind: 'rect', x: 400, y: 0, w: 40, h: 40 }, { name: 'Outer' }),
  );
  return { doc, frameId: 'frame-1' };
}

describe('exportNodeToSvg — frame paint and clipping', () => {
  it('paints the frame background at its authored size', () => {
    const { doc, frameId } = frameDoc();
    const svg = exportNodeToSvg(doc.nodes[frameId]!, doc);

    expect(svg).toContain('rgba(16,21,31,1.000)');
    expect(svg).toContain('width="320"');
    expect(svg).toContain('height="200"');
    expect(svg).not.toContain('height="160"');
  });

  it('clips children to the frame box by default', () => {
    const { doc, frameId } = frameDoc();
    const svg = exportNodeToSvg(doc.nodes[frameId]!, doc);

    expect(svg).toContain('clipPath id="frame-clip-frame-1"');
    expect(svg).toContain('clip-path="url(#frame-clip-frame-1)"');
  });

  it('does not clip when the frame opts out', () => {
    const { doc, frameId } = frameDoc({ clipContent: false });
    const svg = exportNodeToSvg(doc.nodes[frameId]!, doc);

    expect(svg).not.toContain('frame-clip-frame-1');
    // The background is still painted.
    expect(svg).toContain('rgba(16,21,31,1.000)');
  });

  it('carries a uniform corner radius onto the rect', () => {
    const { doc, frameId } = frameDoc({ cornerRadius: 12 });
    const svg = exportNodeToSvg(doc.nodes[frameId]!, doc);

    expect(svg).toContain('rx="12"');
    expect(svg).toContain('ry="12"');
  });

  it('falls back to a path for per-corner radii', () => {
    const { doc, frameId } = frameDoc({ cornerRadius: [8, 0, 0, 0] });
    const svg = exportNodeToSvg(doc.nodes[frameId]!, doc);

    expect(svg).toContain('<path d="M 8 0');
    expect(svg).toContain('clipPath id="frame-clip-frame-1"');
  });

  it('rounds fractional radii the same way the rest of the document does', () => {
    const { doc, frameId } = frameDoc({ cornerRadius: 12.34567 });
    const svg = exportNodeToSvg(doc.nodes[frameId]!, doc);

    // Two decimal places, matching svg.ts's shared number formatting.
    expect(svg).toContain('rx="12.35"');
    expect(svg).not.toContain('12.346');
  });

  it('clamps a radius that would exceed half the frame box', () => {
    const { doc, frameId } = frameDoc({ cornerRadius: 999 });
    const svg = exportNodeToSvg(doc.nodes[frameId]!, doc);

    // The frame is 320x200, so half the short side is 100.
    expect(svg).toContain('rx="100"');
  });

  it('still emits no box for a group, which paints nothing on the canvas', () => {
    let doc = createDocument('Group paint');
    doc = addNode(doc, makeGroupNode('group-1', { name: 'Group' }));
    doc = addChild(
      doc,
      'group-1',
      makeShapeNode('g-child', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Child' }),
    );

    const svg = exportNodeToSvg(doc.nodes['group-1']!, doc);
    expect(svg).not.toContain('<rect x="0" y="0" width="200"');
    expect(svg).not.toContain('<rect x="0" y="0" width="160"');
  });
});
