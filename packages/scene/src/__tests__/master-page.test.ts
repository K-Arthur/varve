/**
 * Tests for master page, spread, and page numbering operations (v2.0+).
 *
 * Every operation is called on a page-based Document created via
 * `createDocument()` (no args = page-based, backward-compatible default).
 */

import type { Affine } from '@strata/engine';
import { describe, expect, it } from 'vitest';
import {
  addChild,
  addMasterOverride,
  addPage,
  assignMasterToPage,
  createDocument,
  createMaster,
  deleteMaster,
  duplicateMaster,
  getFormattedPageNumber,
  getPageNumber,
  getPageSide,
  getSpreadForPage,
  isPageOnLeftSide,
  makeShapeNode,
  nextNodeId,
  rebuildSpreads,
  removeMasterOverride,
  renameMaster,
  reorderMasters,
  resetMasterOverrides,
  setMasterAppliesTo,
  setPageSizeWithContentScale,
} from '../document';
import type { GroupNode, MasterPage, Page, PageSection } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function firstPage(doc: ReturnType<typeof createDocument>): Page {
  return doc.pages?.[0] as Page;
}

function firstMaster(doc: ReturnType<typeof createDocument>): MasterPage {
  const masters = doc.masters as Record<string, MasterPage>;
  return Object.values(masters)[0] as MasterPage;
}

function getMasters(doc: ReturnType<typeof createDocument>): MasterPage[] {
  return Object.values(doc.masters ?? {});
}

function addShapeToPage(
  doc: ReturnType<typeof createDocument>,
  pageId: string,
  shape: ReturnType<typeof makeShapeNode>,
): ReturnType<typeof createDocument> {
  const page = doc.pages?.find((p) => p.id === pageId) as Page;
  return addChild(doc, page.contentRoot, shape);
}

// ── 1. Master Page CRUD ──────────────────────────────────────────────────────

