/**
 * Multi-page layout baseline pins (2026-08-05, commit 1869cf10).
 *
 * These tests assert CURRENT behavior — including known defects that the
 * multi-page layout program must fix — so Milestones 2-4 have a measurable
 * before/after. See docs/audits/multipage-layout-audit-2026-08-05.md §16.
 *
 * Baseline defect pins (each will be inverted by a later milestone):
 * - B1: pages have no pasteboard placement; every content root sits at world
 *       origin, so all pages overlap (ADR-0124).
 * - B2: spread IDs are regenerated on every rebuild (ADR-0128).
 * - B3 (FIXED 2026-08-07, M8): hidden/deleted master overrides now remove
 *       the master node from activePageNodesWithMaster (ADR-0132 D2); the
 *       two tests below pin the corrected projection.
 * - B4: text flow splits by character count, not geometry (ADR-0137 D1).
 * - B5: duplicate page does not remap text-chain frame references (ADR-0126 D4).
 * - B6: page deletion silently removes content (ADR-0126 D3).
 */

import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import {
  activePageNodes,
  activePageNodesWithMaster,
  addChild,
  addMasterOverride,
  addPage,
  assignMasterToPage,
  createDocument,
  createMaster,
  duplicatePage,
  makeShapeNode,
  nextNodeId,
  rebuildSpreads,
  removePage,
  setPageSize,
} from '../document';
import { splitRichTextByCharLimit } from '../textFlow';
import type { GroupNode, Page } from '../types';

function firstPage(doc: Document): Page {
  const page = doc.pages?.[0];
  if (!page) throw new Error('no pages');
  return page;
}

function firstMaster(doc: Document) {
  const master = Object.values(doc.masters ?? {})[0];
  if (!master) throw new Error('no masters');
  return master;
}

function addShapeToPage(doc: Document, pageId: string): { doc: Document; nodeId: string } {
  const page = doc.pages?.find((p) => p.id === pageId);
  if (!page) throw new Error('no page');
  const { id: nodeId, doc: d1 } = nextNodeId(doc);
  const shape = makeShapeNode(nodeId, { kind: 'rect', x: 10, y: 10, w: 50, h: 50 });
  const d2 = addChild(d1, page.contentRoot, shape);
  return { doc: d2, nodeId };
}

// ── B1: page placement ────────────────────────────────────────────────────────

describe('Baseline B1 — page placement (no pasteboard placement today)', () => {
  it('pages carry no placement fields; content roots live at world origin', () => {
    let doc = createDocument();
    doc = addPage(doc);
    doc = addPage(doc);
    const pages = doc.pages!;
    expect(pages.length).toBe(3);

    for (const page of pages) {
      expect((page as Page & { placement?: unknown }).placement).toBeUndefined();
      const contentRoot = doc.nodes[page.contentRoot] as GroupNode;
      const transform = contentRoot.transform;
      expect(transform?.[4] ?? 0).toBe(0);
      expect(transform?.[5] ?? 0).toBe(0);
    }
  });

  it('all pages resolve to the same world origin (overlap)', () => {
    let doc = createDocument();
    doc = addPage(doc);
    doc = addPage(doc);
    const pages = doc.pages!;
    const origins = pages.map((p) => doc.nodes[p.contentRoot]);
    expect(origins[1]!.transform).toEqual(origins[0]!.transform);
  });
});

// ── B2: spread identity stability (inverted by M4) ────────────────────────────

describe('Baseline B2 — spread rebuild stability (FIXED by M4, ADR-0128)', () => {
  it('rebuildSpreads keeps spread ids stable across rebuilds', () => {
    let doc = createDocument();
    doc = addPage(doc);
    doc = addPage(doc);
    doc = addPage(doc);
    const a = rebuildSpreads(doc, { enabled: true, startOnRight: true });
    const b = rebuildSpreads(doc, { enabled: true, startOnRight: true });
    expect(a.spreads!.length).toBe(b.spreads!.length);
    expect(a.spreads![0]!.id).toBe(b.spreads![0]!.id);
  });

  it('toggle-facing-pages round trip preserves spread ids', () => {
    let doc = createDocument();
    doc = addPage(doc);
    doc = rebuildSpreads(doc, { enabled: true, startOnRight: false });
    const originalId = doc.spreads![0]!.id;
    doc = rebuildSpreads(doc, { enabled: false, startOnRight: false });
    doc = rebuildSpreads(doc, { enabled: true, startOnRight: false });
    expect(doc.spreads![0]!.id).toBe(originalId);
  });
});

