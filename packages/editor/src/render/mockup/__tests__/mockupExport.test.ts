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
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  clearMockupExportCache,
  collectMockupLiveSourceIds,
  decorateMockupSubtree,
  missingSurfaceWarning,
  subtreeNeedsDecoration,
} from '../mockupExport';

function fixture(): {
  doc: Document;
  frameId: string;
  sourceId: string;
  templateId: string;
} {
  let doc = createDocument('mockup-export-test', { flat: true });
  const template = getBuiltinMockupTemplates().find((t) => t.id === 'builtin:phone-flat')!;
  doc = addMockupTemplate(doc, template).document;
  const f = nextNodeId(doc);
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
  return { doc, frameId, sourceId, templateId: template.id };
}

function stubItem(): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    opacity: 1,
    blendMode: 'normal',
    strokes: [],
    effects: [],
  };
}

describe('mockup export decoration', () => {
  it('collects live-bound sources and detects decoration need', () => {
    const { doc, frameId, sourceId } = fixture();
    expect(collectMockupLiveSourceIds(doc, [frameId])).toEqual([sourceId]);
    expect(subtreeNeedsDecoration(doc, [frameId])).toBe(true);
    expect(subtreeNeedsDecoration(doc, [sourceId])).toBe(false);
  });

  it('keeps flattened item alignment and never serves stale pixels for export', () => {
    clearMockupExportCache();
    const { doc, frameId, sourceId } = fixture();
    const items = [stubItem(), stubItem()];
    const before = items.length;
    const result = decorateMockupSubtree({
      doc,
      rootIds: [frameId, sourceId],
      flattenedIds: [frameId, sourceId],
      items,
      qualityScale: 2,
      insertIntoList: false,
    });
    // insertIntoList:false keeps `items` 1:1 with flattened ids; extras ride
    // the map instead.
    expect(items).toHaveLength(before);
    expect(result.extrasByNodeId.get(frameId)?.length).toBeGreaterThan(0);
    expect(result.missingSurfaces).toHaveLength(0);

    // Remove the source: export reports the missing surface (with the
    // placeholder drawn) instead of silently reusing a baked preview.
    const nodes = { ...doc.nodes };
    delete nodes[sourceId];
    const strict = decorateMockupSubtree({
      doc: { ...doc, nodes } as Document,
      rootIds: [frameId],
      flattenedIds: [frameId],
      items: [stubItem()],
      qualityScale: 2,
      insertIntoList: false,
    });
    expect(strict.missingSurfaces).toHaveLength(1);
    expect(strict.missingSurfaces[0]).toMatchObject({ frameId, reason: 'source-missing' });
    expect(missingSurfaceWarning(strict.missingSurfaces[0]!)).toContain('placeholder');
    // No baked surface raster is emitted for the missing source.
    const extras = strict.extrasByNodeId.get(frameId) ?? [];
    expect(extras.some((item) => item.fills?.some((f) => f.type === 'image'))).toBe(false);
  });
});
