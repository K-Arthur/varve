/**
 * 10K Node Stress Test — benchmarks for critical layers subsystems.
 *
 * All thresholds are generous enough to pass in CI but tight enough to detect
 * regressions. Times measured via performance.now() with expect().toBeLessThan().
 *
 * Run with a 60s timeout:
 *   npx vitest run packages/editor/src/components/LayersPanel/__benchmarks__/layers10k.bench.test.ts --testTimeout=60000
 */

import type { Document, NodeId, SceneNode } from '@varve/scene';
import {
  buildParentIndexMap,
  createDocument,
  deepCloneSubtree,
  makeGroupNode,
  makeShapeNode,
  resolveAllStyles,
} from '@varve/scene';
import { describe, expect, test } from 'vitest';
import { getOrCreateParentCache, getParentFast } from '../../../scene/parentIndexCache';
import { buildSpatialIndex, queryPoint } from '../../../scene/spatialIndex';
import { DEFAULT_FILTER, type LayerFilterSpec } from '../layerFilterTypes';
import { createSearchIndex, searchIndex } from '../layerSearchIndex';
import { flattenTree } from '../useFlatTree';

// ── Build helpers ───────────────────────────────────────────────────────────

/**
 * Build a flat document with 10K+ nodes: 100 groups × 100 children.
 * Total: 10,100 nodes (100 groups + 10,000 shapes).
 */
function build10kDoc(): Document {
  const doc = createDocument('10K Stress Test', true);
  const nodes: Record<NodeId, SceneNode> = {};
  const rootChildren: NodeId[] = [];
  let nextId = doc.nextId;

  for (let i = 0; i < 100; i++) {
    const groupChildren: NodeId[] = [];
    for (let j = 0; j < 100; j++) {
      const nid = `n${nextId++}` as NodeId;
      nodes[nid] = makeShapeNode(
        nid,
        { kind: 'rect', x: i * 200, y: j * 30, w: 100, h: 50 },
        { name: `Layer ${i * 100 + j + 1}` },
      );
      groupChildren.push(nid);
    }
    const gid = `n${nextId++}` as NodeId;
    nodes[gid] = makeGroupNode(gid, {
      name: `Group ${i + 1}`,
      children: groupChildren,
    });
    rootChildren.push(gid);
  }

  return { ...doc, nextId, rootChildren, nodes };
}

/**
 * Build a document with a single group containing 1000 shape children.
 * Used for the deep clone benchmark.
 */
function build1kSubtreeDoc(): { doc: Document; rootId: NodeId } {
  let doc = createDocument('1K Subtree', true);
  const nodes: Record<NodeId, SceneNode> = {};
  const children: NodeId[] = [];
  let nextId = doc.nextId;

  for (let j = 0; j < 1000; j++) {
    const nid = `n${nextId++}` as NodeId;
    nodes[nid] = makeShapeNode(
      nid,
      { kind: 'ellipse', cx: j * 10, cy: 0, rx: 20, ry: 15 },
      { name: `Dot ${j + 1}` },
    );
    children.push(nid);
  }

  const gid = `n${nextId++}` as NodeId;
  nodes[gid] = makeGroupNode(gid, { name: 'Big Group', children });
  doc = { ...doc, nextId, rootChildren: [gid], nodes };

  return { doc, rootId: gid };
}

/**
 * Build a 10K document with a style assigned to every 100th node.
 * Used for the style resolution benchmark.
 */
function build10kDocWithStyles(): Document {
  const doc = build10kDoc();
  const styles: Record<string, import('@varve/scene').Style> = {
    s1: {
      id: 's1',
      type: 'color',
      name: 'Primary',
      fill: {
        type: 'solid' as const,
        color: { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 },
        opacity: 1,
        blendMode: 'normal' as const,
        visible: true,
      },
    },
  };

  const nodes = { ...doc.nodes };
  const ids = Object.keys(nodes) as NodeId[];
  for (let i = 0; i < ids.length; i += 100) {
    const id = ids[i]!;
    nodes[id] = { ...nodes[id]!, styleId: 's1' } as SceneNode;
  }

  return { ...doc, styles, nodes };
}

/** Build a set containing every node ID (all expanded). */
function allExpanded(doc: Document): Set<NodeId> {
  const set = new Set<NodeId>();
  for (const id of Object.keys(doc.nodes)) set.add(id as NodeId);
  return set;
}

const BENCH_TIMEOUT = 60_000;

// ── 10K Node Performance Tests ──────────────────────────────────────────────

