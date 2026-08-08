/**
 * Milestone 3 tests: page ownership (ADR-0126), safe deletion policies,
 * duplicate-page text-chain remap (fixes baseline B5), semantic page.*
 * operations (ADR-0149), and the v2.16→v2.17 placement migration.
 */

import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import {
  addChild,
  addGlobalChild,
  addMasterOverride,
  addNode,
  addPage,
  assignMasterToPage,
  createDocument,
  createMaster,
  deletePageWithPolicy,
  duplicatePage,
  makeShapeNode,
  nextNodeId,
  removePage,
} from '../document';
import { registerBuiltinOperations } from '../operations';
import { applyOperation, preconditionFailure, validatePayload } from '../operations/registry';
import {
  nodeDescendsFrom,
  owningPage,
  resolveOwnership,
  validatePageOwnership,
} from '../pageOwnership';
import type { GroupNode, Page } from '../types';
import { migrateV216ToV217 } from '../version-migrations-v217';

function firstPage(doc: Document): Page {
  const page = doc.pages?.[0];
  if (!page) throw new Error('no pages');
  return page;
}

function addShapeToPage(doc: Document, pageId: string): { doc: Document; nodeId: string } {
  const page = doc.pages?.find((p) => p.id === pageId);
  if (!page) throw new Error('no page');
  const { id: nodeId, doc: d1 } = nextNodeId(doc);
  const shape = makeShapeNode(nodeId, { kind: 'rect', x: 10, y: 10, w: 50, h: 50 });
  const d2 = addChild(d1, page.contentRoot, shape);
  return { doc: d2, nodeId };
}

// ── Ownership resolution ─────────────────────────────────────────────────────

describe('Ownership resolution (ADR-0126)', () => {
  it('resolves page, global, master, and pasteboard ownership', () => {
    let doc = createDocument();
    const page = firstPage(doc);
    const { doc: d1, nodeId } = addShapeToPage(doc, page.id);
    doc = d1;

    doc = createMaster(doc, { name: 'M', width: 100, height: 100 });
    const master = Object.values(doc.masters!)[0]!;
    const masterRoot = doc.nodes[master.contentRoot] as GroupNode;
    const { id: mNodeId, doc: d2 } = nextNodeId(doc);
    doc = addChild(
      d2,
      masterRoot.id,
      makeShapeNode(mNodeId, { kind: 'rect', x: 0, y: 0, w: 1, h: 1 }),
    );

    const { id: gNodeId, doc: d3 } = nextNodeId(doc);
    const globalNode = makeShapeNode(gNodeId, { kind: 'rect', x: 0, y: 0, w: 1, h: 1 });
    doc = addNode(d3, globalNode);
    doc = addGlobalChild(doc, gNodeId);

    expect(resolveOwnership(doc, nodeId)).toEqual({ kind: 'page', pageId: page.id });
    expect(resolveOwnership(doc, mNodeId)).toEqual({ kind: 'master', masterId: master.id });
    expect(resolveOwnership(doc, gNodeId)).toEqual({ kind: 'global' });
    expect(resolveOwnership(doc, 'missing-node')).toEqual({ kind: 'pasteboard' });
    expect(owningPage(doc, nodeId)).toBe(page.id);
    expect(owningPage(doc, gNodeId)).toBeNull();
  });

  it('validates ownership invariants; clean documents pass', () => {
    let doc = createDocument();
    doc = addPage(doc);
    doc = addPage(doc);
    const { doc: d1 } = addShapeToPage(doc, firstPage(doc).id);
    expect(validatePageOwnership(d1)).toEqual([]);
  });

  it('flags two pages sharing one content root', () => {
    const doc = createDocument();
    const page = firstPage(doc);
    const broken = {
      ...doc,
      pages: [page, { ...page, id: 'other-page' }],
    };
    const errors = validatePageOwnership(broken);
    expect(errors.some((e) => e.includes('share contentRoot'))).toBe(true);
  });

  it('flags a missing content root and a missing active page', () => {
    let doc = createDocument();
    doc = addPage(doc);
    const page = firstPage(doc);
    const broken = { ...doc, pages: [{ ...page, contentRoot: 'missing-root' }] };
    const errors = validatePageOwnership(broken);
    expect(errors.some((e) => e.includes('missing-root'))).toBe(true);

    const noActive = { ...doc, activePageId: 'ghost-page' };
    expect(validatePageOwnership(noActive).some((e) => e.includes('activePageId'))).toBe(true);
  });

  it('nodeDescendsFrom walks nested containers', () => {
    const doc = createDocument();
    const page = firstPage(doc);
    const { doc: d1, nodeId } = addShapeToPage(doc, page.id);
    expect(nodeDescendsFrom(d1, nodeId, page.contentRoot)).toBe(true);
    expect(nodeDescendsFrom(d1, nodeId, 'other-root')).toBe(false);
  });
});

