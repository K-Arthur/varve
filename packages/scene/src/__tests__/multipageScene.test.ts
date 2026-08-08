/**
 * Milestone 5 foundation tests: the placed page scene (ADR-0144/0145).
 */

import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import { addChild, addNode, addPage, createDocument, makeShapeNode, nextNodeId } from '../document';
import { addMasterOverride, assignMasterToPage, createMaster } from '../document-components';
import { deletePageWithPolicy } from '../document-pages';
import {
  buildPlacedScene,
  multipageRootNodes,
  pagesVisibleInWorldRect,
  placedPages,
  worldToPageAtPoint,
} from '../pageScene';
import { pageBoundsInWorld } from '../pasteboardLayout';
import type { GroupNode } from '../types';

function firstMaster(doc: Document) {
  return doc.masters ? Object.values(doc.masters)[0] : undefined;
}

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

describe('multipageRootNodes (ADR-0144 paint order)', () => {
  it('falls back to globals + rootChildren on flat documents (no pages)', () => {
    let doc = createDocument('m5', true);
    // add a root child + a global so the fallback is observable
    const { id: rootId, doc: withRoot } = nextNodeId(doc);
    doc = addNode(withRoot, makeShapeNode(rootId, { kind: 'rect', x: 0, y: 0, w: 5, h: 5 }));
    const { id: globalId, doc: withGlobal } = nextNodeId(doc);
    doc = addNode(withGlobal, makeShapeNode(globalId, { kind: 'rect', x: 0, y: 0, w: 5, h: 5 }));
    doc = { ...doc, globalChildren: [globalId] };
    const roots = multipageRootNodes(doc);
    expect(roots).toEqual([globalId, ...doc.rootChildren]);
  });

  it('paints globals first, then roots in document order (pages expanded in place)', () => {
    let doc = sceneDoc(2, true);
    const page0 = doc.pages![0]!;
    const page1 = doc.pages![1]!;
    const { id: bgId, doc: d1 } = nextNodeId(doc);
    doc = { ...d1, pages: [{ ...page0, backgrounds: [bgId] }, page1] };
    // bg node must exist in the node map (pasteboard-level node)
    doc = addNode(doc, makeShapeNode(bgId, { kind: 'rect', x: 0, y: 0, w: 5, h: 5 }));
    const { id: globalId, doc: d2 } = nextNodeId(doc);
    doc = addNode(d2, makeShapeNode(globalId, { kind: 'rect', x: 0, y: 0, w: 5, h: 5 }));
    doc = { ...doc, globalChildren: [globalId] };

    const { id: pasteboardId, doc: d3 } = nextNodeId(doc);
    doc = addNode(d3, makeShapeNode(pasteboardId, { kind: 'rect', x: 0, y: 0, w: 5, h: 5 }));
    doc = {
      ...doc,
      rootChildren: [doc.pages![0]!.contentRoot, doc.pages![1]!.contentRoot, pasteboardId],
    };

    // add one authored shape to each page content root
    for (const page of doc.pages!) {
      const { id, doc: d } = nextNodeId(doc);
      doc = addChild(
        d,
        page.contentRoot,
        makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      );
    }

    const roots = multipageRootNodes(doc);
    // Globals stay behind everything. After that the order is exactly
    // `rootChildren`, with each page expanded in place as
    // [backgrounds, masters, content].
    //
    // This amends the original ADR-0144 order, which emitted every pasteboard
    // item before every page and so pinned pasteboard content behind all page
    // content whatever the layer tree said. An object dragged off a page onto
    // the pasteboard disappeared behind the page background. Document order
    // makes the rendered z-order match the tree the user is looking at.
    const scene = buildPlacedScene(doc);
    expect(roots[0]).toBe(globalId);
    expect(roots).toEqual([
      globalId,
      bgId,
      ...scene.pages[0]!.contentNodes,
      ...scene.pages[1]!.contentNodes,
      pasteboardId,
    ]);
  });

  it('paints a pasteboard item authored before the pages behind them', () => {
    // The mirror of the case above: document order cuts both ways, so an item
    // that genuinely sits below the pages in the tree still paints behind.
    let doc = sceneDoc(2, true);
    const { id: pasteboardId, doc: d1 } = nextNodeId(doc);
    doc = addNode(d1, makeShapeNode(pasteboardId, { kind: 'rect', x: 0, y: 0, w: 5, h: 5 }));
    doc = {
      ...doc,
      rootChildren: [pasteboardId, doc.pages![0]!.contentRoot, doc.pages![1]!.contentRoot],
    };
    for (const page of doc.pages!) {
      const { id, doc: d } = nextNodeId(doc);
      doc = addChild(
        d,
        page.contentRoot,
        makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      );
    }
    const roots = multipageRootNodes(doc);
    const scene = buildPlacedScene(doc);
    expect(roots.indexOf(pasteboardId)).toBeLessThan(
      roots.indexOf(scene.pages[0]!.contentNodes[0]!),
    );
  });

  it('culls pages outside the viewport world rect', () => {
    let doc = sceneDoc(3, true);
    for (const page of doc.pages!) {
      const { id, doc: d } = nextNodeId(doc);
      doc = addChild(
        d,
        page.contentRoot,
        makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      );
    }
    // manual placement: page 0 at (0,0), page 1 at (300,0), page 2 at (0,300)
    const scene = buildPlacedScene(doc);
    const viewport = { x: 250, y: -10, w: 100, h: 100 };
    const roots = multipageRootNodes(doc, { viewportWorldRect: viewport });
    expect(roots.length).toBeGreaterThan(0);
    for (const id of roots) {
      // page 0 content (at x 0..200) and page 2 content (at y 300) are culled
      expect(scene.pages[0]!.contentNodes.includes(id)).toBe(false);
      expect(scene.pages[2]!.contentNodes.includes(id)).toBe(false);
    }
    expect(scene.pages[1]!.contentNodes.every((id) => roots.includes(id))).toBe(true);
  });

  it('includes all pages when no viewport is given', () => {
    let doc = sceneDoc(4);
    for (const page of doc.pages!) {
      const { id, doc: d } = nextNodeId(doc);
      doc = addChild(
        d,
        page.contentRoot,
        makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      );
    }
    const scene = buildPlacedScene(doc);
    const roots = multipageRootNodes(doc);
    const allContent = scene.pages.flatMap((p) => p.contentNodes);
    expect(allContent.length).toBe(4);
    for (const id of allContent) expect(roots).toContain(id);
  });

  it('is deterministic across calls and placements resolve once per document', () => {
    const doc = sceneDoc(4);
    const scene = buildPlacedScene(doc);
    expect(multipageRootNodes(doc)).toEqual(multipageRootNodes(doc));
    // every placed page carries the same placement the map reports
    for (const placed of scene.pages) {
      expect(scene.placements.get(placed.page.id)).toEqual(placed.placement);
    }
    expect(scene.placements.size).toBe(4);
  });
});

