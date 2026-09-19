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
});
