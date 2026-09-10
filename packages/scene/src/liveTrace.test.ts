import { describe, expect, it } from 'vitest';
import type { Document } from './document';
import { addNode, createDocument, makeShapeNode } from './document';
import {
  bakeLiveTraceToRaster,
  clearLiveTrace,
  flattenLiveTrace,
  setLiveTraceError,
  setLiveTraceParams,
  setLiveTraceResolved,
} from './liveTrace';
import type { LiveTraceParams, ShapeNode } from './types';

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

function setup(): { doc: Document; nodeId: string } {
  const doc = createDocument();
  const node = makeShapeNode(
    'n1',
    { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    { name: 'Image 1' },
  );
  return { doc: addNode(doc, node), nodeId: 'n1' };
}

describe('liveTrace operations', () => {
  it('sets live trace params on a node', () => {
    const { doc, nodeId } = setup();
    const updated = setLiveTraceParams(doc, nodeId, defaultParams);
    const node = updated.nodes[nodeId] as ShapeNode;
    expect(node.liveTrace).toBeDefined();
    expect(node.liveTrace!.params).toEqual(defaultParams);
    expect(node.liveTrace!.sourceNodeId).toBe(nodeId);
    expect(node.liveTrace!.resolvedAt).toBeNull();
    expect(node.liveTrace!.lastError).toBeNull();
  });

  it('updating params resets resolvedAt to null', () => {
    const { doc, nodeId } = setup();
    const withTrace = setLiveTraceParams(doc, nodeId, defaultParams);
    const resolved = setLiveTraceResolved(withTrace, nodeId, 1000);
    expect((resolved.nodes[nodeId] as ShapeNode).liveTrace!.resolvedAt).toBe(1000);
    const updated = setLiveTraceParams(resolved, nodeId, { ...defaultParams, threshold: 200 });
    expect((updated.nodes[nodeId] as ShapeNode).liveTrace!.resolvedAt).toBeNull();
  });

  it('resolves a live trace with timestamp', () => {
    const { doc, nodeId } = setup();
    const withTrace = setLiveTraceParams(doc, nodeId, defaultParams);
    const ts = Date.now();
    const resolved = setLiveTraceResolved(withTrace, nodeId, ts);
    const node = resolved.nodes[nodeId] as ShapeNode;
    expect(node.liveTrace!.resolvedAt).toBe(ts);
    expect(node.liveTrace!.lastError).toBeNull();
  });

  it('records a live trace error', () => {
    const { doc, nodeId } = setup();
    const withTrace = setLiveTraceParams(doc, nodeId, defaultParams);
    const errored = setLiveTraceError(withTrace, nodeId, 'Out of memory');
    const node = errored.nodes[nodeId] as ShapeNode;
    expect(node.liveTrace!.lastError).toBe('Out of memory');
    expect(node.liveTrace!.resolvedAt).toBeNull();
  });

  it('flattens a live trace: removes liveTrace state', () => {
    const { doc, nodeId } = setup();
    const withTrace = setLiveTraceParams(doc, nodeId, defaultParams);
    const flattened = flattenLiveTrace(withTrace, nodeId);
    const node = flattened.nodes[nodeId] as ShapeNode;
    expect(node.liveTrace).toBeUndefined();
  });

  it('flattened node is still a ShapeNode', () => {
    const { doc, nodeId } = setup();
    const withTrace = setLiveTraceParams(doc, nodeId, defaultParams);
    const flattened = flattenLiveTrace(withTrace, nodeId);
    const node = flattened.nodes[nodeId];
    expect(node).toBeDefined();
    expect(node!.kind).toBe('shape');
  });

  it('clearLiveTrace removes liveTrace state', () => {
    const { doc, nodeId } = setup();
    const withTrace = setLiveTraceParams(doc, nodeId, defaultParams);
    const cleared = clearLiveTrace(withTrace, nodeId);
    const node = cleared.nodes[nodeId] as ShapeNode;
    expect(node.liveTrace).toBeUndefined();
  });

  it('clearLiveTrace no-ops on node without liveTrace', () => {
    const { doc, nodeId } = setup();
    const cleared = clearLiveTrace(doc, nodeId);
    const node = cleared.nodes[nodeId] as ShapeNode;
    expect(node.liveTrace).toBeUndefined();
  });

  it('setLiveTraceParams no-ops on non-shape nodes', () => {
    const doc = createDocument();
    const updated = setLiveTraceParams(doc, 'nonexistent', defaultParams);
    expect(updated).toBe(doc);
  });

  it('flattenLiveTrace no-ops on non-existent node', () => {
    const doc = createDocument();
    const flattened = flattenLiveTrace(doc, 'nonexistent');
    expect(flattened).toBe(doc);
  });

  it('serialize/deserialize round-trip preserves liveTrace', () => {
    const { doc, nodeId } = setup();
    const withTrace = setLiveTraceParams(doc, nodeId, defaultParams);
    const resolved = setLiveTraceResolved(withTrace, nodeId, 12345);
    const json = JSON.stringify(resolved);
    const parsed = JSON.parse(json) as Document;
    const node = parsed.nodes[nodeId] as ShapeNode;
    expect(node.liveTrace).toBeDefined();
    expect(node.liveTrace!.params.mode).toBe('monochrome');
    expect(node.liveTrace!.params.threshold).toBe(128);
    expect(node.liveTrace!.sourceNodeId).toBe(nodeId);
    expect(node.liveTrace!.resolvedAt).toBe(12345);
    expect(node.liveTrace!.lastError).toBeNull();
  });

  it('flattenLiveTrace preserves original shape when no traced geometry', () => {
    const { doc, nodeId } = setup();
    const withTrace = setLiveTraceParams(doc, nodeId, defaultParams);
    const flattened = flattenLiveTrace(withTrace, nodeId);
    const node = flattened.nodes[nodeId] as ShapeNode;
    // Should preserve the original rect shape
    expect(node.shape.kind).toBe('rect');
    expect((node.shape as { w: number }).w).toBe(100);
    expect(node.liveTrace).toBeUndefined();
  });

  it('bakeLiveTraceToRaster creates a derived image node', () => {
    const { doc, nodeId } = setup();
    const withTrace = setLiveTraceParams(doc, nodeId, defaultParams);
    const resolved = setLiveTraceResolved(withTrace, nodeId, 12345);
    const pixelData = 'data:image/png;base64,iVBORw0KGgo=';

    const result = bakeLiveTraceToRaster(resolved, nodeId, pixelData, { w: 200, h: 150 });
    // Original nodes preserved
    expect(result.nodes[nodeId]).toBeDefined();
    expect((result.nodes[nodeId] as ShapeNode).liveTrace).toBeDefined();

    // Find the new derived node (any node that was not in the original doc)
    const originalIds = new Set(Object.keys(resolved.nodes));
    const derivedIds = Object.keys(result.nodes).filter((id) => !originalIds.has(id));
    expect(derivedIds.length).toBeGreaterThanOrEqual(1);

    const derivedNode = result.nodes[derivedIds[0]!] as ShapeNode;
    expect(derivedNode.kind).toBe('shape');
    expect(derivedNode.fills).toBeDefined();
    expect(derivedNode.fills!.length).toBe(1);
    expect(derivedNode.fills![0]!.type).toBe('image');
    expect(derivedNode.fills![0]!.image!.src).toBe(pixelData);
    expect(derivedNode.fills![0]!.image!.imageWidth).toBe(200);
    expect(derivedNode.fills![0]!.image!.imageHeight).toBe(150);
    // Derived node has the same transform as the source
    expect(derivedNode.transform).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('bakeLiveTraceToRaster no-ops on node without liveTrace', () => {
    const { doc, nodeId } = setup();
    const result = bakeLiveTraceToRaster(doc, nodeId, 'data:image/png;base64,AA', { w: 10, h: 10 });
    // No derived nodes added
    const originalIds = new Set(Object.keys(doc.nodes));
    const derivedIds = Object.keys(result.nodes).filter((id) => !originalIds.has(id));
    expect(derivedIds.length).toBe(0);
  });
});