// ── Deletion policies ─────────────────────────────────────────────────────────

describe('Page deletion policies (ADR-0126 D3)', () => {
  it('delete-content keeps the historical behavior', () => {
    let doc = createDocument();
    doc = addPage(doc);
    const page = doc.pages![1]!;
    const { doc: d1, nodeId } = addShapeToPage(doc, page.id);
    const result = deletePageWithPolicy(d1, page.id, 'delete-content');
    expect(result.nodes[nodeId]).toBeUndefined();
    expect(result.pages!.length).toBe(1);
  });

  it('move-to-pasteboard preserves content on the pasteboard', () => {
    let doc = createDocument();
    doc = addPage(doc);
    const page = doc.pages![1]!;
    const { doc: d1, nodeId } = addShapeToPage(doc, page.id);
    const result = deletePageWithPolicy(d1, page.id, 'move-to-pasteboard');
    expect(result.pages!.length).toBe(1);
    expect(result.nodes[nodeId]).toBeDefined();
    expect(result.rootChildren).toContain(nodeId);
    expect(result.nodes[page.contentRoot]).toBeUndefined();
  });

  it('move-to-page preserves content on the target page', () => {
    let doc = createDocument();
    doc = addPage(doc);
    const target = doc.pages![0]!;
    const page = doc.pages![1]!;
    const { doc: d1, nodeId } = addShapeToPage(doc, page.id);
    const result = deletePageWithPolicy(d1, page.id, 'move-to-page', target.id);
    const targetRoot = result.nodes[target.contentRoot] as GroupNode;
    expect(targetRoot.children).toContain(nodeId);
    expect(result.nodes[page.contentRoot]).toBeUndefined();
  });

  it('forces content preservation on the last page, whatever the policy', () => {
    // The last page is deletable, but deleting it must never be a one-click
    // way to empty the whole document — at that point its content IS the
    // document. Every policy therefore behaves as move-to-pasteboard here.
    for (const policy of ['delete-content', 'move-to-pasteboard', 'move-to-page'] as const) {
      const doc = createDocument();
      const page = firstPage(doc);
      const { doc: seeded, nodeId } = addShapeToPage(doc, page.id);
      const after = deletePageWithPolicy(seeded, page.id, policy);
      expect(after.pages ?? []).toHaveLength(0);
      expect(after.nodes[nodeId]).toBeTruthy();
      expect(after.rootChildren).toContain(nodeId);
    }
  });

  it('removePage remains equivalent to delete-content', () => {
    let doc = createDocument();
    doc = addPage(doc);
    const page = doc.pages![1]!;
    const { doc: d1 } = addShapeToPage(doc, page.id);
    const viaRemove = removePage(d1, page.id);
    const viaPolicy = deletePageWithPolicy(d1, page.id, 'delete-content');
    expect(viaRemove.pages).toEqual(viaPolicy.pages);
    expect(Object.keys(viaRemove.nodes)).toEqual(Object.keys(viaPolicy.nodes));
  });
});

// ── Duplicate page chain remap (fixes B5) ────────────────────────────────────

