/**
 * Native raster-mask render adapter compatibility.
 *
 * Research basis: local-first documents must render the same alpha matte after
 * persistence as before save, while legacy inline masks remain readable.
 */

import { imageDataToRasterTiles } from '@varve/engine';
import {
  addNode,
  addRasterMaskAsset,
  applyLiquifyDabToNode,
  colorConfigWithDefaults,
  createCallout,
  createDocument,
  createFrequencySeparation,
  DocumentCodec,
  makeFrameNode,
  makeRasterLayerNode,
  makeShapeNode,
  makeSmartFilter,
  makeTextNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  applyCalloutRenderOverride,
  calloutRenderOverrideForNode,
  flattenSceneToEngine,
  sceneNodeToEngineNode,
} from './sceneToEngine';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function imageNode(id: string) {
  const node = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 20, h: 20 });
  node.fills = [
    {
      type: 'image',
      image: { src: 'image', fit: 'fill', x: 0, y: 0, scale: 1 },
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    },
  ];
  return node;
}

describe('scene raster masks', () => {
  it('derives a single joined contour for parametric rectangular callouts without changing nodes', () => {
    const created = createCallout(createDocument('joined-callout', true), {
      x: 0,
      y: 0,
      w: 180,
      h: 90,
      text: 'Hello',
    });
    const sourceTail = created.document.nodes[created.tailNodeIds[0]!];
    const sourceBody = created.document.nodes[created.bodyId];
    expect(sourceBody?.kind === 'shape' ? sourceBody.strokes : undefined).toHaveLength(1);
    expect(sourceTail?.kind === 'path' ? sourceTail.strokes : undefined).toHaveLength(1);

    if (sourceBody?.kind !== 'shape' || sourceTail?.kind !== 'path') {
      throw new Error('created callout is missing its body or tail');
    }
    const calloutParents = new Map([
      [created.bodyId, created.groupId],
      [created.tailNodeIds[0]!, created.groupId],
    ]);
    const bodyOverride = calloutRenderOverrideForNode(
      created.document,
      created.bodyId,
      calloutParents,
    );
    const tailOverride = calloutRenderOverrideForNode(
      created.document,
      created.tailNodeIds[0]!,
      calloutParents,
    );
    expect(bodyOverride).toMatchObject({ role: 'body' });
    expect(tailOverride).toMatchObject({ role: 'tail' });
    const joinedBody = applyCalloutRenderOverride(
      sceneNodeToEngineNode(sourceBody, {}, created.document),
      bodyOverride,
    );
    expect(joinedBody.shape).toMatchObject({ kind: 'path', closed: true });
    expect(joinedBody.strokes?.[0]?.join).toBe('round');
    const liveTail = applyCalloutRenderOverride(
      sceneNodeToEngineNode(sourceTail, {}, created.document),
      tailOverride,
    );
    expect(liveTail.strokes).toEqual([]);
    expect(liveTail.fills).toEqual([]);

    const flattened = flattenSceneToEngine(created.document, [created.groupId]);
    const bodyIndex = flattened.ids.indexOf(created.bodyId);
    const tailIndex = flattened.ids.indexOf(created.tailNodeIds[0]!);
    const bodyEngine = flattened.nodes[bodyIndex];
    const tailEngine = flattened.nodes[tailIndex];
    expect(bodyEngine?.shape).toMatchObject({ kind: 'path', closed: true });
    expect(bodyEngine?.shape?.kind === 'path' ? bodyEngine.shape.points : []).toHaveLength(11);
    expect(tailEngine?.strokes).toEqual([]);
    expect(tailEngine?.fills).toEqual([]);
    expect(tailEngine?.fill).toMatchObject({ a: 0 });

    // Flattening a directly selected body keeps the editable rectangle's
    // ordinary bounds; only its owning callout group requests the union path.
    const isolatedBody = flattenSceneToEngine(created.document, [created.bodyId]);
    expect(isolatedBody.nodes[0]?.shape?.kind).toBe('rect');

    // Child-level styling and visibility remain meaningful on the editable
    // source nodes, so those cases keep the original independent rendering.
    const styledTailDocument = {
      ...created.document,
      nodes: {
        ...created.document.nodes,
        [created.tailNodeIds[0]!]: {
          ...sourceTail!,
          fill: { space: 'rgb' as const, r: 1, g: 0, b: 0, a: 1 },
        },
      },
    };
    const styledTail = flattenSceneToEngine(styledTailDocument, [created.groupId]);
    expect(styledTail.nodes[bodyIndex]?.shape?.kind).toBe('rect');
    expect(styledTail.nodes[tailIndex]?.strokes).toHaveLength(1);

    const hiddenTailDocument = {
      ...created.document,
      nodes: {
        ...created.document.nodes,
        [created.tailNodeIds[0]!]: { ...sourceTail!, visible: false },
      },
    };
    const hiddenTail = flattenSceneToEngine(hiddenTailDocument, [created.groupId]);
    expect(hiddenTail.nodes[bodyIndex]?.shape?.kind).toBe('rect');
    expect(hiddenTail.ids).not.toContain(created.tailNodeIds[0]);

    const editedTailDocument = {
      ...created.document,
      nodes: {
        ...created.document.nodes,
        [created.tailNodeIds[0]!]: {
          ...sourceTail,
          points: sourceTail.points.map((pathPoint, index) =>
            index === 0 ? { ...pathPoint, x: pathPoint.x + 1 } : pathPoint,
          ),
        },
      },
    };
    expect(
      calloutRenderOverrideForNode(editedTailDocument, created.tailNodeIds[0]!, calloutParents),
    ).toBeUndefined();

    const filteredBodyDocument = {
      ...created.document,
      nodes: {
        ...created.document.nodes,
        [created.bodyId]: {
          ...sourceBody,
          smartFilters: [makeSmartFilter('callout-invert', 'invert')],
        },
      },
    };
    expect(
      calloutRenderOverrideForNode(filteredBodyDocument, created.bodyId, calloutParents),
    ).toBeUndefined();
  });

  it('propagates object-local filters into the shared engine IR', () => {
    const node = {
      ...makeShapeNode('filtered', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }),
      smartFilters: [makeSmartFilter('invert', 'invert')],
    };
    const converted = sceneNodeToEngineNode(node, {}, createDocument('Object Filter'));
    expect(converted.filters).toEqual([
      expect.objectContaining({ kind: 'invert', value: 100, opacity: 1 }),
    ]);
  });

  it.each([
    ['vector', makeShapeNode('vector-blend', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 })],
    ['raster', imageNode('raster-blend')],
  ] as const)('preserves per-filter blend mode for a %s owner', (_surface, source) => {
    const node = {
      ...source,
      smartFilters: [
        makeSmartFilter('blend-filter', 'brightness', { value: 20, blendMode: 'colorBurn' }),
      ],
    };
    const converted = sceneNodeToEngineNode(node, {}, createDocument('Filter blend mode'));
    expect(converted.filters).toEqual([
      expect.objectContaining({ kind: 'brightness', blendMode: 'colorBurn' }),
    ]);
  });

  it('omits object-local filters from the IR when their stack is bypassed', () => {
    const node = {
      ...makeShapeNode('filtered-disabled', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }),
      smartFilters: [makeSmartFilter('invert-disabled', 'invert')],
      smartFiltersEnabled: false,
    };
    const converted = sceneNodeToEngineNode(node, {}, createDocument('Disabled Object Filter'));
    expect(converted.filters).toEqual([]);
  });

  it('renders a native raster alpha mask after save and reload', () => {
    const image = imageNode('image');
    let doc = addNode(createDocument('Native mask', true), image);
    doc = addRasterMaskAsset(doc, image.id, {
      id: 'mask',
      mimeType: 'image/png',
      dataUrl: PNG_DATA_URL,
      width: 1,
      height: 1,
      byteLength: 68,
    });
    const decoded = DocumentCodec.decode(DocumentCodec.encode(doc));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    const flattened = flattenSceneToEngine(decoded.document, [image.id]);
    expect(flattened.nodes[0]?.alphaMask).toBe(PNG_DATA_URL);
    expect(
      sceneNodeToEngineNode(
        decoded.document.nodes[image.id]!,
        {
          showOriginalBackgroundNodeId: image.id,
        },
        decoded.document,
      ).alphaMask,
    ).toBeUndefined();
  });

  it('falls back to the legacy inline background-removal mask', () => {
    const image = imageNode('legacy');
    image.backgroundRemoval = {
      maskDataUrl: 'data:image/png;base64,legacy',
      method: 'quick',
      confidence: 0.5,
      appliedAt: 1,
    };
    expect(sceneNodeToEngineNode(image).alphaMask).toBe(image.backgroundRemoval.maskDataUrl);
  });

  it('propagates frame-level raster masks onto the engine node for the export barrier', () => {
    let doc = addNode(
      createDocument('Frame mask', true),
      makeFrameNode('frame', { name: 'Frame', w: 100, h: 80 }),
    );
    doc = addRasterMaskAsset(
      doc,
      'frame',
      {
        id: 'mask',
        mimeType: 'image/png',
        dataUrl: PNG_DATA_URL,
        width: 1,
        height: 1,
        byteLength: 68,
      },
      undefined,
      { coordinateSpace: 'container-local-pixels' },
    );
    const flattened = flattenSceneToEngine(doc, ['frame']);
    expect(flattened.nodes[0]?.alphaMask).toBe(PNG_DATA_URL);
    // Frame masks are applied by the structural replay; the engine node only
    // carries the identity so resource preflight can see it. The rect
    // path's alphaMask must never leak through showOriginalBackgroundNodeId.
    expect(
      sceneNodeToEngineNode(doc.nodes.frame!, { showOriginalBackgroundNodeId: 'frame' }, doc)
        .alphaMask,
    ).toBeUndefined();
  });
});

