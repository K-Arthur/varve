// @vitest-environment jsdom

import type { RenderItem } from '@varve/engine';
import type { Document, FrameNode } from '@varve/scene';
import {
  addMockupTemplate,
  createDocument,
  createMockupInstanceData,
  getBuiltinMockupTemplates,
  makeFrameNode,
  nextNodeId,
  setMockupBinding,
  setMockupSurfaceOverride,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  decorateMockupIr,
  effectiveSurface,
  expandQuadForPadding,
  getMockupRenderDiagnostics,
  MockupSurfaceCache,
  parseCssColor,
  resetMockupRenderDiagnostics,
} from '../mockupIr';

function buildFixture(templateId: string): {
  doc: Document;
  frameId: string;
  sourceId: string;
  template: ReturnType<typeof getBuiltinMockupTemplates>[number];
} {
  let doc = createDocument('mockup-test', { flat: true });
  const template = getBuiltinMockupTemplates().find((t) => t.id === templateId)!;
  const withTemplate = addMockupTemplate(doc, template).document;
  const f = nextNodeId(withTemplate);
  doc = f.doc;
  const frameId = f.id;
  doc = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [frameId]: makeFrameNode(frameId, {
        transform: [1, 0, 0, 1, 200, 100],
        w: template.outputWidth,
        h: template.outputHeight,
        name: 'Phone mockup',
      }),
    },
    rootChildren: [...doc.rootChildren, frameId],
  };
  const s = nextNodeId(doc);
  doc = s.doc;
  const sourceId = s.id;
  doc = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [sourceId]: makeFrameNode(sourceId, {
        transform: [1, 0, 0, 1, 0, 0],
        w: 390,
        h: 844,
        name: 'App screen',
      }),
    },
    rootChildren: [...doc.rootChildren, sourceId],
  };
  const frame = doc.nodes[frameId] as FrameNode;
  doc = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [frameId]: { ...frame, mockup: createMockupInstanceData(template.id, {}) },
    },
  };
  doc = setMockupBinding(doc, frameId, template.surfaces[0]!.id, {
    mode: 'live',
    nodeId: sourceId,
  });
  return { doc, frameId, sourceId, template };
}

function stubFrameItem(_frameId: string, w: number, h: number): RenderItem {
  return {
    transform: [1, 0, 0, 1, 200, 100],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    primitive: { kind: 'rect', x: 0, y: 0, w, h },
    opacity: 1,
    blendMode: 'normal',
    strokes: [],
    effects: [],
  };
}