describe('Duplicate page remaps text chains (ADR-0126 D4)', () => {
  it('creates a fresh chain for the duplicated frames', () => {
    let doc = createDocument();
    const page = firstPage(doc);
    const { doc: d1 } = addShapeToPage(doc, page.id);
    doc = d1;
    const { id: frameId, doc: d2 } = nextNodeId(doc);
    doc = addChild(
      d2,
      page.contentRoot,
      makeShapeNode(frameId, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }),
    );
    doc = {
      ...doc,
      textChains: {
        'chain-1': { id: 'chain-1', name: 'Story', frameIds: [frameId] },
      },
    };

    const duplicated = duplicatePage(doc, page.id);
    const chains = duplicated.textChains as Record<string, { id: string; frameIds: string[] }>;
    const chainIds = Object.keys(chains);
    expect(chainIds).toHaveLength(2);

    const original = chains['chain-1']!;
    expect(original.frameIds).toEqual([frameId]);

    const copy = chains[chainIds.find((c) => c !== 'chain-1')!]!;
    expect(copy.id).toBe(chainIds.find((c) => c !== 'chain-1'));
    expect(copy.frameIds).toHaveLength(1);
    expect(copy.frameIds[0]).not.toBe(frameId);
    expect(duplicated.nodes[copy.frameIds[0]!]).toBeDefined();

    const copyPage = duplicated.pages![1]!;
    const copyRoot = duplicated.nodes[copyPage.contentRoot] as GroupNode;
    expect(copyRoot.children).toContain(copy.frameIds[0]);
  });

  it('leaves chains without frames on the page untouched', () => {
    let doc = createDocument();
    doc = addPage(doc);
    const page = doc.pages![0]!;
    const otherPage = doc.pages![1]!;
    const { doc: d1, nodeId } = addShapeToPage(doc, otherPage.id);
    doc = d1;
    doc = {
      ...doc,
      textChains: {
        'chain-1': { id: 'chain-1', name: 'Story', frameIds: [nodeId] },
      },
    };
    const duplicated = duplicatePage(doc, page.id);
    const chains = duplicated.textChains as Record<string, { frameIds: string[] }>;
    expect(Object.keys(chains)).toEqual(['chain-1']);
    expect(chains['chain-1']!.frameIds).toEqual([nodeId]);
  });
});

// ── page.* operations ─────────────────────────────────────────────────────────

describe('page.* operations (ADR-0149)', () => {
  registerBuiltinOperations();

  it('page.create appends a page', () => {
    const doc = createDocument();
    const result = applyOperation(doc, 'page.create', {
      name: 'Cover',
      width: 400,
      height: 300,
    });
    expect(result.pages!.length).toBe(2);
    expect(result.pages![1]!.name).toBe('Cover');
    expect(result.pages![1]!.width).toBe(400);
  });

  it('page.create after a page inserts in order', () => {
    let doc = createDocument();
    doc = addPage(doc);
    doc = addPage(doc);
    const [p0, p1] = doc.pages!;
    const result = applyOperation(doc, 'page.create', { afterPageId: p0!.id });
    const inserted = result.pages!.find((p) => p.id !== p0!.id && p.id !== p1!.id)!;
    expect(inserted.order > p0!.order && inserted.order < p1!.order).toBe(true);
    expect(result.pages!.map((p) => p.id)[1]).toBe(inserted.id);
    expect(result.pages!.length).toBe(4);
  });

  it('page.delete applies the policy', () => {
    let doc = createDocument();
    doc = addPage(doc);
    const page = doc.pages![1]!;
    const { doc: d1, nodeId } = addShapeToPage(doc, page.id);
    const result = applyOperation(d1, 'page.delete', {
      pageId: page.id,
      policy: 'move-to-pasteboard',
    });
    expect(result.pages!.length).toBe(1);
    expect(result.nodes[nodeId]).toBeDefined();
  });

  it('page.delete precondition rejects last page and missing target', () => {
    const doc = createDocument();
    expect(preconditionFailure(doc, 'page.delete', { pageId: firstPage(doc).id })).toMatch(
      /last page/,
    );

    let d2 = createDocument();
    d2 = addPage(d2);
    expect(
      preconditionFailure(d2, 'page.delete', {
        pageId: d2.pages![0]!.id,
        policy: 'move-to-page',
        targetPageId: 'missing',
      }),
    ).toMatch(/target page/);
  });

  it('page.duplicate creates a copy with fresh content root', () => {
    const doc = createDocument();
    const page = firstPage(doc);
    const { doc: d1 } = addShapeToPage(doc, page.id);
    const result = applyOperation(d1, 'page.duplicate', { pageId: page.id });
    expect(result.pages!.length).toBe(2);
    expect(result.pages![1]!.contentRoot).not.toBe(page.contentRoot);
  });

  it('page.reorder validates completeness', () => {
    let doc = createDocument();
    doc = addPage(doc);
    const ids = doc.pages!.map((p) => p.id);
    expect(preconditionFailure(doc, 'page.reorder', { pageIds: ids.slice(1) })).toMatch(
      /count mismatch/,
    );
    const reversed = applyOperation(doc, 'page.reorder', { pageIds: [...ids].reverse() });
    expect(reversed.pages!.map((p) => p.id)).toEqual([...ids].reverse());
  });

  it('page.resize resizes without scaling by default; scaleContent scales', () => {
    const doc = createDocument();
    const page = firstPage(doc);
    const { doc: d1, nodeId } = addShapeToPage(doc, page.id);
    const transformBefore = d1.nodes[nodeId]!.transform;
    const resized = applyOperation(d1, 'page.resize', {
      pageId: page.id,
      width: 960,
      height: 540,
    });
    expect(resized.pages![0]!.width).toBe(960);
    expect(resized.nodes[nodeId]!.transform).toEqual(transformBefore);

    const scaled = applyOperation(d1, 'page.resize', {
      pageId: page.id,
      width: 960,
      height: 540,
      scaleContent: true,
    });
    const t = scaled.nodes[nodeId]!.transform as unknown as number[];
    const before = transformBefore as unknown as number[];
    expect(t[4]).toBe(before[4]! * 0.5);
  });

  it('page.move-on-pasteboard sets placement only', () => {
    const doc = createDocument();
    const page = firstPage(doc);
    const { doc: d1 } = addShapeToPage(doc, page.id);
    const moved = applyOperation(d1, 'page.move-on-pasteboard', {
      pageId: page.id,
      x: 120,
      y: -40,
    });
    expect(moved.pages![0]!.placement).toEqual({ x: 120, y: -40 });
  });

  it('validation rejects malformed payloads', () => {
    expect(validatePayload('page.resize', { pageId: 'p1', width: 0, height: 100 }).ok).toBe(false);
    expect(validatePayload('page.delete', { pageId: 'p1', policy: 'bogus' }).ok).toBe(false);
    expect(validatePayload('page.move-on-pasteboard', { pageId: 'p1', x: 1 }).ok).toBe(false);
    expect(validatePayload('page.create', { width: -5 }).ok).toBe(false);
  });
});

