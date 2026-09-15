import { describe, expect, it } from 'vitest';
import {
  activePageNodes,
  addChild,
  addGlobalChild,
  addPage,
  createDocument,
  makeShapeNode,
  migrateToPages,
  nextNodeId,
  removePage,
  setActivePage,
} from '../document';
import type { GroupNode, Page } from '../types';

function pageAt(doc: ReturnType<typeof createDocument>, index: number): Page {
  const page = doc.pages?.[index];
  if (!page) throw new Error(`Expected page at index ${index}`);
  return page;
}

describe('Page model hygiene', () => {
  describe('createDocument flat parameter', () => {
    it('createDocument(true) creates flat document with no pages', () => {
      const doc = createDocument('test', true);
      expect(doc.pages).toBeUndefined();
      expect(doc.activePageId).toBeUndefined();
      expect(doc.rootChildren).toEqual([]);
      expect(doc.nodes).toEqual({});
    });

    it('createDocument(false) creates page-based document', () => {
      const doc = createDocument('test', false);
      expect(doc.pages).toBeDefined();
      expect(doc.pages?.length).toBe(1);
      expect(doc.pages?.[0]?.name).toBe('Page 1');
    });

    it('createDocument() without args defaults to page-based (backward compat)', () => {
      const doc = createDocument();
      expect(doc.pages).toBeDefined();
      expect(doc.pages?.length).toBe(1);
      const page = doc.pages?.[0] as Page;
      expect(page.name).toBe('Page 1');
      expect(page.contentRoot).toBeDefined();
    });
  });

  describe('activePageId points to Page.id', () => {
    it('activePageId is the Page.id, not the contentRoot GroupNode id', () => {
      const doc = createDocument('test', false);
      const page = doc.pages?.[0] as Page;
      expect(doc.activePageId).toBe(page.id);
      expect(doc.activePageId).not.toBe(page.contentRoot);
    });

    it('activePageNodes resolves via Page.id correctly', () => {
      let doc = createDocument('test', false);
      const page = doc.pages?.[0] as Page;
      const contentRootId = page.contentRoot;

      const globalId = 'global-1';
      doc = addGlobalChild(doc, globalId);

      const { id: childId, doc: d2 } = nextNodeId(doc);
      doc = d2;
      const shape = makeShapeNode(childId, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
      doc = addChild(doc, contentRootId, shape);

      const result = activePageNodes(doc);
      expect(result).toContain(globalId);
      expect(result).toContain(childId);
    });
  });

  describe('activePageNodes with flat vs page-based', () => {
    it('activePageNodes returns rootChildren for flat document', () => {
      let doc = createDocument('test', true);
      const { id: childId, doc: d2 } = nextNodeId(doc);
      doc = d2;
      doc = {
        ...doc,
        rootChildren: [childId],
        nodes: {
          ...doc.nodes,
          [childId]: makeShapeNode(childId, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
        },
      };

      const result = activePageNodes(doc);
      expect(result).toEqual([childId]);
    });

    it('activePageNodes returns globals + page content for page-based', () => {
      let doc = createDocument('test', false);
      const page = doc.pages?.[0] as Page;
      const contentRootId = page.contentRoot;

      const globalId = 'global-1';
      doc = addGlobalChild(doc, globalId);

      const { id: childId, doc: d2 } = nextNodeId(doc);
      doc = d2;
      const shape = makeShapeNode(childId, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
      doc = addChild(doc, contentRootId, shape);

      const result = activePageNodes(doc);
      expect(result).toContain(globalId);
      expect(result).toContain(childId);
      // Globals come first
      expect(result.indexOf(globalId)).toBeLessThan(result.indexOf(childId));
    });
  });

  describe('migrateToPages backward compat', () => {
    it('migrateToPages wraps flat document into page-based with proper activePageId', () => {
      let doc = createDocument('test', true);
      const { id: childId, doc: d2 } = nextNodeId(doc);
      doc = d2;
      const shape = makeShapeNode(childId, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
      doc = {
        ...doc,
        rootChildren: [childId],
        nodes: { ...doc.nodes, [childId]: shape },
      };

      const migrated = migrateToPages(doc);
      expect(migrated.pages).toBeDefined();
      expect(migrated.pages?.length).toBe(1);
      const page = migrated.pages?.[0] as Page;
      // activePageId should be the Page.id, not the contentRoot
      expect(migrated.activePageId).toBe(page.id);
      expect(migrated.rootChildren).toEqual([page.contentRoot]);
      const contentRoot = migrated.nodes[page.contentRoot] as GroupNode;
      expect(contentRoot.children).toEqual([childId]);
    });

    it('migrateToPages is idempotent on already-migrated doc', () => {
      const doc = createDocument('test', false);
      const pagesCopy = [...doc.pages!];
      const result = migrateToPages(doc);
      expect(result).toBe(doc);
      expect(result.pages).toEqual(pagesCopy);
    });
  });

  describe('Page operations work with new activePageId scheme', () => {
    it('addPage creates page with proper ID', () => {
      let doc = createDocument('test', false);
      const firstPageId = doc.pages?.[0]?.id;
      doc = addPage(doc);
      expect(doc.pages?.length).toBe(2);
      const secondPage = doc.pages?.[1] as Page;
      expect(secondPage.id).toBeDefined();
      expect(secondPage.id).not.toBe(firstPageId);
      expect(secondPage.contentRoot).toBeDefined();
      expect(secondPage.contentRoot).not.toBe(firstPageId);
    });

    it('addPage on a flat document activates the first page', () => {
      // Documents created from Home are flat (no pages, no active page);
      // adding the first page must activate it so Fit-to-Page and the
      // page inspector work immediately.
      const doc = createDocument('test', true);
      const updated = addPage(doc);
      expect(updated.pages).toHaveLength(1);
      expect(updated.activePageId).toBe(updated.pages?.[0]?.id);
      // A later add keeps the current active page.
      const second = addPage(updated);
      expect(second.activePageId).toBe(updated.activePageId);
    });

    it('removePage works with new activePageId scheme', () => {
      let doc = createDocument('test', false);
      const pageOne = doc.pages?.[0] as Page;
      doc = addPage(doc);
      const pageTwo = doc.pages?.[1] as Page;
      // activePageId should still be pageOne.id
      expect(doc.activePageId).toBe(pageOne.id);

      // Remove pageTwo (not the active page)
      doc = removePage(doc, pageTwo.id);
      expect(doc.pages?.length).toBe(1);
      expect(doc.activePageId).toBe(pageOne.id);
      // pageTwo contentRoot should be gone
      expect(doc.nodes[pageTwo.contentRoot]).toBeUndefined();
    });

    it('removePage removes content root node from nodes', () => {
      let doc = createDocument('test', false);
      const page = doc.pages?.[0] as Page;
      const contentRootId = page.contentRoot;

      doc = addPage(doc);
      const secondPage = doc.pages?.[1] as Page;
      const secondPageId = secondPage.id;
      const secondContentRootId = secondPage.contentRoot;

      doc = removePage(doc, secondPageId);
      expect(doc.pages?.length).toBe(1);
      expect(doc.pages?.[0]?.id).toBe(page.id);
      expect(doc.nodes[secondContentRootId]).toBeUndefined();
      expect(doc.nodes[contentRootId]).toBeDefined();
    });

    it('removePage removes the last page, leaving a plain canvas', () => {
      // Pages are additive: a single-page document must not be a state the
      // user can enter but never leave. Zero pages is the flat-document shape
      // both activePageNodes and multipageRootNodes already handle.
      const doc = createDocument('test', false);
      const pageId = pageAt(doc, 0).id;
      const result = removePage(doc, pageId);
      expect(result.pages ?? []).toHaveLength(0);
      expect(result.activePageId).toBeUndefined();
    });

    it('setActivePage switches active page by Page.id', () => {
      let doc = createDocument('test', false);
      doc = addPage(doc);
      const secondPageId = pageAt(doc, 1).id;
      const updated = setActivePage(doc, secondPageId);
      expect(updated.activePageId).toBe(secondPageId);
      expect(updated).not.toBe(doc);
    });
  });

  describe('Editor integration', () => {
    it('newDocument creates a flat document (no pages) for new blank files', () => {
      // The editor uses createDocument('Untitled', true) for new files
      const doc = createDocument('Untitled', true);
      expect(doc.pages).toBeUndefined();
      expect(doc.activePageId).toBeUndefined();
      expect(doc.name).toBe('Untitled');
    });
  });
});