describe('decorateMockupIr', () => {
  it('composes a flat phone mockup: plate, content, shadow, glow', () => {
    const { doc, frameId, sourceId, template } = buildFixture('builtin:phone-flat');
    const items = [stubFrameItem(frameId, template.outputWidth, template.outputHeight)];
    const cache = new MockupSurfaceCache();
    const result = decorateMockupIr({
      doc,
      nodeIds: [frameId, sourceId],
      items,
      renderSubtree: () => {
        /* stub: no pixels in jsdom */
      },
      qualityScale: 1,
      cache,
    });
    const extras = result.extrasByNodeId.get(frameId);
    expect(extras).toBeTruthy();
    // Plate shapes (phone body, camera, buttons, indicator) + shadow + content + glow.
    expect(extras!.length).toBeGreaterThanOrEqual(5);
    const kinds = extras!.map((item) => item.primitive.kind);
    expect(kinds.includes('rect')).toBe(true);
    // The list was spliced after the frame item.
    expect(items.length).toBe(extras!.length + 1);
    const imageItems = extras!.filter((item) => item.fills?.some((f) => f.type === 'image'));
    expect(imageItems.length).toBe(1);
    expect(imageItems[0]!.fills![0]!.type).toBe('image');
  });

  it('composes a perspective phone as a warpedImage with the expanded quad', () => {
    const { doc, frameId, sourceId, template } = buildFixture('builtin:phone-perspective');
    const items = [stubFrameItem(frameId, template.outputWidth, template.outputHeight)];
    const result = decorateMockupIr({
      doc,
      nodeIds: [frameId, sourceId],
      items,
      renderSubtree: () => {},
      qualityScale: 1,
      cache: new MockupSurfaceCache(),
    });
    const extras = result.extrasByNodeId.get(frameId)!;
    const warped = extras.find((item) => item.primitive.kind === 'warpedImage');
    expect(warped).toBeTruthy();
    const p = warped!.primitive as Extract<RenderItem['primitive'], { kind: 'warpedImage' }>;
    expect(p.quad.length).toBe(4);
    expect(p.fit).toBe('stretch');
  });

  it('composes a bounded cylindrical surface as a baked raster slot', () => {
    const { doc, frameId, sourceId, template } = buildFixture('builtin:label-cylinder-front');
    const items = [stubFrameItem(frameId, template.outputWidth, template.outputHeight)];
    const result = decorateMockupIr({
      doc,
      nodeIds: [frameId, sourceId],
      items,
      renderSubtree: () => {},
      qualityScale: 1,
      cache: new MockupSurfaceCache(),
    });
    const extras = result.extrasByNodeId.get(frameId)!;
    const image = extras.find((item) => item.fills?.some((fill) => fill.type === 'image'));
    expect(image).toBeTruthy();
    expect(image!.primitive.kind).toBe('rect');
    expect(getMockupRenderDiagnostics().cylindricalSurfaces).toBeGreaterThan(0);
    expect(result.missingSurfaces).toHaveLength(0);
  });

  it('emits a placeholder when the template is missing', () => {
    let doc = createDocument('mockup-test', { flat: true });
    const f = nextNodeId(doc);
    doc = f.doc;
    const frameId = f.id;
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [frameId]: makeFrameNode(frameId, { transform: [1, 0, 0, 1, 0, 0], w: 400, h: 800 }),
      },
      rootChildren: [...doc.rootChildren, frameId],
    };
    const frame = doc.nodes[frameId] as FrameNode;
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [frameId]: {
          ...frame,
          mockup: createMockupInstanceData('builtin:missing-template', {}),
        },
      },
    };
    const items = [stubFrameItem(frameId, 400, 800)];
    const result = decorateMockupIr({
      doc,
      nodeIds: [frameId],
      items,
      renderSubtree: () => {},
      qualityScale: 1,
      cache: new MockupSurfaceCache(),
    });
    const extras = result.extrasByNodeId.get(frameId)!;
    expect(extras.length).toBe(1);
    expect(extras[0]!.strokes?.length).toBeGreaterThan(0); // dashed placeholder outline
  });

  it('cache hits skip re-baking (diagnostics count)', () => {
    const { doc, frameId, sourceId, template } = buildFixture('builtin:phone-flat');
    const items = [stubFrameItem(frameId, template.outputWidth, template.outputHeight)];
    const cache = new MockupSurfaceCache();
    decorateMockupIr({
      doc,
      nodeIds: [frameId, sourceId],
      items,
      renderSubtree: () => {},
      qualityScale: 1,
      cache,
    });
    const before = cache.size;
    const again = decorateMockupIr({
      doc,
      nodeIds: [frameId, sourceId],
      items: [stubFrameItem(frameId, template.outputWidth, template.outputHeight)],
      renderSubtree: () => {},
      qualityScale: 1,
      cache,
    });
    expect(cache.size).toBe(before);
    expect(again.extrasByNodeId.get(frameId)?.length).toBeGreaterThan(0);
  });

  it('keeps frame-to-item alignment when decorating multiple frames in place', () => {
    const { doc, frameId, sourceId, template } = buildFixture('builtin:phone-flat');
    const second = nextNodeId(doc);
    const secondFrameId = second.id;
    const secondFrame = makeFrameNode(secondFrameId, {
      transform: [1, 0, 0, 1, 900, 100],
      w: template.outputWidth,
      h: template.outputHeight,
      name: 'Second mockup',
    });
    const withSecond = {
      ...second.doc,
      nodes: {
        ...second.doc.nodes,
        [secondFrameId]: {
          ...secondFrame,
          mockup: createMockupInstanceData(template.id, {
            [template.surfaces[0]!.id]: { mode: 'live' as const, nodeId: sourceId },
          }),
        },
      },
      rootChildren: [...second.doc.rootChildren, secondFrameId],
    };
    const firstItem = stubFrameItem(frameId, template.outputWidth, template.outputHeight);
    const secondItem = {
      ...stubFrameItem(secondFrameId, template.outputWidth, template.outputHeight),
      transform: [1, 0, 0, 1, 900, 100] as [number, number, number, number, number, number],
    };
    const items = [firstItem, secondItem];
    const result = decorateMockupIr({
      doc: withSecond,
      nodeIds: [frameId, secondFrameId, sourceId],
      items,
      renderSubtree: () => {},
      qualityScale: 1,
      cache: new MockupSurfaceCache(),
    });
    expect(result.extrasByNodeId.get(secondFrameId)?.[0]?.transform).toEqual(secondItem.transform);
  });

  it('accounts for replacement bytes once in the surface cache', () => {
    resetMockupRenderDiagnostics();
    const cache = new MockupSurfaceCache();
    cache.set('surface', '123456');
    cache.set('surface', '12');
    expect(getMockupRenderDiagnostics().residentSurfaceBytes).toBe(2);
    cache.clear();
  });
});

