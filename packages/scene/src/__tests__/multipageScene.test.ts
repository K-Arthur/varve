/**
 * Milestone 5 foundation tests: the placed page scene (ADR-0144/0145).
 */

import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import { addChild, addPage, createDocument, makeShapeNode, nextNodeId } from '../document';
import { pagesVisibleInWorldRect, placedPages, worldToPageAtPoint } from '../pageScene';
import { pageBoundsInWorld } from '../pasteboardLayout';

function sceneDoc(count: number, manual = false): Document {
  let doc = createDocument('m5', false);
  for (let i = 1; i < count; i++) doc = addPage(doc, { width: 200 + i * 50, height: 150 + i * 25 });
  if (manual) {
    doc = {
      ...doc,
      pages: doc.pages!.map((p, i) => ({
        ...p,
        width: 200 + i * 50,
        height: 150 + i * 25,
        placement: { x: (i % 2) * 300, y: Math.floor(i / 2) * 300 },
      })),
    };
  }
  return doc;
}

describe('Placed page scene (ADR-0144/0145)', () => {
  it('produces one placed page per page, in order, with resolved bounds', () => {
    const doc = sceneDoc(3, true);
    const scene = placedPages(doc);
    expect(scene.map((p) => p.page.id)).toEqual(doc.pages!.map((p) => p.id));
    for (const placed of scene) {
      expect(placed.bounds).toEqual(pageBoundsInWorld(doc, placed.page.id));
      expect(placed.placement).toEqual(placed.page.placement);
    }
  });

  it('includes content and background nodes', () => {
    let doc = createDocument('m5', false);
    const page = doc.pages![0]!;
    const { id: nodeId, doc: d1 } = nextNodeId(doc);
    doc = addChild(
      d1,
      page.contentRoot,
      makeShapeNode(nodeId, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
    );
    const scene = placedPages(doc);
    expect(scene[0]!.contentNodes).toContain(nodeId);
    expect(scene[0]!.backgroundNodes).toEqual([]);
  });

  it('culls pages outside the viewport', () => {
    const doc = sceneDoc(3, true);
    const visible = pagesVisibleInWorldRect(doc, { x: -10, y: -10, w: 250, h: 200 });
    expect(visible.length).toBe(1);
    expect(visible[0]!.page.id).toBe(doc.pages![0]!.id);

    const none = pagesVisibleInWorldRect(doc, { x: 5000, y: 5000, w: 10, h: 10 });
    expect(none).toEqual([]);

    const all = pagesVisibleInWorldRect(doc, { x: -10, y: -10, w: 2000, h: 2000 });
    expect(all.length).toBe(3);
  });

  it('resolves world points to pages with page-local coordinates', () => {
    const doc = sceneDoc(2, true);
    const hit = worldToPageAtPoint(doc, { x: 10, y: 10 });
    expect(hit).not.toBeNull();
    expect(hit!.pageId).toBe(doc.pages![0]!.id);
    expect(hit!.local).toEqual({ x: 10, y: 10 });

    const second = worldToPageAtPoint(doc, { x: 310, y: 10 });
    expect(second!.pageId).toBe(doc.pages![1]!.id);
    expect(second!.local).toEqual({ x: 10, y: 10 });

    expect(worldToPageAtPoint(doc, { x: 150, y: 150 })).toBeNull();
  });

  it('reports export exclusion and page numbers', () => {
    let doc = sceneDoc(2, true);
    doc = {
      ...doc,
      pages: [{ ...doc.pages![0]!, printSettings: { excludeFromExport: true } }, doc.pages![1]!],
    };
    const scene = placedPages(doc);
    expect(scene[0]!.exportEnabled).toBe(false);
    expect(scene[1]!.exportEnabled).toBe(true);
    expect(scene[0]!.pageNumber).toBe('1');
  });

  it('is deterministic across calls', () => {
    const doc = sceneDoc(4);
    expect(placedPages(doc)).toEqual(placedPages(doc));
  });
});
