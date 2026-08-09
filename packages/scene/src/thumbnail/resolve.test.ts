import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import { createDocument } from '../document';
import { removePage } from '../document-pages';
import type { SceneNode } from '../types';
import { hasRenderableContent, resolveThumbnailSource, validateThumbnailSource } from './resolve';

function shapeNode(id: string, x: number, y: number, w: number, h: number): SceneNode {
  return {
    id,
    kind: 'shape',
    name: id,
    layerColor: null,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, x, y] as SceneNode['transform'],
    shape: { kind: 'rect', x: 0, y: 0, w, h },
    fill: { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
    fills: [],
    strokes: [],
    effects: [],
  };
}

function frameNode(id: string, x: number, y: number, w: number, h: number): SceneNode {
  return {
    id,
    kind: 'frame',
    name: id,
    layerColor: null,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, x, y] as SceneNode['transform'],
    w,
    h,
    fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    fills: [],
    strokes: [],
    effects: [],
    children: [],
  };
}

function attach(doc: Document, parent: SceneNode, child: SceneNode): void {
  doc.nodes[child.id] = child;
  if ('children' in parent) {
    (parent.children as string[]).push(child.id);
  } else if (parent.kind === 'shape' || parent.kind === 'text') {
    doc.rootChildren.push(child.id);
  }
}

/** Flat document (no pages) with two top-level frames. */
function flatDocWithFrames(): Document {
  const doc = createDocument('flat', true);
  const big = frameNode('frame-big', 0, 0, 800, 600);
  const small = frameNode('frame-small', 2000, 2000, 100, 100);
  const rect = shapeNode('rect1', 10, 10, 100, 100);
  attach(doc, big, rect);
  doc.nodes[big.id] = big;
  doc.nodes[small.id] = small;
  doc.rootChildren = [big.id, small.id];
  return doc;
}