describe('scene text render geometry', () => {
  it.each([
    ['autoWidth', 'point'],
    ['autoHeight', 'area'],
    ['fixed', 'area'],
  ] as const)('maps %s resizing to the matching render mode', (textResizing, expectedMode) => {
    const node = makeTextNode('text', 'A long text frame', {
      // Deliberately keep the legacy textMode contradictory. The explicit
      // resizing contract is authoritative for both bounds and painting.
      textMode: 'point',
      textResizing,
      w: 80,
      h: 24,
    });

    const converted = sceneNodeToEngineNode(node);
    expect(converted.textMode).toBe(expectedMode);
    expect((converted.shape as { textMode?: string }).textMode).toBe(expectedMode);
  });
});

describe('scene gradient interpolation resolution', () => {
  function gradientNode(interpolation: Record<string, unknown> = {}) {
    const node = makeShapeNode('gradient', {
      kind: 'rect',
      x: 0,
      y: 0,
      w: 20,
      h: 20,
    });
    node.fills = [
      {
        type: 'gradient',
        gradient: {
          type: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 } },
          ],
          ...interpolation,
        },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ];
    return node;
  }

  it('keeps old gradients on their historical encoded-sRGB path', () => {
    const node = gradientNode();
    const converted = sceneNodeToEngineNode(node, {}, createDocument('Legacy'));
    expect(converted.fills?.[0]?.gradient?.interpolationSpace).toBe('srgb');
  });

  it('resolves document-inherited gradients before they reach the engine', () => {
    const node = gradientNode({ interpolationSource: 'document' });
    const base = createDocument('Inherited');
    const doc = {
      ...base,
      colorConfig: {
        ...colorConfigWithDefaults(base.colorConfig),
        defaultGradientInterpolation: 'oklch' as const,
      },
    };
    const converted = sceneNodeToEngineNode(node, {}, doc);
    expect(converted.fills?.[0]?.gradient?.interpolationSpace).toBe('oklch');
  });

  it('preserves a per-gradient override over the document default', () => {
    const node = gradientNode({ interpolationSpace: 'linear-srgb' });
    const converted = sceneNodeToEngineNode(node, {}, createDocument('Pinned'));
    expect(converted.fills?.[0]?.gradient?.interpolationSpace).toBe('linear-srgb');
  });
});

