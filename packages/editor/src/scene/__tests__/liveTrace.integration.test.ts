import type { Shape } from '@strata/engine';
import type { Document, LiveTraceParams, ShapeNode } from '@strata/scene';
import {
  addNode,
  createDocument,
  flattenLiveTrace,
  makeShapeNode,
  setLiveTraceParams,
  setLiveTraceResolved,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';

const defaultParams: LiveTraceParams = {
  mode: 'monochrome',
  threshold: 128,
  foreground: 'dark',
  alphaThreshold: 1,
  minArea: 4,
  simplifyTolerance: 0.75,
  maxPaths: 1000,
  maxColors: 8,
  compoundHoles: true,
  traceVersion: 2,
  traceMode: 'silhouette',
  cornerAngle: 135,
  maxError: 1.0,
  centerlineWidth: 2,
  centerlinePrune: 4,
};

function setupImageDoc(): Document {
  let doc = createDocument();
  const img: ShapeNode = {
    ...makeShapeNode('img1', { kind: 'rect', x: 0, y: 0, w: 200, h: 150 } as Shape, {
      name: 'Photo 1',
    }),
    fills: [
      {
        type: 'image' as const,
        image: { src: 'data:image/png;base64,abc', fit: 'fill' as const, x: 0, y: 0, scale: 1 },
        opacity: 1,
        blendMode: 'normal' as const,
        visible: true,
      },
    ],
  };
  doc = addNode(doc, img);
  return doc;
}

describe('liveTrace integration (document-level)', () => {
  it('creates a live-traced node via setLiveTraceParams', () => {
    const doc = setupImageDoc();
    const updated = setLiveTraceParams(doc, 'img1', defaultParams);
    const node = updated.nodes.img1 as ShapeNode;
    expect(node.liveTrace).toBeDefined();
    expect(node.liveTrace!.params.mode).toBe('monochrome');
    expect(node.liveTrace!.sourceNodeId).toBe('img1');
  });

  it('updating params triggers pending state (resolvedAt set to null)', () => {
    const doc = setupImageDoc();
    const withTrace = setLiveTraceParams(doc, 'img1', defaultParams);
    const resolved = setLiveTraceResolved(withTrace, 'img1', 1000);
    expect((resolved.nodes.img1 as ShapeNode).liveTrace!.resolvedAt).toBe(1000);

    const reParams = setLiveTraceParams(resolved, 'img1', { threshold: 200 });
    expect((reParams.nodes.img1 as ShapeNode).liveTrace!.resolvedAt).toBeNull();
  });

  it('flatten via document operation removes liveTrace state', () => {
    const doc = setupImageDoc();
    const withTrace = setLiveTraceParams(doc, 'img1', defaultParams);
    const flattened = flattenLiveTrace(withTrace, 'img1');
    const node = flattened.nodes.img1 as ShapeNode;
    expect(node.liveTrace).toBeUndefined();
    expect(node.kind).toBe('shape');
  });

  it('live-traced node preserves original shape for fallback rendering', () => {
    const doc = setupImageDoc();
    const withTrace = setLiveTraceParams(doc, 'img1', defaultParams);
    const node = withTrace.nodes.img1 as ShapeNode;
    expect(node.shape.kind).toBe('rect');
  });
});