describe('Master Page CRUD', () => {
  describe('createMaster', () => {
    it('creates a master with correct defaults', () => {
      const doc = createDocument();
      const result = createMaster(doc, {
        name: 'Grid Master',
        width: 1920,
        height: 1080,
      });

      const masters = getMasters(result);
      expect(masters.length).toBe(1);
      const master = masters[0]!;
      expect(master.name).toBe('Grid Master');
      expect(master.width).toBe(1920);
      expect(master.height).toBe(1080);
      expect(master.appliesTo).toBe('all');
      expect(master.id).toBeDefined();
      expect(master.contentRoot).toBeDefined();
    });

    it('creates a master with a custom appliesTo', () => {
      const doc = createDocument();
      const result = createMaster(doc, {
        name: 'Left Master',
        width: 1920,
        height: 1080,
        appliesTo: 'left',
      });

      const master = firstMaster(result);
      expect(master.appliesTo).toBe('left');
    });

    it('adds contentRoot to rootChildren and nodes', () => {
      const doc = createDocument();
      const originalRootCount = doc.rootChildren.length;

      const result = createMaster(doc, {
        name: 'Test Master',
        width: 1920,
        height: 1080,
      });

      const master = firstMaster(result);
      // ContentRoot should be added to rootChildren
      expect(result.rootChildren).toContain(master.contentRoot);
      // There should be one more root child
      expect(result.rootChildren.length).toBe(originalRootCount + 1);
      // ContentRoot node should exist in nodes
      const contentRoot = result.nodes[master.contentRoot] as GroupNode | undefined;
      expect(contentRoot).toBeDefined();
      expect(contentRoot?.kind).toBe('group');
      expect(contentRoot?.name).toBe('Test Master content');
    });
  });

  describe('deleteMaster', () => {
    it('removes master contentRoot and clears assignments', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'To Delete', width: 1920, height: 1080 });
      const masterId = firstMaster(doc).id;
      const contentRootId = firstMaster(doc).contentRoot;

      // Assign a page to this master
      const page = firstPage(doc);
      doc = assignMasterToPage(doc, page.id, masterId);
      expect(doc.pages?.[0]?.masterPageId).toBe(masterId);

      // Delete the master
      const result = deleteMaster(doc, masterId);

      // Master should be removed
      expect(result.masters?.[masterId]).toBeUndefined();
      // ContentRoot node should be removed
      expect(result.nodes[contentRootId]).toBeUndefined();
      // ContentRoot should not be in rootChildren
      expect(result.rootChildren).not.toContain(contentRootId);
      // Page assignment should be cleared
      expect(result.pages?.[0]?.masterPageId).toBeUndefined();
      expect(result.pages?.[0]?.masterOverrides).toBeUndefined();
    });

    it('no-ops for unknown master id', () => {
      const doc = createDocument();
      const result = deleteMaster(doc, 'nonexistent-master');
      expect(result).toBe(doc);
    });
  });

  describe('renameMaster', () => {
    it('updates name', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'Old Name', width: 1920, height: 1080 });
      const masterId = firstMaster(doc).id;

      const result = renameMaster(doc, masterId, 'New Name');
      expect(result.masters?.[masterId]?.name).toBe('New Name');
      expect(result).not.toBe(doc);
    });

    it('no-ops on empty string', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'Test', width: 1920, height: 1080 });
      const masterId = firstMaster(doc).id;

      const result = renameMaster(doc, masterId, '');
      expect(result).toBe(doc);
    });

    it('no-ops on whitespace-only string', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'Test', width: 1920, height: 1080 });
      const masterId = firstMaster(doc).id;

      const result = renameMaster(doc, masterId, '   ');
      expect(result).toBe(doc);
    });
  });

  describe('duplicateMaster', () => {
    it('deep-copies contentRoot with new IDs', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'Original', width: 1920, height: 1080 });
      const masterId = firstMaster(doc).id;
      const originalContentRootId = firstMaster(doc).contentRoot;

      // Add a child shape to the master's contentRoot
      const { id: childId, doc: d2 } = nextNodeId(doc);
      doc = d2;
      const shape = makeShapeNode(childId, { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
      doc = addChild(doc, originalContentRootId, shape);

      // Duplicate
      const result = duplicateMaster(doc, masterId);
      const masters = getMasters(result);
      expect(masters.length).toBe(2);

      const _original = result.masters?.[masterId] as MasterPage;
      const duplicate = masters.find((m) => m.id !== masterId) as MasterPage;

      // Duplicate should have a new ID and new contentRoot
      expect(duplicate.id).not.toBe(masterId);
      expect(duplicate.contentRoot).not.toBe(originalContentRootId);
      expect(duplicate.name).toBe('Original Copy');

      // Original contentRoot and child should still exist
      expect(result.nodes[originalContentRootId]).toBeDefined();
      expect(result.nodes[childId]).toBeDefined();

      // Duplicate contentRoot should have a child with a new ID
      const dupContentRoot = result.nodes[duplicate.contentRoot] as GroupNode;
      expect(dupContentRoot).toBeDefined();
      expect(dupContentRoot.children.length).toBe(1);
      expect(dupContentRoot.children[0]).not.toBe(childId);
      expect(result.nodes[dupContentRoot.children[0]!]).toBeDefined();
    });

    it('no-ops for unknown master id', () => {
      const doc = createDocument();
      const result = duplicateMaster(doc, 'nonexistent');
      expect(result).toBe(doc);
    });
  });

  describe('reorderMasters', () => {
    it('preserves all masters in given order', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'A', width: 1920, height: 1080 });
      doc = createMaster(doc, { name: 'B', width: 1920, height: 1080 });
      doc = createMaster(doc, { name: 'C', width: 1920, height: 1080 });

      const masters = getMasters(doc);
      const originalOrder = masters.map((m) => m.name);
      expect(originalOrder).toEqual(['A', 'B', 'C']);

      // Reverse order using IDs
      const reversedIds = masters.map((m) => m.id).reverse();
      const result = reorderMasters(doc, reversedIds);

      const reorderedMasters = getMasters(result);
      expect(reorderedMasters.map((m) => m.name)).toEqual(['C', 'B', 'A']);
    });

    it('no-ops on length mismatch', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'A', width: 1920, height: 1080 });
      doc = createMaster(doc, { name: 'B', width: 1920, height: 1080 });

      const masterIds = getMasters(doc).map((m) => m.id);
      const result = reorderMasters(doc, [masterIds[0]!]);
      expect(result).toBe(doc);
    });

    it('no-ops when any id is not a master', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'A', width: 1920, height: 1080 });
      doc = createMaster(doc, { name: 'B', width: 1920, height: 1080 });

      const masterIds = getMasters(doc).map((m) => m.id);
      const result = reorderMasters(doc, [...masterIds, 'fake-id']);
      expect(result).toBe(doc);
    });
  });
});