describe('10K Node Performance', () => {
  const doc = build10kDoc();
  const expanded = allExpanded(doc);

  test(
    'flatten 10K nodes completes under 200ms',
    () => {
      const start = performance.now();
      const result = flattenTree(doc, expanded);
      const elapsed = performance.now() - start;

      expect(result.length).toBe(10100);
      expect(elapsed).toBeLessThan(200);
    },
    BENCH_TIMEOUT,
  );

  test(
    'search index rebuild for 10K nodes completes under 750ms',
    () => {
      const start = performance.now();
      const index = createSearchIndex(doc);
      const elapsed = performance.now() - start;

      expect(index.nodeWords.size).toBe(10100);
      expect(elapsed).toBeLessThan(750);
    },
    BENCH_TIMEOUT,
  );

  test(
    'spatial index rebuild for 10K nodes completes under 1000ms',
    () => {
      const start = performance.now();
      const index = buildSpatialIndex(doc);
      const elapsed = performance.now() - start;

      expect(index.grid.size).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(1000);
    },
    BENCH_TIMEOUT,
  );

  test(
    'parent index rebuild for 10K nodes completes under 250ms',
    () => {
      const start = performance.now();
      const parentMap = buildParentIndexMap(doc);
      const elapsed = performance.now() - start;

      expect(parentMap.size).toBeGreaterThanOrEqual(10000);
      expect(elapsed).toBeLessThan(250);
    },
    BENCH_TIMEOUT,
  );

  test(
    'getParentFast 10K lookups completes under 100ms',
    () => {
      const cache = getOrCreateParentCache(doc);

      // Collect all shape node IDs (10,000 children)
      const childIds: NodeId[] = [];
      for (const [id, node] of Object.entries(doc.nodes)) {
        if (node.kind === 'shape') childIds.push(id as NodeId);
      }
      expect(childIds.length).toBe(10000);

      const start = performance.now();
      for (const id of childIds) {
        getParentFast(doc, id, cache);
      }
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(100);
    },
    BENCH_TIMEOUT,
  );

  test(
    'queryPoint on 10K spatial index completes under 5ms',
    () => {
      const index = buildSpatialIndex(doc);

      const start = performance.now();
      const result = queryPoint(index, 500, 500);
      const elapsed = performance.now() - start;

      expect(result).toBeDefined();
      expect(elapsed).toBeLessThan(5);
    },
    BENCH_TIMEOUT,
  );

  test(
    'filter 10K nodes by kind completes under 100ms',
    () => {
      const kindFilter: LayerFilterSpec = { ...DEFAULT_FILTER, kinds: ['shape'] };

      const start = performance.now();
      const result = flattenTree(doc, expanded, kindFilter);
      const elapsed = performance.now() - start;

      // Groups with matching children are also included (parent context)
      const shapes = result.filter((e) => e.node.kind === 'shape');
      expect(shapes.length).toBe(10000);
      expect(elapsed).toBeLessThan(100);
    },
    BENCH_TIMEOUT,
  );

  test(
    'flatten 10K nodes by search term plus filter completes under 250ms',
    () => {
      const index = createSearchIndex(doc);
      const matchedIds = new Set(searchIndex(index, 'layer 5'));
      expect(matchedIds.size).toBeGreaterThan(0);

      const searchFilter: LayerFilterSpec = { ...DEFAULT_FILTER, search: 'layer 5' };

      const start = performance.now();
      const result = flattenTree(doc, expanded, searchFilter, matchedIds);
      const elapsed = performance.now() - start;

      expect(result.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(250);
    },
    BENCH_TIMEOUT,
  );
});

// ── Subtree Clone ────────────────────────────────────────────────────────────

describe('Subtree Clone Performance', () => {
  test(
    'deep clone 1K node subtree completes under 100ms',
    () => {
      const { doc: subtreeDoc, rootId } = build1kSubtreeDoc();

      // Warm up once: the first call pays JIT + allocation setup, and on a
      // contended box that cost alone blew the 100ms budget (2026-08-08).
      deepCloneSubtree(subtreeDoc.nodes, subtreeDoc.nextId, rootId);

      const start = performance.now();
      const result = deepCloneSubtree(subtreeDoc.nodes, subtreeDoc.nextId, rootId);
      const elapsed = performance.now() - start;

      expect(Object.keys(result.nodes).length).toBe(1001);
      expect(elapsed).toBeLessThan(100);
    },
    BENCH_TIMEOUT,
  );
});

// ── Style Resolution ────────────────────────────────────────────────────────

describe('Style Resolution Performance', () => {
  const doc = build10kDocWithStyles();

  test(
    'resolveAllStyles for 10K nodes completes under 200ms',
    () => {
      const start = performance.now();
      const resolved = resolveAllStyles(doc);
      const elapsed = performance.now() - start;

      expect(resolved.size).toBeGreaterThanOrEqual(100);
      expect(elapsed).toBeLessThan(200);
    },
    BENCH_TIMEOUT,
  );
});
