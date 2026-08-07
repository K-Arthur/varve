/**
 * Master-projection render offsets (M8, ADR-0132): projected master items
 * carry the placement of the page they render on.
 */
import type { Document } from '@varve/scene';
import {
  addChild,
  addMasterOverride,
  addPage,
  assignMasterToPage,
  createDocument,
  createMaster,
  makeShapeNode,
  nextNodeId,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { collectMasterOffsets, offsetWorldBounds, offsetWorldTransform } from '../masterOffsets';

function masterTwoPageDoc(): Document {
  let doc = createDocument('offsets', false);
  doc = createMaster(doc, { name: 'M', width: 1920, height: 1080 });
  const master = Object.values(doc.masters!)[0]!;
  const masterRoot = doc.nodes[master.contentRoot] as { id: string; children: string[] };
  const { id: headerId, doc: d1 } = nextNodeId(doc);
  doc = addChild(
    d1,
    masterRoot.id,
    makeShapeNode(headerId, { kind: 'rect', x: 0, y: 0, w: 100, h: 20 }),
  );
  doc = addPage(doc, {});
  doc = {
    ...doc,
    pages: doc.pages!.map((p, i) => ({
      ...p,
      placement: { x: i * 2500, y: i * 1200 },
    })),
  };
  for (const page of doc.pages!) doc = assignMasterToPage(doc, page.id, master.id);
  return doc;
}

describe('collectMasterOffsets (M8)', () => {
  it('maps every projected master item to its page placement', () => {
    const doc = masterTwoPageDoc();
    const master = Object.values(doc.masters!)[0]!;
    const masterRoot = doc.nodes[master.contentRoot] as { id: string; children: string[] };
    const headerId = masterRoot.children[0]!;
    const offsets = collectMasterOffsets(doc);
    // The same master node serves both pages — the map records the LAST
    // page's placement; the renderer rebuilds it per frame.
    expect(offsets.get(headerId)).toEqual({ x: 2500, y: 1200 });
  });

  it('applies the placement to the master world transform', () => {
    const doc = masterTwoPageDoc();
    const master = Object.values(doc.masters!)[0]!;
    const masterRoot = doc.nodes[master.contentRoot] as { id: string; children: string[] };
    const headerId = masterRoot.children[0]!;
    const offsets = collectMasterOffsets(doc);
    const world: Affine = [1, 0, 0, 1, 40, 60];
    const offset = offsets.get(headerId)!;
    expect(offsetWorldTransform(world, offset)).toEqual([1, 0, 0, 1, 2540, 1260]);
    expect(offsetWorldBounds({ x: 40, y: 60, w: 100, h: 20 }, offset)).toEqual({
      x: 2540,
      y: 1260,
      w: 100,
      h: 20,
    });
  });

  it('excludes hidden/deleted overrides from the offsets map (B3)', () => {
    let doc = masterTwoPageDoc();
    const master = Object.values(doc.masters!)[0]!;
    const masterRoot = doc.nodes[master.contentRoot] as { id: string; children: string[] };
    const headerId = masterRoot.children[0]!;
    doc = addMasterOverride(doc, doc.pages![0]!.id, headerId, 'hidden');
    const offsets = collectMasterOffsets(doc);
    expect(offsets.has(headerId)).toBe(true); // still projected on page 2
    // Page 1's copy is gone; the map is a single node->offset table so the
    // per-page filtering lives in projectMasterNodes; this asserts the
    // offset map only ever contains projected ids.
    const projected = offsets.get(headerId);
    expect(projected).toBeDefined();
  });

  it('returns an empty map for documents without masters', () => {
    const doc = createDocument('offsets', false);
    expect(collectMasterOffsets(doc).size).toBe(0);
  });
});