// ── 2. Master Assignment ──────────────────────────────────────────────────────

describe('Master Assignment', () => {
  describe('assignMasterToPage', () => {
    it('sets masterPageId on the page', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'Test Master', width: 1920, height: 1080 });
      const masterId = firstMaster(doc).id;
      const page = firstPage(doc);

      const result = assignMasterToPage(doc, page.id, masterId);
      expect(result.pages?.[0]?.masterPageId).toBe(masterId);
      expect(result).not.toBe(doc);
    });

    it('with null clears masterPageId and overrides', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'Test Master', width: 1920, height: 1080 });
      const masterId = firstMaster(doc).id;
      const page = firstPage(doc);

      // Assign then clear
      doc = assignMasterToPage(doc, page.id, masterId);
      const result = assignMasterToPage(doc, page.id, null);

      expect(result.pages?.[0]?.masterPageId).toBeUndefined();
      expect(result.pages?.[0]?.masterOverrides).toBeUndefined();
    });

    it('no-ops for unknown master', () => {
      const doc = createDocument();
      const page = firstPage(doc);

      const result = assignMasterToPage(doc, page.id, 'nonexistent-master');
      expect(result).toBe(doc);
    });

    it('no-ops for unknown page', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'Test', width: 1920, height: 1080 });
      const masterId = firstMaster(doc).id;

      const result = assignMasterToPage(doc, 'nonexistent-page', masterId);
      expect(result).toBe(doc);
    });
  });

  describe('setMasterAppliesTo', () => {
    it('updates appliesTo field', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'Test', width: 1920, height: 1080 });
      const masterId = firstMaster(doc).id;

      const result = setMasterAppliesTo(doc, masterId, 'right');
      expect(result.masters?.[masterId]?.appliesTo).toBe('right');
    });

    it('no-ops for unknown master', () => {
      const doc = createDocument();
      const result = setMasterAppliesTo(doc, 'nonexistent', 'left');
      expect(result).toBe(doc);
    });
  });
});

// ── 3. Master Overrides ───────────────────────────────────────────────────────

