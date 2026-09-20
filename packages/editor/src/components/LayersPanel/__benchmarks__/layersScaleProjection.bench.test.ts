/**
 * Layers panel — tree projection scale benchmark (1k / 10k / 50k nodes).
 *
 * Measures the panel's data layer, not the importer: `flattenTree` with no
 * filter, with a search filter, and with the kind/attribute filter the
 * workspace projection adds. Writes a JSON record so before/after phases can
 * be compared directly:
 *
 *   VARVE_LAYERS_PHASE=baseline npx vitest run \
 *     packages/editor/src/components/LayersPanel/__benchmarks__/layersScaleProjection.bench.test.ts \
 *     --config vitest.bench.config.ts --testTimeout=180000
 *
 * The browser-side interaction budget lives in
 * `tests/e2e/layers/layers-workspace-evolution.spec.ts`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Document, NodeId, SceneNode } from '@varve/scene';
import { createDocument, makeGroupNode, makeShapeNode } from '@varve/scene';
import { describe, expect, test } from 'vitest';
import { getOrCreateParentCache } from '../../../scene/parentIndexCache';
import {
  collectContainerPreview,
  containerHasContent,
  MAX_CONTAINER_PREVIEW_NODES,
} from '../containerPreview';
import { DEFAULT_FILTER } from '../layerFilterTypes';
import { createSearchIndex, searchIndex } from '../layerSearchIndex';
import { flattenTree } from '../useFlatTree';

const PHASE = process.env.VARVE_LAYERS_PHASE ?? 'after';
const OUT = path.resolve('reports/layers-evolution', PHASE, 'perf');

function buildDoc(groups: number, perGroup: number): Document {
  const doc = createDocument(`${groups * perGroup} nodes`, true);
  const nodes: Record<NodeId, SceneNode> = {};
  const rootChildren: NodeId[] = [];
  let nextId = doc.nextId;

  for (let g = 0; g < groups; g++) {
    const children: NodeId[] = [];
    for (let i = 0; i < perGroup; i++) {
      const id = `n${nextId++}` as NodeId;
      nodes[id] = makeShapeNode(
        id,
        { kind: 'rect', x: (i % 50) * 12, y: Math.floor(i / 50) * 12, w: 10, h: 10 },
        { name: g % 7 === 0 && i % 10 === 0 ? `Button ${g}-${i}` : `Layer ${g}-${i}` },
      );
      children.push(id);
    }
    const gid = `n${nextId++}` as NodeId;
    nodes[gid] = makeGroupNode(gid, { name: `Group ${g + 1}`, children });
    rootChildren.push(gid);
  }

  return { ...doc, nextId, rootChildren, nodes };
}

function allExpanded(doc: Document): Set<NodeId> {
  return new Set(Object.keys(doc.nodes) as NodeId[]);
}

function best(fn: () => void, attempts = 3): number {
  let value = Infinity;
  for (let i = 0; i < attempts; i++) {
    const start = performance.now();
    fn();
    value = Math.min(value, performance.now() - start);
  }
  return value;
}

const SCALES: Array<[string, number, number]> = [
  ['1k', 20, 50],
  ['10k', 200, 50],
  ['50k', 500, 100],
];

describe('Layers — projection scale', () => {
  test('records flatten timings for 1k, 10k, 50k', () => {
    const result: Record<string, unknown> = {};
    for (const [label, groups, perGroup] of SCALES) {
      const doc = buildDoc(groups, perGroup);
      const expanded = allExpanded(doc);
      const total = groups * perGroup + groups;

      const unfiltered = best(() => void flattenTree(doc, expanded));
      const index = createSearchIndex(doc);
      const matched = new Set(searchIndex(index, 'Button'));
      const search = best(
        () => void flattenTree(doc, expanded, { ...DEFAULT_FILTER, search: 'Button' }, matched),
      );
      const kinds = best(
        () => void flattenTree(doc, expanded, { ...DEFAULT_FILTER, kinds: ['shape'] }),
      );

      // Workspace preset: the animated dimension restricts to a caller-set
      // id set (the same contract as the search-index path).
      const animatedIds = new Set(
        Object.keys(doc.nodes).filter((_, index) => index % 10 === 0) as NodeId[],
      );
      const animated = best(
        () =>
          void flattenTree(
            doc,
            expanded,
            { ...DEFAULT_FILTER, attributes: { animated: true } },
            animatedIds,
          ),
      );

      const count = flattenTree(doc, expanded).length;
      result[label] = {
        totalNodes: total,
        rows: count,
        flattenMs: Number(unfiltered.toFixed(2)),
        searchFlattenMs: Number(search.toFixed(2)),
        kindFlattenMs: Number(kinds.toFixed(2)),
        animatedFlattenMs: Number(animated.toFixed(2)),
      };
    }

    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, 'projection.json'), JSON.stringify(result, null, 2));

    expect(Object.keys(result)).toHaveLength(3);
  }, 600_000);

  test('container preview collector stays bounded on wide, deep, and many-container docs', () => {
    const result: Record<string, unknown> = {};

    // Wide: one group with 10 000 children — the collector must stop at the
    // budget rather than walking the subtree.
    {
      const doc = createDocument('wide', true);
      const children: NodeId[] = [];
      const nodes: Record<NodeId, SceneNode> = {};
      let nextId = doc.nextId;
      for (let i = 0; i < 10_000; i++) {
        const id = `n${nextId++}` as NodeId;
        nodes[id] = makeShapeNode(
          id,
          { kind: 'rect', x: (i % 100) * 6, y: Math.floor(i / 100) * 6, w: 5, h: 5 },
          { name: `Layer ${i}` },
        );
        children.push(id);
      }
      const gid = `n${nextId++}` as NodeId;
      nodes[gid] = makeGroupNode(gid, { name: 'Wide', children });
      const wide = { ...doc, nextId, rootChildren: [gid], nodes };
      // The parent cache is mandatory in practice: without it every
      // nodeWorldTransform call scans the document (measured at 41 ms per
      // container on an 11 k-node doc before this cache was threaded).
      const wideCache = getOrCreateParentCache(wide);
      const ms = best(() => void collectContainerPreview(wide, gid, { parentCache: wideCache }));
      const preview = collectContainerPreview(wide, gid, { parentCache: wideCache });
      result.wide10k = {
        collectMs: Number(ms.toFixed(2)),
        primitives: preview?.primitives.length,
        truncated: preview?.truncated,
      };
      expect(preview?.primitives.length).toBe(MAX_CONTAINER_PREVIEW_NODES);
      expect(preview?.truncated).toBe(true);
    }

    // Deep: 200 nested groups with one leaf at the bottom.
    {
      const doc = createDocument('deep', true);
      const nodes: Record<NodeId, SceneNode> = {};
      const depth = 200;
      const ids: NodeId[] = [];
      let nextId = doc.nextId;
      for (let i = 0; i < depth; i++) {
        ids.push(`n${nextId++}` as NodeId);
      }
      const leafId = `n${nextId++}` as NodeId;
      nodes[leafId] = makeShapeNode(
        leafId,
        { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        { name: 'Leaf' },
      );
      for (let i = depth - 1; i >= 0; i--) {
        const child = i === depth - 1 ? leafId : ids[i + 1]!;
        nodes[ids[i]!] = makeGroupNode(ids[i]!, { name: `G${i}`, children: [child] });
      }
      const deep = { ...doc, nextId, rootChildren: [ids[0]!], nodes };
      const deepCache = getOrCreateParentCache(deep);
      const ms = best(
        () => void collectContainerPreview(deep, ids[0]!, { parentCache: deepCache }),
      );
      result.deep200 = { collectMs: Number(ms.toFixed(2)) };
      expect(
        collectContainerPreview(deep, ids[0]!, { parentCache: deepCache })?.primitives,
      ).toHaveLength(1);
    }

    // Many containers: 1 000 groups × 10 children (11 000 nodes). The panel
    // collects once per mounted row, so 30 is a realistic visible window.
    {
      const many = buildDoc(1000, 10);
      const manyCache = getOrCreateParentCache(many);
      const ids = Object.keys(many.nodes).filter(
        (id) => (many.nodes[id as NodeId] as SceneNode).kind === 'group',
      ) as NodeId[];
      const window = ids.slice(0, 30);
      const ms = best(() => {
        for (const id of window) void collectContainerPreview(many, id, { parentCache: manyCache });
      });
      result.manyContainers = {
        containers: ids.length,
        windowRows: window.length,
        windowCollectMs: Number(ms.toFixed(2)),
        perContainerMs: Number((ms / window.length).toFixed(3)),
      };
      // The mounted window is what runs; the whole-document pass is the
      // pathological case the row gating prevents.
      const allMs = best(() => {
        for (const id of ids) void collectContainerPreview(many, id, { parentCache: manyCache });
      });
      result.manyContainers = {
        ...(result.manyContainers as Record<string, unknown>),
        allContainersMs: Number(allMs.toFixed(2)),
      };
    }

    // Empty-but-huge: content probe on a group whose 10 000 descendants are
    // all hidden — bounded by the scan limit.
    {
      const doc = createDocument('hidden', true);
      const children: NodeId[] = [];
      const nodes: Record<NodeId, SceneNode> = {};
      let nextId = doc.nextId;
      for (let i = 0; i < 10_000; i++) {
        const id = `n${nextId++}` as NodeId;
        nodes[id] = {
          ...makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 5, h: 5 }, { name: `H${i}` }),
          visible: false,
        } as SceneNode;
        children.push(id);
      }
      const gid = `n${nextId++}` as NodeId;
      nodes[gid] = makeGroupNode(gid, { name: 'Hidden', children });
      const hidden = { ...doc, nextId, rootChildren: [gid], nodes };
      const ms = best(() => void containerHasContent(hidden, nodes[gid]!));
      result.emptyProbe = { probeMs: Number(ms.toFixed(2)) };
      expect(containerHasContent(hidden, nodes[gid]!)).toBe(false);
    }

    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, 'containerPreview.json'), JSON.stringify(result, null, 2));
  }, 600_000);
});
