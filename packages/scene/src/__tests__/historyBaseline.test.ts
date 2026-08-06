/**
 * Baseline tests for the persistent-history architecture (Milestone 1).
 *
 * These capture CURRENT behavior so that later milestones (identity,
 * canonicalization, persistent log) can prove they change it deliberately.
 * See docs/audits/history-identity-inventory-2026-08-05.md and
 * docs/audits/history-serialization-inventory-2026-08-05.md.
 */
import { describe, expect, it } from 'vitest';
import { createEmbeddedAsset } from '../assets';
import { deepCloneSubtree } from '../clone';
import { addNode, createDocument, makeShapeNode } from '../document';
import { nextNodeId } from '../node-id';

describe('baseline: node id allocation', () => {
  // ADR-0025 (M2): ids are now collision-resistant `n<counter>_<random>`.
  // The counter contract (monotonic, per-document) is unchanged.
  it('mints collision-resistant ids from Document.nextId', () => {
    const doc = createDocument('baseline', { flat: true });
    expect(doc.nextId).toBe(1);
    const { id, doc: d2 } = nextNodeId(doc);
    expect(id).toMatch(/^n1_[0-9a-f]{16}$/);
    expect(d2.nextId).toBe(2);
    const { id: id2 } = nextNodeId(d2);
    expect(id2).toMatch(/^n2_[0-9a-f]{16}$/);
  });

  it('deepCloneSubtree remaps ids through the counter', () => {
    const doc = { ...createDocument('clone', { flat: true }), nextId: 100 };
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const withNode = addNode(doc, node);
    const { nodes, rootId, nextId } = deepCloneSubtree(withNode.nodes, withNode.nextId, 'n1');
    expect(rootId).toMatch(/^n100_[0-9a-f]{16}$/);
    expect(nodes[rootId]).toBeDefined();
    expect(nextId).toBe(101);
  });
});

describe('baseline: shared content hash dedup of assets', () => {
  it('deduplicates identical payloads to one asset entry', () => {
    const payload = 'data:image/png;base64,iVBORw0KGgo=';
    const a = createEmbeddedAsset({
      dataUrl: payload,
      mimeType: 'image/png',
      naturalWidth: 1,
      naturalHeight: 1,
    });
    const b = createEmbeddedAsset({
      dataUrl: payload,
      mimeType: 'image/png',
      naturalWidth: 1,
      naturalHeight: 1,
    });
    expect(a.id).toBe(b.id);
  });
});

// NOTE: codec round-trip baselines (encode/decode stability, nextId recompute
// on decode) are deferred: the working tree's scene codec currently imports
// './mockup/normalize' which does not exist yet (pre-existing in-progress
// work). Those baselines land with the canonical-serialization milestone.