describe('Master Overrides', () => {
  describe('addMasterOverride', () => {
    it('creates a modified override with localNodeId', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'Test', width: 1920, height: 1080 });
      const master = firstMaster(doc);
      const page = firstPage(doc);

      // Assign master to page
      doc = assignMasterToPage(doc, page.id, master.id);

      // Add a 'modified' override
      const localId = 'local-copy-1';
      const result = addMasterOverride(doc, page.id, master.contentRoot, 'modified', localId);

      const overrides = result.pages?.[0]?.masterOverrides;
      expect(overrides?.[master.contentRoot]).toBeDefined();
      expect(overrides?.[master.contentRoot]?.type).toBe('modified');
      expect(overrides?.[master.contentRoot]?.localNodeId).toBe(localId);
      expect(overrides?.[master.contentRoot]?.masterNodeId).toBe(master.contentRoot);
    });

    it('creates a hidden override', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'Test', width: 1920, height: 1080 });
      const master = firstMaster(doc);
      const page = firstPage(doc);

      doc = assignMasterToPage(doc, page.id, master.id);
      const result = addMasterOverride(doc, page.id, master.contentRoot, 'hidden');

      const overrides = result.pages?.[0]?.masterOverrides;
      expect(overrides?.[master.contentRoot]?.type).toBe('hidden');
      expect(overrides?.[master.contentRoot]?.localNodeId).toBeUndefined();
    });

    it('rejects modified without localNodeId', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'Test', width: 1920, height: 1080 });
      const master = firstMaster(doc);
      const page = firstPage(doc);

      doc = assignMasterToPage(doc, page.id, master.id);
      // Saving result to verify it's unchanged
      const before = doc;
      const result = addMasterOverride(doc, page.id, master.contentRoot, 'modified');

      // Without localNodeId, modified override should be rejected
      expect(result.pages?.[0]?.masterOverrides?.[master.contentRoot]).toBeUndefined();
      // Document should be unchanged
      expect(result).toBe(before);
    });
  });

  describe('removeMasterOverride', () => {
    it('removes a specific override', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'Test', width: 1920, height: 1080 });
      const master = firstMaster(doc);
      const page = firstPage(doc);

      doc = assignMasterToPage(doc, page.id, master.id);
      doc = addMasterOverride(doc, page.id, master.contentRoot, 'hidden');

      // Verify it exists
      expect(doc.pages?.[0]?.masterOverrides?.[master.contentRoot]).toBeDefined();

      // Remove it
      const result = removeMasterOverride(doc, page.id, master.contentRoot);
      expect(result.pages?.[0]?.masterOverrides?.[master.contentRoot]).toBeUndefined();
    });

    it('no-ops for unknown masterNodeId', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'Test', width: 1920, height: 1080 });
      const page = firstPage(doc);

      const result = removeMasterOverride(doc, page.id, 'nonexistent-node');
      // Should have no masterOverrides (was already undefined)
      expect(result.pages?.[0]?.masterOverrides).toBeUndefined();
    });

    it('cleans up masterOverrides map when empty', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'Test', width: 1920, height: 1080 });
      const master = firstMaster(doc);
      const page = firstPage(doc);

      doc = assignMasterToPage(doc, page.id, master.id);
      doc = addMasterOverride(doc, page.id, master.contentRoot, 'hidden');
      const result = removeMasterOverride(doc, page.id, master.contentRoot);

      // When all overrides are removed, the map should be undefined
      expect(result.pages?.[0]?.masterOverrides).toBeUndefined();
    });
  });

  describe('resetMasterOverrides', () => {
    it('clears all overrides', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'Test', width: 1920, height: 1080 });
      const master = firstMaster(doc);
      const page = firstPage(doc);

      doc = assignMasterToPage(doc, page.id, master.id);
      doc = addMasterOverride(doc, page.id, master.contentRoot, 'hidden');
      doc = addMasterOverride(doc, page.id, 'some-other-node', 'hidden');

      const result = resetMasterOverrides(doc, page.id);
      expect(result.pages?.[0]?.masterOverrides).toBeUndefined();
    });

    it('no-ops for unknown page', () => {
      const doc = createDocument();
      const result = resetMasterOverrides(doc, 'nonexistent');
      expect(result).toBe(doc);
    });
  });

  describe('multiple overrides', () => {
    it('multiple overrides on same page work correctly', () => {
      let doc = createDocument();
      doc = createMaster(doc, { name: 'Test', width: 1920, height: 1080 });
      const master = firstMaster(doc);
      const page = firstPage(doc);

      doc = assignMasterToPage(doc, page.id, master.id);

      // Add two overrides
      doc = addMasterOverride(doc, page.id, 'node-a', 'hidden');
      doc = addMasterOverride(doc, page.id, 'node-b', 'modified', 'local-b');

      const overrides = doc.pages?.[0]?.masterOverrides;
      expect(overrides).toBeDefined();
      expect(Object.keys(overrides!).length).toBe(2);
      expect(overrides!['node-a']?.type).toBe('hidden');
      expect(overrides!['node-b']?.type).toBe('modified');
      expect(overrides!['node-b']?.localNodeId).toBe('local-b');

      // Remove one override
      const afterRemove = removeMasterOverride(doc, page.id, 'node-a');
      const remaining = afterRemove.pages?.[0]?.masterOverrides;
      expect(Object.keys(remaining!).length).toBe(1);
      expect(remaining!['node-b']).toBeDefined();

      // Reset all
      const afterReset = resetMasterOverrides(afterRemove, page.id);
      expect(afterReset.pages?.[0]?.masterOverrides).toBeUndefined();
    });
  });
});

