// @vitest-environment jsdom

import type { Timeline } from '@strata/scene';
import {
  addRasterMaskAsset,
  createDocument,
  makeFrameNode,
  makeShapeNode,
} from '@strata/scene';
import { describe, expect, it, vi } from 'vitest';
import {
  createVideoFrameRenderer,
  flattenVisibleNodesForVideo,
  resolveVideoExportBounds,
} from './videoExportBridge';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

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
  it('includes native raster masks in motion export nodes', () => {
    let doc = createDocument('Motion mask', true);
    const image = makeShapeNode('image', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    image.fills = [
      {
        type: 'image',
        image: { src: 'image', fit: 'fill', x: 0, y: 0, scale: 1 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ];
    doc.nodes[image.id] = image;
    doc.rootChildren = [image.id];
    doc = addRasterMaskAsset(doc, image.id, {
      id: 'mask',
      mimeType: 'image/png',
      dataUrl: PNG_DATA_URL,
      width: 1,
      height: 1,
      byteLength: 68,
    });
    expect(flattenVisibleNodesForVideo(doc).nodes[0]?.alphaMask).toBe(PNG_DATA_URL);
  });

  it('calls sampler at requested times via renderFrame', async () => {
    const doc = createDocument();
    const rect = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 }, { name: 'Rect' });
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
    const rect = makeShapeNode(
      'n1',
      { kind: 'rect', x: 10, y: 10, w: 40, h: 40 },
      { name: 'Rect' },
    );
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

describe('flattenVisibleNodesForVideo scaling', () => {
  /**
   * N shapes nested one level inside a single frame (not direct
   * rootChildren) — this is what actually exercises getParent's expensive
   * `Object.entries(doc.nodes)` fallback scan. A flat rootChildren-only
   * fixture doesn't: `getParent` checks `doc.rootChildren.includes(id)`
   * first and returns immediately on a hit, which stays fast enough at
   * moderate node counts to hide the bug this test exists to catch.
   */
  function makeNestedDoc(count: number) {
    const doc = createDocument();
    const frameId = 'frame-root';
    const nodes: Record<string, ReturnType<typeof makeShapeNode>> = {};
    const childIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = `n-${i}`;
      nodes[id] = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, {});
      childIds.push(id);
    }
    const frame = makeFrameNode(frameId, { w: 1000, h: 1000, children: childIds });
    return {
      ...doc,
      nodes: { ...doc.nodes, [frameId]: frame, ...nodes },
      rootChildren: [frameId],
    };
  }

  it('scales near-linearly with node count, not quadratically', () => {
    // Regression guard: flattenVisibleNodesForVideo called nodeWorldTransform
    // once per node without a parentIndex, which falls back to an O(n)
    // linear scan (getParent) per call -- making video export O(n^2) in
    // node count, the same pattern found in computeFitAllCamera (a
    // measured 10+ minute hang at 20,000 nodes) and HitTestEngine.
    const small = makeNestedDoc(300);
    const large = makeNestedDoc(2400); // 8x

    const t0 = performance.now();
    flattenVisibleNodesForVideo(small);
    const smallMs = performance.now() - t0;

    const t1 = performance.now();
    flattenVisibleNodesForVideo(large);
    const largeMs = performance.now() - t1;

    expect(largeMs).toBeLessThan(Math.max(smallMs * 20, 300));
  });
});