// ── v2.17 placement migration ────────────────────────────────────────────────

describe('v2.16 → v2.17 placement migration', () => {
  it('materializes deterministic placement for pages without one', () => {
    let doc = createDocument('test', false);
    doc = addPage(doc, { width: 200, height: 100 });
    const raw = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
    (raw as { formatVersion: string }).formatVersion = '2.16';
    for (const page of raw.pages as Array<Record<string, unknown>>) {
      delete page.placement;
    }

    const migrated = migrateV216ToV217(raw) as Record<string, unknown>;
    const pages = migrated.pages as Array<Record<string, unknown>>;
    expect(pages[0]!.placement).toEqual({ x: 0, y: 0 });
    expect((pages[1]!.placement as { x: number }).x).toBe(0);
    expect((pages[1]!.placement as { y: number }).y).toBeGreaterThan(0);
  });

  it('is idempotent and leaves explicit placement untouched', () => {
    let doc = createDocument('test', false);
    doc = addPage(doc);
    doc = {
      ...doc,
      pages: [{ ...doc.pages![0]!, placement: { x: 42, y: 42 } }, ...doc.pages!.slice(1)],
    };
    const raw = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
    const once = migrateV216ToV217(raw);
    const twice = migrateV216ToV217(once);
    expect(once).toEqual(twice);
    const pages = twice.pages as Array<Record<string, unknown>>;
    expect(pages[0]!.placement).toEqual({ x: 42, y: 42 });
  });

  it('defaults facingPages binding direction to ltr', () => {
    const raw = {
      pages: [{ id: 'p1', order: 'a0', width: 100, height: 100 }],
      facingPages: { enabled: true, startOnRight: true },
    } as unknown as Record<string, unknown>;
    const migrated = migrateV216ToV217(raw);
    expect((migrated.facingPages as { bindingDirection: string }).bindingDirection).toBe('ltr');
  });

  it('stamps the version on flat documents without pages', () => {
    const raw = { formatVersion: '2.16', rootChildren: [] } as Record<string, unknown>;
    const migrated = migrateV216ToV217(raw);
    expect(migrated.formatVersion).toBe('2.17');
    expect(migrated.rootChildren).toEqual([]);
    expect(migrated.pages).toBeUndefined();
  });
});

// ── master override projection regression note ────────────────────────────────

describe('Master override projection (baseline B3 regression guard)', () => {
  it('addMasterOverride still records whole-node overrides', () => {
    let doc = createDocument();
    doc = createMaster(doc, { name: 'M', width: 100, height: 100 });
    const master = Object.values(doc.masters!)[0]!;
    const page = firstPage(doc);
    doc = assignMasterToPage(doc, page.id, master.id);
    doc = addMasterOverride(doc, page.id, 'm-node', 'hidden');
    expect(doc.pages![0]!.masterOverrides?.['m-node']?.type).toBe('hidden');
  });
});
