import type { SceneNode as EngineNode } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { cacheContentParts, NodeHashMemo, SubtreeIrCache } from './subtreeIrCache';

/** A node wrapper as drawContent builds it: fresh object each frame, but the
 *  `transform` field is the SAME world-transform reference the transform cache
 *  returned (only a real transform edit produces a new reference). */
function frameNode(
  id: string,
  world: readonly number[],
  content: Record<string, unknown> = {},
): EngineNode {
  return {
    id,
    name: id,
    kind: 'shape',
    shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
    fill: { space: 'rgb', r: 10, g: 20, b: 30, a: 255 },
    opacity: 1,
    blendMode: 'normal',
    ...content,
    transform: world,
  } as unknown as EngineNode;
}

function unmemoizedHash(node: EngineNode, styleKey = ''): string {
  return SubtreeIrCache.nodeHash(node.id, node.transform, styleKey, cacheContentParts(node).parts);
}

describe('NodeHashMemo', () => {
  // ── Perf guard: this is the deterministic, non-flaky bounded-cost assertion ──
  it('re-hashes 0 nodes across pan frames (same doc + same transforms)', () => {
    const memo = new NodeHashMemo();
    const doc = { tag: 'doc-v1' }; // opaque, stable reference == "document unchanged"
    const worlds = Array.from({ length: 50 }, () => [1, 0, 0, 1, 0, 0] as const);

    // Simulate 30 pan frames: camera changes each frame, but the document and
    // every node's world transform are reference-stable, so drawContent rebuilds
    // fresh node wrappers around the SAME transform refs each frame.
    for (let frame = 0; frame < 30; frame++) {
      memo.beginFrame(doc, '');
      for (let n = 0; n < 50; n++) memo.hash(`n-${n}`, frameNode(`n-${n}`, worlds[n]!), '');
    }

    // Every node hashed exactly once (frame 0); frames 1..29 were pure hits.
    expect(memo.computes).toBe(50);
    expect(memo.hits).toBe(50 * 29);
    expect(memo.size).toBe(50);
  });

  // ── Correctness: never returns a stale hash ──────────────────────────────
  it('recomputes every node when the document reference changes (edit busts the memo)', () => {
    const memo = new NodeHashMemo();
    const worlds = Array.from({ length: 10 }, () => [1, 0, 0, 1, 0, 0] as const);

    const docA = { tag: 'A' };
    memo.beginFrame(docA, '');
    for (let n = 0; n < 10; n++) memo.hash(`n-${n}`, frameNode(`n-${n}`, worlds[n]!), '');
    expect(memo.computes).toBe(10);

    // Any edit yields a new immutable document reference.
    const docB = { tag: 'B' };
    memo.beginFrame(docB, '');
    for (let n = 0; n < 10; n++) memo.hash(`n-${n}`, frameNode(`n-${n}`, worlds[n]!), '');
    expect(memo.computes).toBe(20); // all recomputed, none reused from docA
  });

  it('recomputes a node whose world transform reference changed (node moved)', () => {
    const memo = new NodeHashMemo();
    const doc = { tag: 'doc' };
    const world1 = [1, 0, 0, 1, 0, 0] as const;

    memo.beginFrame(doc, '');
    memo.hash('n', frameNode('n', world1), '');
    expect(memo.computes).toBe(1);

    // Same doc reference, but the transform cache returned a fresh Affine — the
    // node's world transform changed, so its hash must be recomputed.
    const world2 = [1, 0, 0, 1, 25, 40] as const;
    memo.beginFrame(doc, '');
    memo.hash('n', frameNode('n', world2), '');
    expect(memo.computes).toBe(2);
  });

  it('clears when the extra per-frame key (showOriginalBg) changes', () => {
    const memo = new NodeHashMemo();
    const doc = { tag: 'doc' };
    const world = [1, 0, 0, 1, 0, 0] as const;

    memo.beginFrame(doc, '');
    memo.hash('n', frameNode('n', world), '');
    expect(memo.computes).toBe(1);

    memo.beginFrame(doc, 'node-42'); // compare toggle flips — content can differ
    memo.hash('n', frameNode('n', world), '');
    expect(memo.computes).toBe(2);
  });

  // ── Correctness: the memoized hash is identical to the un-memoized one, so it
  //    can never fabricate a false SubtreeIrCache hit ─────────────────────────
  it('returns a hash byte-identical to the un-memoized path (no false cache hits)', () => {
    const memo = new NodeHashMemo();
    const doc = { tag: 'doc' };
    const world = [2, 0, 0, 2, 5, 5] as const;
    const node = frameNode('n', world, {
      fills: [{ kind: 'solid', color: { space: 'rgb', r: 1, g: 2, b: 3, a: 255 } }],
      opacity: 0.5,
    });

    memo.beginFrame(doc, '');
    const { hash, parts } = memo.hash('n', node, 'style-7');
    expect(hash).toBe(unmemoizedHash(node, 'style-7'));
    // parts survive for the cache store path, and match a fresh extraction.
    expect(parts).toEqual(cacheContentParts(node).parts);
  });

  it('distinguishes different content within the same frame (no cross-node collisions)', () => {
    const memo = new NodeHashMemo();
    const doc = { tag: 'doc' };
    const world = [1, 0, 0, 1, 0, 0] as const;
    memo.beginFrame(doc, '');
    const a = memo.hash('a', frameNode('a', world, { opacity: 1 }), '');
    const b = memo.hash('b', frameNode('b', world, { opacity: 0.25 }), '');
    expect(a.hash).not.toBe(b.hash);
  });

  it('stays memory-bounded: size tracks live nodes, not accumulated doc versions', () => {
    const memo = new NodeHashMemo();
    const world = [1, 0, 0, 1, 0, 0] as const;
    // 100 successive edits (new doc ref each), 20 nodes each frame.
    for (let v = 0; v < 100; v++) {
      memo.beginFrame({ tag: `v${v}` }, '');
      for (let n = 0; n < 20; n++) memo.hash(`n-${n}`, frameNode(`n-${n}`, world), '');
    }
    expect(memo.size).toBe(20); // cleared each doc change — never 100 * 20
  });

  it('clear() resets counters and forces a recompute', () => {
    const memo = new NodeHashMemo();
    const doc = { tag: 'doc' };
    const world = [1, 0, 0, 1, 0, 0] as const;
    memo.beginFrame(doc, '');
    memo.hash('n', frameNode('n', world), '');
    memo.clear();
    // Same doc reference, but clear() dropped the doc identity, so the next
    // beginFrame treats it as new and the node recomputes.
    memo.beginFrame(doc, '');
    memo.hash('n', frameNode('n', world), '');
    expect(memo.size).toBe(1);
  });
});
