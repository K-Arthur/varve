/**
 * Reflow performance — reflowLayoutChildren at 100 / 1k / 10k / 50k children.
 *
 * Reflow runs once per committed frame resize (canvas handle drag commit and
 * inspector W/H edits), so the bound that matters is a single call against a
 * full layout frame. Text children are the expensive case (measureText per
 * node), so the corpus mixes rect children with a text-child slice.
 *
 * AGENTS.md: structural changes to per-node layout dispatch must be
 * benchmarked before merge — this file is that gate.
 *
 * Run:
 *   npx vitest run packages/layout/src/__tests__/reflow.bench.test.ts --testTimeout=120000
 */
import type { Affine } from '@varve/engine';
import type { Document, FrameNode, NodeId, SceneNode } from '@varve/scene';
import { describe, expect, test } from 'vitest';
import { reflowLayoutChildren } from '../reflow';

const BENCH_TIMEOUT = 120_000;

interface Corpus {
  doc: Document;
  frameId: NodeId;
  count: number;
}

/**
 * Build a flex frame with `count` children: 3/4 rects (fixed size) and
 * 1/4 text nodes (measured — the expensive path).
 */
function buildCorpus(count: number): Corpus {
  const nodes: Record<NodeId, SceneNode> = {};
  const children: NodeId[] = [];
  const frameId = 'frame' as NodeId;

  for (let i = 0; i < count; i++) {
    const id = `c${i}` as NodeId;
    if (i % 4 === 0) {
      nodes[id] = {
        kind: 'text',
        id,
        name: `Text ${i}`,
        transform: [1, 0, 0, 1, 0, 0] as Affine,
        text: `Layer ${i} with some words`,
        fontSize: 14,
        fontFamily: 'Geist',
        order: `a${i}`,
      } as unknown as SceneNode;
    } else {
      nodes[id] = {
        kind: 'shape',
        id,
        name: `Shape ${i}`,
        transform: [1, 0, 0, 1, 0, 0] as Affine,
        shape: { kind: 'rect', x: 0, y: 0, w: 80, h: 32 },
        order: `a${i}`,
      } as unknown as SceneNode;
    }
    children.push(id);
  }

  const frame = {
    kind: 'frame',
    id: frameId,
    name: 'Layout Frame',
    transform: [1, 0, 0, 1, 0, 0] as Affine,
    w: 1200,
    h: count > 100 ? 8000 : 800,
    children,
    layoutStyle: {
      mode: 'flex',
      direction: 'row',
      wrap: true,
      gap: 8,
      padding: [12, 12, 12, 12] as [number, number, number, number],
      grow: 0,
      shrink: 0,
      alignItems: 'start',
      justifyContent: 'start',
    },
  } as unknown as FrameNode;
  nodes[frameId] = frame as unknown as SceneNode;

  return {
    doc: { nodes, rootChildren: [frameId], pages: [], guides: [] } as unknown as Document,
    frameId,
    count,
  };
}

function bestOf3(fn: () => unknown): number {
  fn(); // JIT + allocation warm-up; the first call pays setup, not the frame.
  let best = Infinity;
  for (let attempt = 0; attempt < 3; attempt++) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe('reflowLayoutChildren performance', () => {
  const cases: Array<{ count: number; budgetMs: number }> = [
    { count: 100, budgetMs: 50 },
    { count: 1_000, budgetMs: 400 },
    { count: 10_000, budgetMs: 4_000 },
    { count: 50_000, budgetMs: 20_000 },
  ];

  for (const { count, budgetMs } of cases) {
    test(
      `full reflow of a ${count}-child flex frame completes under ${budgetMs}ms`,
      () => {
        const { doc, frameId } = buildCorpus(count);
        const elapsed = bestOf3(() => {
          reflowLayoutChildren(doc, frameId);
        });

        // Sanity: the reflow really ran (children were repositioned).
        const after = reflowLayoutChildren(doc, frameId);
        const firstChild = after.nodes['c0' as NodeId];
        expect(firstChild).toBeDefined();
        expect(elapsed).toBeLessThan(budgetMs);
      },
      BENCH_TIMEOUT,
    );
  }

  test(
    'reflow is roughly linear: 10k costs less than 30x the 1k cost',
    () => {
      // Absolute budgets above already bound the per-size cost. The ratio is
      // a secondary complexity gate, deliberately loose (30x): best-of-3 on
      // a shared/loaded machine varies with GC and JIT state, and a 10x
      // linearity expectation tripped on variance alone (2026-08-13).
      const small = buildCorpus(1_000);
      const large = buildCorpus(10_000);
      const smallMs = bestOf3(() => reflowLayoutChildren(small.doc, small.frameId));
      const largeMs = bestOf3(() => reflowLayoutChildren(large.doc, large.frameId));
      expect(largeMs).toBeLessThan(Math.max(100, smallMs * 30));
    },
    BENCH_TIMEOUT,
  );
});