// ── 4. Spread Reconstruction ──────────────────────────────────────────────────

describe('Spread Reconstruction', () => {
  describe('rebuildSpreads', () => {
    it('with facing pages disabled creates one spread per page', () => {
      let doc = createDocument();
      doc = addPage(doc);
      doc = addPage(doc);
      doc = addPage(doc);
      expect(doc.pages?.length).toBe(4);

      const result = rebuildSpreads(doc, { enabled: false, startOnRight: true });
      expect(result.spreads?.length).toBe(4);
      for (const spread of result.spreads ?? []) {
        expect(spread.pageIds.length).toBe(1);
      }
    });

    it('with facing pages enabled creates pairs', () => {
      let doc = createDocument();
      doc = addPage(doc);
      doc = addPage(doc);
      doc = addPage(doc);
      expect(doc.pages?.length).toBe(4);

      const result = rebuildSpreads(doc, { enabled: true, startOnRight: false });
      // 4 pages / 2 = 2 spreads
      expect(result.spreads?.length).toBe(2);
      for (const spread of result.spreads ?? []) {
        expect(spread.pageIds.length).toBe(2);
      }
    });

    it('with startOnRight puts first page alone', () => {
      let doc = createDocument();
      doc = addPage(doc);
      doc = addPage(doc);
      doc = addPage(doc);
      expect(doc.pages?.length).toBe(4);

      const result = rebuildSpreads(doc, { enabled: true, startOnRight: true });
      // First page alone, then pairs: 4 pages → [1] + [2,3] + [4]?? no wait
      // startOnRight means first page is on the right, so:
      // [page1] alone, then [page2, page3], then [page4]
      // 4 pages → 3 spreads with startOnRight
      expect(result.spreads?.length).toBe(3);
      // First spread should have just one page
      expect(result.spreads?.[0]?.pageIds.length).toBe(1);
      // Second spread should be a pair
      expect(result.spreads?.[1]?.pageIds.length).toBe(2);
    });

    it('with odd page count leaves last page unpaired', () => {
      let doc = createDocument();
      doc = addPage(doc);
      doc = addPage(doc);
      expect(doc.pages?.length).toBe(3);

      // facing pages, startOnRight=false: [page1, page2] + [page3]
      const result = rebuildSpreads(doc, { enabled: true, startOnRight: false });
      expect(result.spreads?.length).toBe(2);
      expect(result.spreads?.[0]?.pageIds.length).toBe(2);
      expect(result.spreads?.[1]?.pageIds.length).toBe(1);
    });

    it('with startOnRight and odd count: first alone then paired then last alone', () => {
      let doc = createDocument();
      doc = addPage(doc);
      doc = addPage(doc);
      doc = addPage(doc);
      doc = addPage(doc);
      expect(doc.pages?.length).toBe(5);

      // 5 pages, startOnRight=true: [1] + [2,3] + [4,5]
      const result = rebuildSpreads(doc, { enabled: true, startOnRight: true });
      expect(result.spreads?.length).toBe(3);
      expect(result.spreads?.[0]?.pageIds.length).toBe(1);
      expect(result.spreads?.[1]?.pageIds.length).toBe(2);
      expect(result.spreads?.[2]?.pageIds.length).toBe(2);
    });
  });

  describe('getSpreadForPage', () => {
    it('returns correct spread', () => {
      let doc = createDocument();
      doc = addPage(doc);
      doc = rebuildSpreads(doc, { enabled: false, startOnRight: true });

      const page = firstPage(doc);
      const spread = getSpreadForPage(doc, page.id);
      expect(spread).toBeDefined();
      expect(spread?.pageIds).toContain(page.id);
    });

    it('returns undefined for unknown page', () => {
      let doc = createDocument();
      doc = rebuildSpreads(doc, { enabled: false, startOnRight: true });

      const spread = getSpreadForPage(doc, 'nonexistent');
      expect(spread).toBeUndefined();
    });
  });

  describe('getPageSide', () => {
    it('returns right for first page when startOnRight', () => {
      let doc = createDocument();
      doc = addPage(doc);
      doc = rebuildSpreads(doc, { enabled: true, startOnRight: true });

      const page0 = doc.pages?.[0] as Page;
      const side = getPageSide(doc, page0.id, { enabled: true, startOnRight: true });
      expect(side).toBe('right');
    });

    it('returns left for first page when startOnRight is false', () => {
      let doc = createDocument();
      doc = addPage(doc);
      doc = rebuildSpreads(doc, { enabled: true, startOnRight: false });

      const page0 = doc.pages?.[0] as Page;
      const side = getPageSide(doc, page0.id, { enabled: true, startOnRight: false });
      expect(side).toBe('left');
    });

    it('classifies pages in a two-page spread correctly', () => {
      let doc = createDocument();
      doc = addPage(doc);
      doc = rebuildSpreads(doc, { enabled: true, startOnRight: false });

      const page0 = doc.pages?.[0] as Page;
      const page1 = doc.pages?.[1] as Page;
      expect(getPageSide(doc, page0.id, { enabled: true, startOnRight: false })).toBe('left');
      expect(getPageSide(doc, page1.id, { enabled: true, startOnRight: false })).toBe('right');
    });
  });

  describe('isPageOnLeftSide', () => {
    it('returns true for left-side pages', () => {
      let doc = createDocument();
      doc = addPage(doc);
      doc = rebuildSpreads(doc, { enabled: true, startOnRight: false });

      const page0 = doc.pages?.[0] as Page;
      expect(isPageOnLeftSide(doc, page0.id)).toBe(true);
    });

    it('returns false for right-side pages', () => {
      let doc = createDocument();
      doc = addPage(doc);
      doc = rebuildSpreads(doc, { enabled: true, startOnRight: true });

      const page0 = doc.pages?.[0] as Page;
      expect(isPageOnLeftSide(doc, page0.id)).toBe(false);
    });

    it('uses doc.facingPages config when no explicit config', () => {
      let doc = createDocument();
      doc = addPage(doc);
      doc = rebuildSpreads(doc);

      // Default facing pages config: { enabled: false, startOnRight: true }
      // With single-page spreads, isPageOnLeftSide returns false (because
      // single-page spreads return right when startOnRight is true)
      const page0 = doc.pages?.[0] as Page;
      expect(isPageOnLeftSide(doc, page0.id)).toBe(false);
    });
  });
});