describe('master projection into the placed scene (M8, ADR-0132)', () => {
  function masterDoc(): Document {
    let doc = createDocument('m8', false);
    doc = createMaster(doc, { name: 'Body', width: 1920, height: 1080 });
    const master = firstMaster(doc)!;
    const masterRoot = doc.nodes[master.contentRoot] as GroupNode;
    const { id: headerId, doc: d1 } = nextNodeId(doc);
    doc = addChild(
      d1,
      masterRoot.id,
      makeShapeNode(headerId, { kind: 'rect', x: 0, y: 0, w: 100, h: 20 }),
    );
    const { id: footerId, doc: d2 } = nextNodeId(doc);
    doc = addChild(
      d2,
      masterRoot.id,
      makeShapeNode(footerId, { kind: 'rect', x: 0, y: 0, w: 100, h: 20 }),
    );
    doc = assignMasterToPage(doc, doc.pages![0]!.id, master.id);
    return doc;
  }

  it('projects master children onto assigned pages', () => {
    const doc = masterDoc();
    const placed = placedPages(doc)[0]!;
    expect(placed.masterNodes.length).toBe(2);
  });

  it('hidden and deleted overrides remove master items (B3)', () => {
    let doc = masterDoc();
    const master = firstMaster(doc)!;
    const masterRoot = doc.nodes[master.contentRoot] as GroupNode;
    const [headerId, footerId] = masterRoot.children;
    const page = doc.pages![0]!;
    doc = addMasterOverride(doc, page.id, headerId!, 'hidden');
    doc = addMasterOverride(doc, page.id, footerId!, 'deleted');
    const placed = placedPages(doc)[0]!;
    expect(placed.masterNodes).toEqual([]);
  });

  it('modified overrides substitute the local replacement node', () => {
    let doc = masterDoc();
    const master = firstMaster(doc)!;
    const masterRoot = doc.nodes[master.contentRoot] as GroupNode;
    const headerId = masterRoot.children[0]!;
    doc = addMasterOverride(doc, doc.pages![0]!.id, headerId, 'modified', 'local-header');
    const placed = placedPages(doc)[0]!;
    expect(placed.masterNodes).toContain('local-header');
    expect(placed.masterNodes).not.toContain(headerId);
  });

  it('includes master nodes in the multipage paint order, behind page content', () => {
    const doc = masterDoc();
    const roots = multipageRootNodes(doc);
    const master = firstMaster(doc)!;
    const masterRoot = doc.nodes[master.contentRoot] as GroupNode;
    for (const mChildId of masterRoot.children) {
      expect(roots).toContain(mChildId);
    }
  });

  it('projects nothing for unassigned pages', () => {
    const doc = createDocument('m8', false);
    const placed = placedPages(doc)[0]!;
    expect(placed.masterNodes).toEqual([]);
  });
});