describe('mockup recovery and override rendering', () => {
  it('emits the template background colour and maps overlay blend modes', () => {
    const { doc, frameId, sourceId, template } = buildFixture('builtin:phone-flat');
    const extraOverlay = {
      id: 'gloss',
      name: 'Gloss',
      kind: 'reflection' as const,
      opacity: 0.5,
      blendMode: 'multiply',
      shapes: [{ kind: 'rect' as const, x: 0, y: 0, width: 100, height: 100, fill: '#ffffff' }],
    };
    const withOverlay = { ...template, id: 'test:overlay', overlays: [extraOverlay] };
    const registered = addMockupTemplate(doc, withOverlay).document;
    const frame = registered.nodes[frameId] as FrameNode;
    const withMockup = {
      ...registered,
      nodes: {
        ...registered.nodes,
        [frameId]: { ...frame, mockup: createMockupInstanceData('test:overlay', {}) },
      },
    };
    const items = [stubFrameItem(frameId, template.outputWidth, template.outputHeight)];
    const result = decorateMockupIr({
      doc: withMockup,
      nodeIds: [frameId, sourceId],
      items,
      renderSubtree: () => {},
      qualityScale: 1,
      cache: new MockupSurfaceCache(),
    });
    const extras = result.extrasByNodeId.get(frameId)!;
    // First extra is the template background colour rect (#eef0f4).
    expect(extras[0]!.primitive.kind).toBe('rect');
    expect(extras[0]!.fill).toMatchObject({ r: 238, g: 240, b: 244 });
    const overlayItem = extras.find((item) => item.blendMode === 'multiply');
    expect(overlayItem).toBeTruthy();
    expect(overlayItem!.opacity).toBeCloseTo(0.5);
  });

  it('reports a missing source and falls back to the last good preview', () => {
    resetMockupRenderDiagnostics();
    const { doc, frameId, sourceId, template } = buildFixture('builtin:phone-flat');
    const cache = new MockupSurfaceCache();
    const run = (document: Document) =>
      decorateMockupIr({
        doc: document,
        nodeIds: [frameId, sourceId],
        items: [stubFrameItem(frameId, template.outputWidth, template.outputHeight)],
        renderSubtree: () => {},
        qualityScale: 1,
        cache,
      });
    const first = run(doc);
    expect(first.missingSurfaces).toHaveLength(0);
    expect(cache.size).toBeGreaterThan(0);

    // Delete the bound source: preview keeps the last good raster, export
    // does not.
    const remainingNodes = { ...doc.nodes };
    delete remainingNodes[sourceId];
    const withoutSource: Document = { ...doc, nodes: remainingNodes as Document['nodes'] };
    const preview = run(withoutSource);
    expect(preview.missingSurfaces).toEqual([
      expect.objectContaining({
        frameId,
        surfaceId: template.surfaces[0]!.id,
        reason: 'source-missing',
      }),
    ]);
    expect(getMockupRenderDiagnostics().staleFallbacks).toBeGreaterThan(0);

    const strict = decorateMockupIr({
      doc: withoutSource,
      nodeIds: [frameId],
      items: [stubFrameItem(frameId, template.outputWidth, template.outputHeight)],
      renderSubtree: () => {},
      qualityScale: 1,
      cache,
      allowStalePreview: false,
    });
    const strictExtras = strict.extrasByNodeId.get(frameId)!;
    const placeholder = strictExtras.find((item) => (item.strokes?.length ?? 0) > 0);
    expect(placeholder).toBeTruthy();
    expect(strictExtras.some((item) => item.fills?.some((f) => f.type === 'image'))).toBe(false);
  });

  it('includes override geometry in the bake cache identity', () => {
    const { doc, frameId, sourceId, template } = buildFixture('builtin:phone-flat');
    const cache = new MockupSurfaceCache();
    const run = (document: Document) =>
      decorateMockupIr({
        doc: document,
        nodeIds: [frameId, sourceId],
        items: [stubFrameItem(frameId, template.outputWidth, template.outputHeight)],
        renderSubtree: () => {},
        qualityScale: 1,
        cache,
      });
    run(doc);
    const afterFirst = cache.size;
    const moved = setMockupSurfaceOverride(doc, frameId, template.surfaces[0]!.id, {
      x: template.surfaces[0]!.x + 25,
    });
    run(moved);
    expect(cache.size).toBeGreaterThan(afterFirst);
  });
});

describe('geometry helpers', () => {
  it('expandQuadForPadding scales about the centroid', () => {
    const quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ] as const;
    const expanded = expandQuadForPadding([...quad] as never, 100, 100, 10, 10);
    expect(expanded[0]).toMatchObject({ x: -10, y: -10 });
    expect(expanded[2]).toMatchObject({ x: 110, y: 110 });
  });

  it('effectiveSurface merges overrides', () => {
    const surface = {
      id: 'screen',
      name: 'Screen',
      kind: 'flat' as const,
      sourceSlot: 'screen',
      x: 0,
      y: 0,
      width: 100,
      height: 200,
      fit: 'contain' as const,
      alignment: { x: 'center' as const, y: 'center' as const },
    };
    const merged = effectiveSurface(surface, { fit: 'cover', x: 5 });
    expect(merged.fit).toBe('cover');
    expect(merged.x).toBe(5);
    expect(merged.y).toBe(0);
  });

  it('parseCssColor handles hex variants and rejects garbage', () => {
    expect(parseCssColor('#f00')).toMatchObject({ space: 'rgb', r: 255, g: 0, b: 0, a: 255 });
    expect(parseCssColor('#0a0b0c0d')).toMatchObject({ r: 10, g: 11, b: 12, a: 13 });
    expect(parseCssColor('not-a-color')).toBeNull();
  });
});