// ── 5. Page Numbering ─────────────────────────────────────────────────────────

describe('Page Numbering', () => {
  describe('getPageNumber', () => {
    it('without sections returns simple 1-indexed', () => {
      let doc = createDocument();
      doc = addPage(doc);
      doc = addPage(doc);

      const pages = doc.pages ?? [];
      expect(getPageNumber(doc, pages[0]!.id)).toBe(1);
      expect(getPageNumber(doc, pages[1]!.id)).toBe(2);
      expect(getPageNumber(doc, pages[2]!.id)).toBe(3);
    });

    it('with section returns section-relative', () => {
      let doc = createDocument();
      doc = addPage(doc);
      doc = addPage(doc);
      const pages = doc.pages ?? [];
      const secondPage = pages[1]!;

      const section: PageSection = {
        id: 'section-1',
        name: 'Body',
        startPageOrder: secondPage.order,
        numberStyle: 'decimal',
        startNumber: 1,
        showPageNumber: true,
      };

      doc = { ...doc, sections: [section] };
      expect(getPageNumber(doc, pages[0]!.id)).toBe(1);
      expect(getPageNumber(doc, pages[1]!.id)).toBe(1);
      expect(getPageNumber(doc, pages[2]!.id)).toBe(2);
    });

    it('returns 0 for unknown page', () => {
      const doc = createDocument();
      expect(getPageNumber(doc, 'nonexistent')).toBe(0);
    });

    it('respects section startNumber offset', () => {
      let doc = createDocument();
      doc = addPage(doc);
      doc = addPage(doc);
      const pages = doc.pages ?? [];
      const secondPage = pages[1]!;

      const section: PageSection = {
        id: 'section-1',
        name: 'Body',
        startPageOrder: secondPage.order,
        numberStyle: 'decimal',
        startNumber: 5,
        showPageNumber: true,
      };

      doc = { ...doc, sections: [section] };
      expect(getPageNumber(doc, pages[0]!.id)).toBe(1);
      expect(getPageNumber(doc, pages[1]!.id)).toBe(5);
      expect(getPageNumber(doc, pages[2]!.id)).toBe(6);
    });
  });

  describe('getFormattedPageNumber', () => {
    it('returns decimal by default', () => {
      let doc = createDocument();
      doc = addPage(doc);
      const pages = doc.pages ?? [];

      expect(getFormattedPageNumber(doc, pages[0]!.id)).toBe('1');
      expect(getFormattedPageNumber(doc, pages[1]!.id)).toBe('2');
    });

    it('with upperRoman section returns Roman numerals', () => {
      let doc = createDocument();
      doc = addPage(doc);
      doc = addPage(doc);
      const pages = doc.pages ?? [];
      const firstPage = pages[0]!;

      const section: PageSection = {
        id: 'section-1',
        name: 'Front',
        startPageOrder: firstPage.order,
        numberStyle: 'upperRoman',
        startNumber: 1,
        showPageNumber: true,
      };

      doc = { ...doc, sections: [section] };
      expect(getFormattedPageNumber(doc, pages[0]!.id)).toBe('I');
      expect(getFormattedPageNumber(doc, pages[1]!.id)).toBe('II');
      expect(getFormattedPageNumber(doc, pages[2]!.id)).toBe('III');
    });

    it('with lowerRoman section returns lowercase Roman numerals', () => {
      let doc = createDocument();
      doc = addPage(doc);
      const pages = doc.pages ?? [];
      const firstPage = pages[0]!;

      const section: PageSection = {
        id: 'section-1',
        name: 'Front',
        startPageOrder: firstPage.order,
        numberStyle: 'lowerRoman',
        startNumber: 1,
        showPageNumber: true,
      };

      doc = { ...doc, sections: [section] };
      expect(getFormattedPageNumber(doc, pages[0]!.id)).toBe('i');
      expect(getFormattedPageNumber(doc, pages[1]!.id)).toBe('ii');
    });

    it('with prefix includes prefix', () => {
      let doc = createDocument();
      doc = addPage(doc);
      const pages = doc.pages ?? [];
      const firstPage = pages[0]!;

      const section: PageSection = {
        id: 'section-1',
        name: 'Appendix',
        startPageOrder: firstPage.order,
        numberStyle: 'decimal',
        startNumber: 1,
        showPageNumber: true,
        prefix: 'A-',
      };

      doc = { ...doc, sections: [section] };
      expect(getFormattedPageNumber(doc, pages[0]!.id)).toBe('A-1');
      expect(getFormattedPageNumber(doc, pages[1]!.id)).toBe('A-2');
    });

    it('with showPageNumber=false returns empty string', () => {
      let doc = createDocument();
      doc = addPage(doc);
      const pages = doc.pages ?? [];
      const firstPage = pages[0]!;

      const section: PageSection = {
        id: 'section-1',
        name: 'Cover',
        startPageOrder: firstPage.order,
        numberStyle: 'decimal',
        startNumber: 1,
        showPageNumber: false,
      };

      doc = { ...doc, sections: [section] };
      expect(getFormattedPageNumber(doc, pages[0]!.id)).toBe('');
    });

    it('returns empty string for unknown page', () => {
      const doc = createDocument();
      expect(getFormattedPageNumber(doc, 'nonexistent')).toBe('');
    });

    it('with upperAlpha style', () => {
      let doc = createDocument();
      doc = addPage(doc);
      const pages = doc.pages ?? [];
      const firstPage = pages[0]!;

      const section: PageSection = {
        id: 'section-1',
        name: 'Alpha',
        startPageOrder: firstPage.order,
        numberStyle: 'upperAlpha',
        startNumber: 1,
        showPageNumber: true,
      };

      doc = { ...doc, sections: [section] };
      expect(getFormattedPageNumber(doc, pages[0]!.id)).toBe('A');
      expect(getFormattedPageNumber(doc, pages[1]!.id)).toBe('B');
    });

    it('with lowerAlpha style', () => {
      let doc = createDocument();
      doc = addPage(doc);
      const pages = doc.pages ?? [];
      const firstPage = pages[0]!;

      const section: PageSection = {
        id: 'section-1',
        name: 'Alpha',
        startPageOrder: firstPage.order,
        numberStyle: 'lowerAlpha',
        startNumber: 1,
        showPageNumber: true,
      };

      doc = { ...doc, sections: [section] };
      expect(getFormattedPageNumber(doc, pages[0]!.id)).toBe('a');
      expect(getFormattedPageNumber(doc, pages[1]!.id)).toBe('b');
    });
  });
});