// ── B3: hidden/deleted override projection defect ─────────────────────────────

describe('Baseline B3 — master override projection (defect pin)', () => {
  function masterWithChild(doc: Document): { doc: Document; masterChildId: string } {
    const master = firstMaster(doc);
    const masterRoot = doc.nodes[master.contentRoot] as GroupNode;
    const { id: nodeId, doc: d1 } = nextNodeId(doc);
    const shape = makeShapeNode(nodeId, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const d2 = addChild(d1, masterRoot.id, shape);
    return { doc: d2, masterChildId: nodeId };
  }

  it('hidden override removes the master node from the projection (B3 fixed)', () => {
    let doc = createDocument();
    doc = createMaster(doc, { name: 'M', width: 1920, height: 1080 });
    const page = firstPage(doc);
    doc = assignMasterToPage(doc, page.id, firstMaster(doc).id);
    const { doc: d1, masterChildId } = masterWithChild(doc);
    doc = d1;
    doc = addMasterOverride(doc, page.id, masterChildId, 'hidden');

    const projected = activePageNodesWithMaster(doc, page.id);
    expect(projected).not.toContain(masterChildId);
    expect(projected).not.toContain(page.contentRoot);
  });

  it('deleted override removes the master node from the projection (B3 fixed)', () => {
    let doc = createDocument();
    doc = createMaster(doc, { name: 'M', width: 1920, height: 1080 });
    const page = firstPage(doc);
    doc = assignMasterToPage(doc, page.id, firstMaster(doc).id);
    const { doc: d1, masterChildId } = masterWithChild(doc);
    doc = d1;
    doc = addMasterOverride(doc, page.id, masterChildId, 'deleted');

    const projected = activePageNodesWithMaster(doc, page.id);
    expect(projected).not.toContain(masterChildId);
  });

  it('modified override substitutes the local node', () => {
    let doc = createDocument();
    doc = createMaster(doc, { name: 'M', width: 1920, height: 1080 });
    const page = firstPage(doc);
    doc = assignMasterToPage(doc, page.id, firstMaster(doc).id);
    const { doc: d1, masterChildId } = masterWithChild(doc);
    doc = d1;
    doc = addMasterOverride(doc, page.id, masterChildId, 'modified', 'local-node-1');

    const projected = activePageNodesWithMaster(doc, page.id);
    expect(projected).toContain('local-node-1');
    expect(projected).not.toContain(masterChildId);
  });
});

// ── B4: character-count text flow ─────────────────────────────────────────────

describe('Baseline B4 — text flow splits by character count', () => {
  it('splitRichTextByCharLimit distributes by character count', () => {
    const rich = {
      paragraphs: [
        { runs: [{ text: 'Hello world, this is a long paragraph that will overflow.' }] },
      ],
    };
    const { fitted, overset } = splitRichTextByCharLimit(rich, 20);
    const fittedText = fitted.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('');
    const oversetText = overset.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('');
    expect(fittedText.length).toBe(20);
    expect(fittedText + oversetText).toBe(
      'Hello world, this is a long paragraph that will overflow.',
    );
  });

  it('overset detection has no geometry: char limit is the only input', () => {
    const rich = { paragraphs: [{ runs: [{ text: 'abc' }] }] };
    const { fitted } = splitRichTextByCharLimit(rich, 5);
    expect(fitted.paragraphs[0]!.runs[0]!.text).toBe('abc');
  });
});

// ── B5: duplicate page does not remap text chains ─────────────────────────────

describe('Baseline B5 — duplicate page leaves chain references stale', () => {
  it('text chains keep pointing at the original page frames (defect)', () => {
    let doc = createDocument();
    const page = firstPage(doc);
    const first = addShapeToPage(doc, page.id);
    doc = first.doc;
    const { id: frameId, doc: d1 } = nextNodeId(doc);
    const frame = makeShapeNode(frameId, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    doc = addChild(d1, page.contentRoot, frame);

    doc = {
      ...doc,
      textChains: {
        ...(doc.textChains ?? {}),
        'chain-1': { id: 'chain-1', name: 'Story', frameIds: [frameId] },
      },
    };

    const duplicated = duplicatePage(doc, page.id);
    const chain = duplicated.textChains?.['chain-1'] as { frameIds: string[] };
    expect(chain.frameIds).toEqual([frameId]);
    const duplicate = duplicated.pages![1]!;
    const duplicateRoot = duplicated.nodes[duplicate.contentRoot] as GroupNode;
    expect(duplicateRoot.children).not.toContain(frameId);
  });
});

// ── B6: page deletion silently removes content ────────────────────────────────

describe('Baseline B6 — delete page removes content silently', () => {
  it('removePage deletes the whole content subtree (no orphan policy)', () => {
    let doc = createDocument();
    doc = addPage(doc);
    const pageToDelete = doc.pages![1]!;
    const { doc: d1, nodeId } = addShapeToPage(doc, pageToDelete.id);
    doc = d1;
    const childCount = Object.keys(doc.nodes).length;

    const result = removePage(doc, pageToDelete.id);
    expect(result.pages!.length).toBe(1);
    expect(result.nodes[pageToDelete.contentRoot]).toBeUndefined();
    expect(result.nodes[nodeId]).toBeUndefined();
    expect(Object.keys(result.nodes).length).toBe(childCount - 2);
  });

  it('active page falls back to a surviving page', () => {
    let doc = createDocument();
    doc = addPage(doc);
    const deletedId = doc.activePageId;
    doc = setPageSize(doc, deletedId!, 100, 100);
    const result = removePage(doc, deletedId!);
    expect(result.activePageId).toBeDefined();
    expect(result.activePageId).not.toBe(deletedId);
  });
});

// ── Active-page projection and mixed sizes (working behavior) ─────────────────

describe('Baseline — active-page projection and mixed sizes (working)', () => {
  it('activePageNodes returns globals + one active page only', () => {
    let doc = createDocument();
    doc = addPage(doc);
    doc = addPage(doc);
    const p0 = doc.pages![0]!;
    const p1 = doc.pages![1]!;
    const r0 = addShapeToPage(doc, p0.id);
    doc = r0.doc;
    const r1 = addShapeToPage(doc, p1.id);
    doc = r1.doc;
    doc = { ...doc, activePageId: p0.id };

    const nodes = activePageNodes(doc);
    expect(nodes).toContain(r0.nodeId);
    expect(nodes).not.toContain(r1.nodeId);
  });

  it('mixed page sizes are schema-supported; setPageSize leaves content untouched', () => {
    let doc = createDocument();
    doc = addPage(doc, { width: 200, height: 300 });
    doc = addPage(doc, { width: 400, height: 200 });
    const pages = doc.pages!;
    expect(pages[1]!.width).toBe(200);
    expect(pages[1]!.height).toBe(300);
    expect(pages[2]!.width).toBe(400);
    expect(pages[2]!.height).toBe(200);

    const page = pages[1]!;
    const { doc: d1, nodeId } = addShapeToPage(doc, page.id);
    doc = d1;
    const transformBefore = doc.nodes[nodeId]!.transform;
    doc = setPageSize(doc, page.id, 250, 350);
    expect(doc.nodes[nodeId]!.transform).toEqual(transformBefore);
    expect(doc.pages![1]!.width).toBe(250);
  });
});

// ── Print defaults inheritance (working behavior) ─────────────────────────────

describe('Baseline — print defaults inherited on addPage (working)', () => {
  it('addPage copies document bleed/safeArea/slug onto the new page', () => {
    let doc = createDocument('test', false);
    doc = {
      ...doc,
      bleed: { top: 3, right: 3, bottom: 3, left: 3, linked: true, unit: 'mm' },
      safeArea: { top: 5, right: 5, bottom: 5, left: 5, unit: 'mm', enabled: true },
      slug: { top: 10, right: 10, bottom: 10, left: 10, unit: 'mm', enabled: true },
    };
    doc = addPage(doc);
    const added = doc.pages![1]!;
    expect(added.bleed).toEqual(doc.bleed);
    expect(added.safeArea).toEqual(doc.safeArea);
    expect(added.slug).toEqual(doc.slug);
  });
});