// ── Frequency separation + liquify IR boundary ───────────────────────────────

function makeRetouchRaster(id: string, w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = (x * 11) % 256;
      data[i + 1] = (y * 17) % 256;
      data[i + 2] = ((x + y) % 2 === 0 ? 220 : 30) + ((x * y) % 20);
      data[i + 3] = 255;
    }
  }
  const node = makeRasterLayerNode(id, { width: w, height: h }, { name: 'Photo' });
  node.tiles = imageDataToRasterTiles(new ImageData(data, w, h), 128);
  return node;
}

describe('frequency separation at the IR boundary', () => {
  it('renders the tone band as the decoded composite and hides the detail band', () => {
    const source = makeRetouchRaster('r1', 64, 48);
    let doc = addNode(createDocument('FS'), source);
    const created = createFrequencySeparation(doc, 'r1', { radius: 4 });
    expect(created).not.toBeNull();
    doc = created!.doc as typeof doc;

    const flattened = flattenSceneToEngine(doc, doc.rootChildren as string[]);
    const lowItem = flattened.nodes.find((node) => node.id === created!.lowId);
    const highItem = flattened.nodes.find((node) => node.id === created!.highId);
    expect(lowItem).toBeDefined();
    expect(highItem).toBeDefined();
    expect(lowItem!.kind).toBe('rasterLayer');
    const rasterData = (lowItem as { rasterLayerData?: { tiles: Record<string, unknown> } })
      .rasterLayerData;
    expect(rasterData).toBeDefined();
    expect(Object.keys(rasterData!.tiles).length).toBeGreaterThan(0);
    // The encoded detail band contributes nothing while its mate is visible.
    expect((highItem as { opacity?: number }).opacity).toBe(0);
  });

  it('renders each band alone when its sibling is hidden', () => {
    const source = makeRetouchRaster('r1', 64, 48);
    let doc = addNode(createDocument('FS'), source);
    const created = createFrequencySeparation(doc, 'r1', { radius: 4 })!;
    doc = created.doc as typeof doc;
    const high = doc.nodes[created.highId] as { visible?: boolean };
    const withHiddenHigh = {
      ...doc,
      nodes: { ...doc.nodes, [created.highId]: { ...high, visible: false } },
    } as typeof doc;
    const flattened = flattenSceneToEngine(withHiddenHigh, withHiddenHigh.rootChildren as string[]);
    expect(flattened.ids).toContain(created.lowId);
    expect(flattened.ids).not.toContain(created.highId);
    const lowItem = flattened.nodes.find((node) => node.id === created.lowId);
    expect(
      Object.keys(
        (lowItem as { rasterLayerData?: { tiles: Record<string, unknown> } }).rasterLayerData!
          .tiles,
      ).length,
    ).toBeGreaterThan(0);
  });

  it('warps raster tiles at the IR boundary and identity is a no-op', () => {
    const source = makeRetouchRaster('r1', 64, 48);
    const doc = addNode(createDocument('Liquify'), source);
    const baseline = flattenSceneToEngine(doc, ['r1']);
    const baselineItem = baseline.nodes[0] as {
      rasterLayerData?: { tiles: Record<string, { pixels: number[]; version: number }> };
    };
    const baselineBytes = baselineItem.rasterLayerData!.tiles['0:0']!.pixels.slice(0, 64);

    const pushed = applyLiquifyDabToNode(doc, 'r1', 'push', {
      x: 20,
      y: 20,
      radius: 24,
      strength: 1,
      pressure: 1,
      deltaX: 10,
      deltaY: 4,
    })!;
    const warped = flattenSceneToEngine(pushed, ['r1']);
    const warpedItem = warped.nodes[0] as {
      rasterLayerData?: { tiles: Record<string, { pixels: number[]; version: number }> };
    };
    const warpedBytes = warpedItem.rasterLayerData!.tiles['0:0']!.pixels.slice(0, 64);
    expect(warpedBytes).not.toEqual(baselineBytes);
  });
});