// ── 6. Content Scale ──────────────────────────────────────────────────────────

describe('Content Scale', () => {
  describe('setPageSizeWithContentScale', () => {
    it('scales content transforms proportionally', () => {
      let doc = createDocument();
      const page = firstPage(doc);

      // Add a shape with a non-identity transform to the page content
      const { id: childId, doc: d2 } = nextNodeId(doc);
      doc = d2;
      const shape = makeShapeNode(
        childId,
        {
          kind: 'rect',
          x: 0,
          y: 0,
          w: 100,
          h: 100,
        },
        {
          transform: [2, 0, 0, 3, 50, 100] as unknown as Affine,
        },
      );
      doc = addShapeToPage(doc, page.id, shape);

      // Resize from 1920x1080 to 960x540 (scale 0.5x)
      const result = setPageSizeWithContentScale(doc, page.id, 960, 540);

      // Page dimensions should be updated
      expect(result.pages?.[0]?.width).toBe(960);
      expect(result.pages?.[0]?.height).toBe(540);

      // Shape transform should be scaled proportionally
      const child = result.nodes[childId] as { transform?: Affine };
      expect(child.transform).toBeDefined();
      const t = child.transform!;
      expect(t[0]).toBeCloseTo(1); // 2 * 0.5
      expect(t[1]).toBeCloseTo(0);
      expect(t[2]).toBeCloseTo(0);
      expect(t[3]).toBeCloseTo(1.5); // 3 * 0.5
      expect(t[4]).toBeCloseTo(25); // 50 * 0.5
      expect(t[5]).toBeCloseTo(50); // 100 * 0.5
    });

    it('no-ops on same dimensions', () => {
      const doc = createDocument();
      const page = firstPage(doc);

      const result = setPageSizeWithContentScale(doc, page.id, 1920, 1080);
      expect(result).toBe(doc);
    });

    it('preserves shapes with default transform', () => {
      let doc = createDocument();
      const page = firstPage(doc);

      // Add a shape with default identity transform
      const { id: childId, doc: d2 } = nextNodeId(doc);
      doc = d2;
      const shape = makeShapeNode(childId, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
      doc = addShapeToPage(doc, page.id, shape);

      const result = setPageSizeWithContentScale(doc, page.id, 960, 540);

      // Default transform [1,0,0,1,0,0] scaled by 0.5
      const child = result.nodes[childId] as { transform?: Affine };
      const t = child.transform!;
      expect(t[0]).toBeCloseTo(0.5);
      expect(t[1]).toBeCloseTo(0);
      expect(t[2]).toBeCloseTo(0);
      expect(t[3]).toBeCloseTo(0.5);
      expect(t[4]).toBeCloseTo(0);
      expect(t[5]).toBeCloseTo(0);
    });

    it('no-ops for unknown page', () => {
      const doc = createDocument();
      const result = setPageSizeWithContentScale(doc, 'nonexistent', 800, 600);
      expect(result).toBe(doc);
    });
  });
});
