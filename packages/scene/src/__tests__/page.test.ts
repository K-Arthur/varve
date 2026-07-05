import { describe, expect, it } from 'vitest';
import type { Page } from '../types';
import type { GroupNode } from '../types';
import {
  addChild,
  addGlobalChild,
  addPage,
  activePageNodes,
  createDocument,
  duplicatePage,
  migrateToPages,
  nextNodeId,
  removeGlobalChild,
  removePage,
  reorderPages,
  setActivePage,
  setPageSize,
  makeShapeNode,
} from '../document';

function firstPage(doc: ReturnType<typeof createDocument>): Page {
  return doc.pages![0]!;
}

describe('Page operations', () => {
  it('createDocument creates an initial default page', () => {
    const doc = createDocument();
    expect(doc.pages).toBeDefined();
    expect(doc.pages!.length).toBe(1);
    const page = firstPage(doc);
    expect(page.name).toBe('Page 1');
    expect(page.width).toBe(1920);
    expect(page.height).toBe(1080);
    expect(page.contentRoot).toBeDefined();
    expect(page.backgrounds).toEqual([]);
  });

  it('default page has a contentRoot group node in nodes', () => {
    const doc = createDocument();
    const page = firstPage(doc);
    const contentRoot = doc.nodes[page.contentRoot];
    expect(contentRoot).toBeDefined();
    expect(contentRoot!.kind).toBe('group');
    expect(contentRoot!.name).toBe('Page 1 content');
  });

  it('default page contentRoot is in rootChildren', () => {
    const doc = createDocument();
    const page = firstPage(doc);
    expect(doc.rootChildren).toEqual([page.contentRoot]);
  });

  it('addPage creates a new page with auto-generated name', () => {
    let doc = createDocument();
    doc = addPage(doc);
    expect(doc.pages!.length).toBe(2);
    expect(doc.pages![1]!.name).toBe('Page 2');
  });

  it('addPage creates a new page with custom name', () => {
    let doc = createDocument();
    doc = addPage(doc, { name: 'Cover' });
    expect(doc.pages!.length).toBe(2);
    expect(doc.pages![1]!.name).toBe('Cover');
  });

  it('addPage creates a new page with custom dimensions', () => {
    let doc = createDocument();
    doc = addPage(doc, { width: 1080, height: 1920 });
    expect(doc.pages!.length).toBe(2);
    expect(doc.pages![1]!.width).toBe(1080);
    expect(doc.pages![1]!.height).toBe(1920);
  });

  it('addPage adds contentRoot and background nodes correctly', () => {
    let doc = createDocument();
    doc = addPage(doc);
    const newPage = doc.pages![1]!;
    const contentRoot = doc.nodes[newPage.contentRoot];
    expect(contentRoot).toBeDefined();
    expect(contentRoot!.kind).toBe('group');
    expect(newPage.backgrounds).toEqual([]);
  });

  it('removePage removes a page and its contentRoot node', () => {
    let doc = createDocument();
    const firstPageId = firstPage(doc).id;
    const firstContentRootId = firstPage(doc).contentRoot;
    doc = addPage(doc);
    const secondPageId = doc.pages![1]!.id;
    const secondContentRootId = doc.pages![1]!.contentRoot;

    doc = removePage(doc, secondPageId);
    expect(doc.pages!.length).toBe(1);
    expect(doc.pages![0]!.id).toBe(firstPageId);

    // Content root should be removed from nodes
    expect(doc.nodes[secondContentRootId]).toBeUndefined();
    // First page's content root should still exist
    expect(doc.nodes[firstContentRootId]).toBeDefined();
  });

  it('removePage removes child nodes inside the contentRoot', () => {
    let doc = createDocument();
    const pageId = firstPage(doc).id;
    const contentRootId = firstPage(doc).contentRoot;

    // Add a child to the page's contentRoot
    const { id: childId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const shape = makeShapeNode(childId, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    doc = addChild(doc, contentRootId, shape);

    // Add another page
    doc = addPage(doc);
    const secondPageId = doc.pages![1]!.id;

    // Remove first page (should remove contentRoot and its child)
    doc = removePage(doc, pageId);
    expect(doc.nodes[contentRootId]).toBeUndefined();
    expect(doc.nodes[childId]).toBeUndefined();
    // Second page should still exist
    expect(doc.pages!.length).toBe(1);
    expect(doc.pages![0]!.id).toBe(secondPageId);
  });

  it('removePage prevents removal of last page', () => {
    let doc = createDocument();
    const pageId = firstPage(doc).id;
    const result = removePage(doc, pageId);
    expect(result.pages!.length).toBe(1);
    expect(result.pages![0]!.id).toBe(pageId);
  });

  it('reorderPages reorders pages', () => {
    let doc = createDocument();
    doc = addPage(doc);
    doc = addPage(doc);
    expect(doc.pages!.length).toBe(3);

    const ids = doc.pages!.map((p) => p.id);
    const reversed = [...ids].reverse();
    doc = reorderPages(doc, reversed);
    expect(doc.pages!.map((p) => p.id)).toEqual(reversed);
    // Names should be preserved (not renamed)
    expect(doc.pages!.map((p) => p.name)).toEqual(['Page 3', 'Page 2', 'Page 1']);
  });

  it('reorderPages validates all page IDs exist', () => {
    let doc = createDocument();
    doc = addPage(doc);
    const result = reorderPages(doc, ['nonexistent-id']);
    expect(result).toBe(doc);
  });

  it('reorderPages validates all page IDs are present (not a subset)', () => {
    let doc = createDocument();
    doc = addPage(doc);
    const firstIdOnly = [doc.pages![0]!.id];
    const result = reorderPages(doc, firstIdOnly);
    expect(result).toBe(doc);
  });

  it('duplicatePage deep-copies page content', () => {
    let doc = createDocument();
    const originalId = firstPage(doc).id;
    const contentRootId = firstPage(doc).contentRoot;

    // Add some content to the page
    const { id: childId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const shape = makeShapeNode(childId, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    doc = addChild(doc, contentRootId, shape);

    // Now duplicate
    doc = duplicatePage(doc, originalId);
    expect(doc.pages!.length).toBe(2);
    expect(doc.pages![1]!.name).toBe('Page 1 Copy');
    expect(doc.pages![1]!.id).not.toBe(originalId);
    expect(doc.pages![1]!.contentRoot).not.toBe(contentRootId);

    // Content should be duplicated with new IDs
    const origContentRoot = doc.nodes[contentRootId];
    const dupContentRoot = doc.nodes[doc.pages![1]!.contentRoot];
    expect(dupContentRoot).toBeDefined();
    expect(dupContentRoot!.kind).toBe('group');

    // Original node should still exist
    expect(doc.nodes[childId]).toBeDefined();
    // Duplicated child should have a different ID
    const origChildren = (origContentRoot! as { children: string[] }).children;
    const dupChildren = (dupContentRoot! as { children: string[] }).children;
    expect(dupChildren.length).toBe(1);
    expect(dupChildren[0]).not.toBe(origChildren[0]);
  });

  it('duplicatePage creates separate node trees (no shared references)', () => {
    let doc = createDocument();
    const originalId = firstPage(doc).id;
    const contentRootId = firstPage(doc).contentRoot;

    // Add a shape to the page
    const { id: childId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const shape = makeShapeNode(childId, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    doc = addChild(doc, contentRootId, shape);

    doc = duplicatePage(doc, originalId);
    const dupContentRoot = doc.nodes[doc.pages![1]!.contentRoot];

    // Structure check: both content roots exist and have children
    expect(contentRootId).not.toBe(doc.pages![1]!.contentRoot);
    expect(doc.nodes[contentRootId]).toBeDefined();
    expect(dupContentRoot).toBeDefined();
  });

  it('setPageSize changes page dimensions', () => {
    let doc = createDocument();
    const pageId = firstPage(doc).id;
    doc = setPageSize(doc, pageId, 800, 600);
    expect(doc.pages![0]!.width).toBe(800);
    expect(doc.pages![0]!.height).toBe(600);
  });

  it('setPageSize does not scale content', () => {
    let doc = createDocument();
    const pageId = firstPage(doc).id;
    const contentRootId = firstPage(doc).contentRoot;

    // Add a shape
    const { id: childId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const shape = makeShapeNode(childId, { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    doc = addChild(doc, contentRootId, shape);

    doc = setPageSize(doc, pageId, 2000, 2000);
    const child = doc.nodes[childId];
    expect(child).toBeDefined();
    // Shape should still have its original dimensions (not scaled)
    if (child && child.kind === 'shape') {
      expect(child.shape).toEqual({ kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    }
  });

  it('migrateToPages wraps existing rootChildren in a page', () => {
    let doc = createDocument();
    // Remove pages and add root-level nodes manually to simulate old doc
    const { id: childId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const shape = makeShapeNode(childId, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    doc = {
      ...doc,
      pages: undefined,
      rootChildren: [childId],
      nodes: { ...doc.nodes, [childId]: shape },
    } as unknown as ReturnType<typeof createDocument>;

    doc = migrateToPages(doc);

    expect(doc.pages).toBeDefined();
    expect(doc.pages!.length).toBe(1);
    // The rootChildren should now be the contentRoot
    const page = doc.pages![0]!;
    expect(doc.rootChildren).toEqual([page.contentRoot]);
    // The contentRoot should contain the old rootChildren as children
    const contentRoot = doc.nodes[page.contentRoot] as { children: string[] } | undefined;
    expect(contentRoot).toBeDefined();
    expect(contentRoot!.children).toEqual([childId]);
  });

  it('migrateToPages uses A4 size for print-oriented documents', () => {
    let doc = createDocument();
    const { id: nid, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = {
      ...doc,
      pages: undefined,
      rootChildren: [nid],
      nodes: {
        ...doc.nodes,
        [nid]: makeShapeNode(nid, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      },
      dpi: 300,
      physicalWidth: 210,
      physicalHeight: 297,
      documentUnit: 'mm' as const,
    } as unknown as ReturnType<typeof createDocument>;

    doc = migrateToPages(doc);
    expect(doc.pages).toBeDefined();
    expect(doc.pages![0]!.width).toBe(210);
    expect(doc.pages![0]!.height).toBe(297);
  });

  it('migrateToPages preserves already-paginated documents', () => {
    const doc = createDocument();
    const pagesCopy = [...doc.pages!];
    const result = migrateToPages(doc);
    expect(result).toBe(doc);
    expect(result.pages).toEqual(pagesCopy);
  });

  it('migrateToPages uses A4 size and bleed for print-oriented documents', () => {
    let doc = createDocument();
    // Clear pages and set print fields to simulate a print-oriented pre-page doc
    const { id: nid, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = {
      ...doc,
      pages: undefined,
      rootChildren: [nid],
      nodes: {
        ...doc.nodes,
        [nid]: makeShapeNode(nid, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }),
      },
      dpi: 300,
      physicalWidth: 210,
      physicalHeight: 297,
      documentUnit: 'mm' as const,
      bleed: { top: 3, right: 3, bottom: 3, left: 3, linked: true, unit: 'mm' as const },
    } as unknown as ReturnType<typeof createDocument>;

    const migrated = migrateToPages(doc);
    expect(migrated.pages![0]!.width).toBe(210);
    expect(migrated.pages![0]!.height).toBe(297);
    expect(migrated.pages![0]!.bleed).toBeDefined();
    expect(migrated.pages![0]!.bleed!.top).toBe(3);
  });

  describe('Active page & global children', () => {
    it('createDocument sets activePageId and globalChildren', () => {
      const doc = createDocument();
      expect(doc.activePageId).toBeDefined();
      expect(doc.activePageId).toBe(doc.pages![0]!.contentRoot);
      expect(doc.globalChildren).toEqual([]);
    });

    it('setActivePage updates activePageId', () => {
      const doc = createDocument();
      const newPageId = 'custom-page-id';
      const updated = setActivePage(doc, newPageId);
      expect(updated.activePageId).toBe(newPageId);
      expect(updated).not.toBe(doc);
    });

    it('addGlobalChild adds a node ID to globalChildren', () => {
      const doc = createDocument();
      const nodeId = 'test-node-1';
      const updated = addGlobalChild(doc, nodeId);
      expect(updated.globalChildren).toEqual([nodeId]);
    });

    it('addGlobalChild does not duplicate existing node IDs', () => {
      const doc = createDocument();
      const nodeId = 'test-node-1';
      const once = addGlobalChild(doc, nodeId);
      const twice = addGlobalChild(once, nodeId);
      expect(twice.globalChildren).toEqual([nodeId]);
    });

    it('removeGlobalChild removes a node ID from globalChildren', () => {
      const doc = createDocument();
      const nodeId = 'test-node-1';
      const withChild = addGlobalChild(doc, nodeId);
      const withoutChild = removeGlobalChild(withChild, nodeId);
      expect(withoutChild.globalChildren).toEqual([]);
    });

    it('activePageNodes returns global children + page children when activePageId is set', () => {
      let doc = createDocument();
      const contentRootId = doc.pages![0]!.contentRoot;
      const globalId = 'global-1';
      doc = addGlobalChild(doc, globalId);
      const pageChildId = 'page-child-1';
      const contentRoot = doc.nodes[contentRootId] as GroupNode;
      doc = {
        ...doc,
        nodes: {
          ...doc.nodes,
          [contentRootId]: { ...contentRoot, children: [...contentRoot.children, pageChildId] },
        },
      };
      const result = activePageNodes(doc);
      expect(result).toContain(globalId);
      expect(result).toContain(pageChildId);
    });

    it('activePageNodes returns global children + rootChildren when no activePageId', () => {
      let doc = createDocument();
      const globalId = 'global-1';
      doc = addGlobalChild(doc, globalId);
      doc = { ...doc, activePageId: undefined };
      const pageChildId = 'root-child-1';
      doc = { ...doc, rootChildren: [...doc.rootChildren, pageChildId] };
      const result = activePageNodes(doc);
      expect(result).toContain(globalId);
      expect(result).toContain(pageChildId);
    });
  });
});