describe('page culling must not drop content outside the trim', () => {
  /** A page with one node parked far to the right of its trim box. */
  function docWithOutsideContent(offset: number) {
    const doc = addPage(createDocument('cull', false), { width: 1000, height: 1400 });
    const page = doc.pages![0]!;
    const trim = placedPages(doc)[0]!.bounds;
    const x = trim.x + trim.w + offset;
    const { id, doc: d1 } = nextNodeId(doc);
    const node = makeShapeNode(
      id,
      { kind: 'rect', x: 0, y: 0, w: 987, h: 740 },
      { transform: [1, 0, 0, 1, x, 16] },
    );
    return { doc: addChild(d1, page.contentRoot, node), id, trim, x };
  }

  it('keeps content parked outside the trim when the viewport is scrolled to it', () => {
    // The reported bug: the page trim is off-screen, so the page was culled
    // and every one of its content nodes went with it — including this one,
    // which is squarely in view. The selection overlay resolves world bounds
    // independently, so handles still drew over content that never rendered.
    const { doc, id, x } = docWithOutsideContent(1200);
    const roots = multipageRootNodes(doc, {
      viewportWorldRect: { x: x - 200, y: 0, w: 1400, h: 900 },
    });
    expect(roots).toContain(id);
  });

  it('still culls a page whose trim and content are both off-viewport', () => {
    // The fix must not defeat the culling it widened.
    const { doc, id } = docWithOutsideContent(0);
    const roots = multipageRootNodes(doc, {
      viewportWorldRect: { x: 90_000, y: 90_000, w: 800, h: 600 },
    });
    expect(roots).not.toContain(id);
  });

  it('keeps content when the trim itself is in view', () => {
    const { doc, id, trim } = docWithOutsideContent(1200);
    const roots = multipageRootNodes(doc, { viewportWorldRect: trim });
    expect(roots).toContain(id);
  });
});

describe('deleting the final page', () => {
  it('removes the last page and keeps its content on the canvas', () => {
    // Pages are additive, so a single-page document must not be a state the
    // user can enter but never leave. The content has to survive: it is the
    // whole document at that point.
    let doc = createDocument('last-page', false);
    const page = doc.pages![0]!;
    const { id, doc: d1 } = nextNodeId(doc);
    doc = addChild(
      d1,
      page.contentRoot,
      makeShapeNode(
        id,
        { kind: 'rect', x: 0, y: 0, w: 40, h: 40 },
        {
          transform: [1, 0, 0, 1, 10, 10],
        },
      ),
    );

    const after = deletePageWithPolicy(doc, page.id, 'move-to-pasteboard');

    expect(after.pages ?? []).toHaveLength(0);
    expect(after.activePageId).toBeUndefined();
    expect(after.nodes[id]).toBeTruthy();
    expect(after.rootChildren).toContain(id);
    // The document still renders: no pages means the flat-document path.
    expect(multipageRootNodes(after)).toContain(id);
  });

  it('preserves content even when asked to discard it, on the last page only', () => {
    // Forcing the policy here is deliberate: deleting the final page must not
    // be a one-click way to empty the entire document.
    let doc = createDocument('last-page-2', false);
    const page = doc.pages![0]!;
    const { id, doc: d1 } = nextNodeId(doc);
    doc = addChild(
      d1,
      page.contentRoot,
      makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 40, h: 40 }),
    );

    const after = deletePageWithPolicy(doc, page.id, 'delete-content');
    expect(after.nodes[id]).toBeTruthy();
    expect(after.rootChildren).toContain(id);
  });

  it('still honours delete-content while other pages remain', () => {
    let doc = addPage(createDocument('multi', false), {});
    const first = doc.pages![0]!;
    const { id, doc: d1 } = nextNodeId(doc);
    doc = addChild(
      d1,
      first.contentRoot,
      makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 40, h: 40 }),
    );

    const after = deletePageWithPolicy(doc, first.id, 'delete-content');
    expect(after.pages).toHaveLength(1);
    expect(after.nodes[id]).toBeUndefined();
  });
});
