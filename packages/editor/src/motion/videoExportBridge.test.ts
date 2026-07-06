// @vitest-environment jsdom

import { createDocument, makeShapeNode } from '@strata/scene';
import type { Timeline } from '@strata/scene';
import { describe, expect, it, vi } from 'vitest';
import { createVideoFrameRenderer, resolveVideoExportBounds } from './videoExportBridge';

vi.mock('../timeline/TimelineSampler', () => ({
  sampleTimelineAt: vi.fn((_doc, _tlId, timeMs: number) => ({
    overrides:
      timeMs >= 500
        ? new Map([['n1', new Map([['opacity', 0.25]])]])
        : new Map([['n1', new Map([['opacity', 1]])]]),
  })),
}));

describe('resolveVideoExportBounds', () => {
  it('uses canvas dimensions for canvas mode', () => {
    const doc = createDocument();
    doc.canvasWidth = 1280;
    doc.canvasHeight = 720;
    const bounds = resolveVideoExportBounds(doc, 'canvas');
    expect(bounds).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });
});

describe('createVideoFrameRenderer', () => {
  it('calls sampler at requested times via renderFrame', async () => {
    const doc = createDocument();
    const rect = makeShapeNode({
      id: 'n1',
      name: 'Rect',
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
    });
    doc.nodes.n1 = rect;
    doc.rootChildren = ['n1'];

    const timeline: Timeline = {
      id: 'tl1',
      name: 'Main',
      duration: 1000,
      tracks: [],
      defaultEasing: { kind: 'linear' },
    };

    const { renderFrame, sampledTimes } = await createVideoFrameRenderer({
      doc,
      timeline,
      options: { width: 64, height: 64, boundsMode: 'canvas' },
    });

    await renderFrame(0, 0);
    await renderFrame(500, 1);
    await renderFrame(1000, 2);

    expect(sampledTimes).toEqual([0, 500, 1000]);
  });

  it('returns RGBA frame bytes', async () => {
    const doc = createDocument();
    const rect = makeShapeNode({
      id: 'n1',
      name: 'Rect',
      shape: { kind: 'rect', x: 10, y: 10, w: 40, h: 40 },
    });
    doc.nodes.n1 = rect;
    doc.rootChildren = ['n1'];

    const timeline: Timeline = {
      id: 'tl1',
      name: 'Main',
      duration: 500,
      tracks: [],
      defaultEasing: { kind: 'linear' },
    };

    const { renderFrame } = await createVideoFrameRenderer({
      doc,
      timeline,
      options: { width: 32, height: 32, boundsMode: 'canvas' },
    });

    const rgba = await renderFrame(0, 0);
    expect(rgba.byteLength).toBe(32 * 32 * 4);
  });
});