describe('resolveThumbnailSource — automatic', () => {
  it('uses the active page when the document has pages', () => {
    const doc = createDocument('pages');
    expect(doc.pages?.length).toBeGreaterThan(0);
    const page = doc.pages?.[0];
    const rect = shapeNode('page-rect', 10, 10, 100, 100);
    doc.nodes[rect.id] = rect;
    const contentRoot = doc.nodes[page?.contentRoot as string];
    (contentRoot as { children: string[] }).children.push(rect.id);
    const sel = resolveThumbnailSource(doc, { type: 'automatic' });
    expect(sel.validity).toBe('valid');
    expect(sel.ids).toContain(rect.id);
  });

  it('picks the largest populated top-level frame in a flat document', () => {
    const doc = flatDocWithFrames();
    const sel = resolveThumbnailSource(doc, { type: 'automatic' });
    expect(sel.ids[0]).toBe('frame-big');
    expect(sel.ids).toContain('rect1');
    expect(sel.ids).not.toContain('frame-small');
  });

  it('marks empty documents as empty (no rendering of meaningless pixels)', () => {
    const doc = createDocument('empty', true);
    doc.rootChildren = [];
    const sel = resolveThumbnailSource(doc, { type: 'automatic' });
    expect(sel.validity).toBe('empty');
  });

  it('excludes hidden nodes', () => {
    const doc = createDocument('flat', true);
    const f = frameNode('f1', 0, 0, 100, 100);
    f.fills = [
      {
        type: 'solid',
        color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ];
    const hidden = shapeNode('hidden1', 0, 0, 50, 50);
    hidden.visible = false;
    attach(doc, f, hidden);
    doc.nodes[f.id] = f;
    doc.rootChildren = [f.id];
    const sel = resolveThumbnailSource(doc, { type: 'automatic' });
    expect(sel.validity).toBe('valid');
    expect(sel.ids).toContain('f1');
    expect(sel.ids).not.toContain('hidden1');
  });

  it('ignores empty containers when choosing an automatic frame', () => {
    const doc = createDocument('flat', true);
    const emptyFrame = frameNode('f-empty', 0, 0, 5000, 5000);
    const content = shapeNode('s1', 0, 0, 50, 50);
    doc.nodes[emptyFrame.id] = emptyFrame;
    doc.nodes[content.id] = content;
    doc.rootChildren = [emptyFrame.id, content.id];
    const sel = resolveThumbnailSource(doc, { type: 'automatic' });
    // The huge empty frame is not meaningful; plain root content is used.
    expect(sel.ids).toContain('s1');
    expect(sel.ids).not.toContain('f-empty');
  });
});

describe('resolveThumbnailSource — page', () => {
  it('returns the master-aware page projection', () => {
    const doc = createDocument('pages');
    const pageId = doc.pages![0]!.id;
    const sel = resolveThumbnailSource(doc, { type: 'page', pageId });
    expect(sel.validity).toBe('valid');
    expect(sel.worldFrame).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it('reports missing-source for a deleted page', () => {
    const doc = createDocument('pages');
    const pageId = doc.pages![0]!.id;
    const next = removePage(doc, pageId);
    const sel = resolveThumbnailSource(next, { type: 'page', pageId });
    expect(sel.validity).toBe('missing-source');
    expect(sel.ids).toEqual([]);
  });

  it('handles documents without pages by reporting missing-source', () => {
    const doc = createDocument('flat', true);
    const sel = resolveThumbnailSource(doc, { type: 'page', pageId: 'p1' });
    expect(sel.validity).toBe('missing-source');
  });
});

describe('resolveThumbnailSource — frame', () => {
  it('includes the frame and its descendants', () => {
    const doc = flatDocWithFrames();
    const sel = resolveThumbnailSource(doc, { type: 'frame', nodeId: 'frame-small' });
    expect(sel.validity).toBe('valid');
    expect(sel.ids).toEqual(['frame-small']);
    expect(sel.worldFrame).toEqual({ x: 2000, y: 2000, w: 100, h: 100 });
  });

  it('reports missing-source after the frame is deleted', () => {
    const doc = flatDocWithFrames();
    delete doc.nodes['frame-big'];
    doc.rootChildren = doc.rootChildren.filter((id) => id !== 'frame-big');
    const sel = resolveThumbnailSource(doc, { type: 'frame', nodeId: 'frame-big' });
    expect(sel.validity).toBe('missing-source');
  });
});

describe('resolveThumbnailSource — selection', () => {
  it('keeps only existing, renderable ids and computes a union frame', () => {
    const doc = flatDocWithFrames();
    const sel = resolveThumbnailSource(doc, {
      type: 'selection',
      nodeIds: ['frame-big', 'rect1', 'does-not-exist'],
    });
    expect(sel.validity).toBe('valid');
    expect(sel.ids).toEqual(['frame-big', 'rect1']);
    expect(sel.worldFrame?.x).toBe(0);
    expect(sel.worldFrame?.y).toBe(0);
    expect(sel.worldFrame?.w).toBeGreaterThanOrEqual(800);
  });

  it('reports missing-source when nothing survives filtering', () => {
    const doc = flatDocWithFrames();
    const sel = resolveThumbnailSource(doc, { type: 'selection', nodeIds: ['gone1', 'gone2'] });
    expect(sel.validity).toBe('missing-source');
  });
});

describe('resolveThumbnailSource — region', () => {
  it('normalizes negative region extents into a world frame', () => {
    const doc = flatDocWithFrames();
    const sel = resolveThumbnailSource(doc, {
      type: 'region',
      region: { x: 100, y: 100, w: -50, h: -20 },
    });
    expect(sel.worldFrame).toEqual({ x: 50, y: 80, w: 50, h: 20 });
    expect(sel.validity).toBe('valid');
  });
});

describe('validateThumbnailSource + hasRenderableContent', () => {
  it('validates persisted preferences against the current document', () => {
    const doc = flatDocWithFrames();
    expect(validateThumbnailSource(doc, { type: 'frame', nodeId: 'frame-small' })).toBe('valid');
    expect(validateThumbnailSource(doc, { type: 'frame', nodeId: 'gone' })).toBe('missing-source');
  });

  it('detects a fully empty document', () => {
    const doc = createDocument('empty', true);
    doc.rootChildren = [];
    expect(hasRenderableContent(doc)).toBe(false);
  });

  it('detects content with only hidden nodes as empty', () => {
    const doc = createDocument('empty', true);
    const hidden = shapeNode('h', 0, 0, 10, 10);
    hidden.visible = false;
    doc.nodes[hidden.id] = hidden;
    doc.rootChildren = [hidden.id];
    expect(hasRenderableContent(doc)).toBe(false);
  });

  it('ignores adjustment nodes for emptiness', () => {
    const doc = createDocument('empty', true);
    doc.nodes['adj1'] = {
      id: 'adj1',
      kind: 'adjustment',
      name: 'adj',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      adjustmentType: 'brightness',
      params: { amount: 0 },
      clipping: false,
      effects: [],
      scope: [],
      mask: null,
      order: 'a0',
      layerColor: null,
      fills: [],
      strokes: [],
    } as unknown as SceneNode;
    doc.rootChildren = ['adj1'];
    expect(hasRenderableContent(doc)).toBe(false);
  });
});
