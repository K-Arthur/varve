import type { Document, NodeId, SceneNode } from '@varve/scene';
import {
  buildParentIndexMap,
  createDocument,
  isContainer,
  makeShapeNode,
  nodeWorldBounds as sceneNodeWorldBounds,
} from '@varve/scene';
import type { Affine, Rect } from '@varve/shared';
import { generateKeyBetween } from '@varve/shared';
import { bench, describe } from 'vitest';
import { buildSpatialIndex, queryPoint, queryRect } from '../spatialIndex';

const AREA_SIZE = 10000;

/**
 * Attach many root-level nodes in one pass.
 *
 * `addNode` spreads `doc.nodes` and `doc.rootChildren` on every call, so
 * folding it over a loop is O(n^2). At the 20,000-node tier that is ~400M
 * property copies *at module scope*, i.e. during collection — which is why
 * `pnpm bench` hung before any benchmark reported a number (finding P3-14).
 * The fixture is not the thing under measurement, so it is built directly.
 *
 * The result is equivalent to the fold: nodes carry the same `index`, and
 * `order` keys stay ascending via the same `generateKeyBetween` chain.
 */
function withRootNodes(doc: Document, nodes: SceneNode[]): Document {
  const indexed: Record<string, SceneNode> = { ...doc.nodes };
  const rootChildren = [...doc.rootChildren];
  let prevOrder: string | null =
    rootChildren.length > 0
      ? (doc.nodes[rootChildren[rootChildren.length - 1]!]?.order ?? null)
      : null;
  for (const node of nodes) {
    const order = generateKeyBetween(prevOrder, null);
    prevOrder = order;
    indexed[node.id] = { ...node, index: rootChildren.length, order } as SceneNode;
    rootChildren.push(node.id);
  }
  return { ...doc, nodes: indexed, rootChildren } as Document;
}

function generateUniform(count: number, areaSize: number): Document {
  const nodes: SceneNode[] = [];
  for (let i = 0; i < count; i++) {
    const x = Math.random() * areaSize;
    const y = Math.random() * areaSize;
    const w = 20 + Math.random() * 60;
    const h = 20 + Math.random() * 60;
    nodes.push(
      makeShapeNode(
        `u${i}` as NodeId,
        { kind: 'rect', x: 0, y: 0, w, h },
        { name: `U${i}`, transform: [1, 0, 0, 1, x, y] as Affine },
      ),
    );
  }
  return withRootNodes(createDocument(), nodes);
}

function generateDenseCluster(
  count: number,
  centerX: number,
  centerY: number,
  spread: number,
): Document {
  const nodes: SceneNode[] = [];
  for (let i = 0; i < count; i++) {
    const x = centerX + Math.random() * spread - spread / 2;
    const y = centerY + Math.random() * spread - spread / 2;
    const w = 10 + Math.random() * 40;
    const h = 10 + Math.random() * 40;
    nodes.push(
      makeShapeNode(
        `d${i}` as NodeId,
        { kind: 'rect', x: 0, y: 0, w, h },
        { name: `D${i}`, transform: [1, 0, 0, 1, x, y] as Affine },
      ),
    );
  }
  return withRootNodes(createDocument(), nodes);
}

function naiveQueryRect(doc: Document, rect: Rect): NodeId[] {
  const result: NodeId[] = [];
  const parentIndex = buildParentIndexMap(doc);
  for (const id of Object.keys(doc.nodes)) {
    const node = doc.nodes[id as NodeId]!;
    if (isContainer(node)) continue;
    const bounds = sceneNodeWorldBounds(doc, id as NodeId, parentIndex);
    if (!bounds) continue;
    if (
      bounds.x < rect.x + rect.w &&
      bounds.x + bounds.w > rect.x &&
      bounds.y < rect.y + rect.h &&
      bounds.y + bounds.h > rect.y
    ) {
      result.push(id as NodeId);
    }
  }
  return result;
}

function naiveQueryPoint(doc: Document, x: number, y: number): NodeId[] {
  const result: NodeId[] = [];
  const parentIndex = buildParentIndexMap(doc);
  for (const id of Object.keys(doc.nodes)) {
    const node = doc.nodes[id as NodeId]!;
    if (isContainer(node)) continue;
    const bounds = sceneNodeWorldBounds(doc, id as NodeId, parentIndex);
    if (!bounds) continue;
    if (x >= bounds.x && x <= bounds.x + bounds.w && y >= bounds.y && y <= bounds.y + bounds.h) {
      result.push(id as NodeId);
    }
  }
  return result;
}

function buildReusableDoc(count: number, areaSize: number): Document {
  const nodes: SceneNode[] = [];
  for (let i = 0; i < count; i++) {
    const x = Math.random() * areaSize;
    const y = Math.random() * areaSize;
    const w = 20 + Math.random() * 60;
    const h = 20 + Math.random() * 60;
    nodes.push(
      makeShapeNode(
        `r${i}` as NodeId,
        { kind: 'rect', x: 0, y: 0, w, h },
        { name: `R${i}`, transform: [1, 0, 0, 1, x, y] as Affine },
      ),
    );
  }
  return withRootNodes(createDocument(), nodes);
}

describe('buildSpatialIndex — uniform distribution', () => {
  for (const count of [10, 100, 1000, 5000, 20000]) {
    const doc = generateUniform(count, AREA_SIZE);
    bench(`uniform ${count} nodes`, () => {
      buildSpatialIndex(doc);
    });
  }
});

describe('buildSpatialIndex — dense clusters', () => {
  for (const count of [100, 1000, 5000]) {
    const doc = generateDenseCluster(count, 5000, 5000, 300);
    bench(`dense cluster ${count} nodes in 300px area`, () => {
      buildSpatialIndex(doc);
    });
  }
});

describe('buildSpatialIndex — large empty areas', () => {
  const sparse: SceneNode[] = [];
  for (let i = 0; i < 100; i++) {
    const x = Math.random() * 100000;
    const y = Math.random() * 100000;
    sparse.push(
      makeShapeNode(
        `s${i}` as NodeId,
        { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
        { name: `S${i}`, transform: [1, 0, 0, 1, x, y] as Affine },
      ),
    );
  }
  const doc = withRootNodes(createDocument(), sparse);
  bench('sparse 100 nodes across 100k x 100k canvas', () => {
    buildSpatialIndex(doc);
  });
});

describe('queryRect — spatial index vs naive scan', () => {
  for (const count of [100, 1000, 5000]) {
    const doc = buildReusableDoc(count, AREA_SIZE);
    const index = buildSpatialIndex(doc);
    const queryBounds: Rect = { x: 4000, y: 4000, w: 1000, h: 1000 };

    bench(`queryRect spatial ${count}`, () => {
      queryRect(index, queryBounds);
    });

    bench(`queryRect naive ${count}`, () => {
      naiveQueryRect(doc, queryBounds);
    });
  }
});

describe('queryPoint — spatial index vs naive scan', () => {
  for (const count of [100, 1000, 5000]) {
    const doc = buildReusableDoc(count, AREA_SIZE);
    const index = buildSpatialIndex(doc);
    const px = 4500;
    const py = 4500;

    bench(`queryPoint spatial ${count}`, () => {
      queryPoint(index, px, py);
    });

    bench(`queryPoint naive ${count}`, () => {
      naiveQueryPoint(doc, px, py);
    });
  }
});

describe('queryRect — deep zoom levels', () => {
  const doc = buildReusableDoc(1000, AREA_SIZE);
  const index = buildSpatialIndex(doc);

  for (const zoom of [0.01, 0.1, 1, 10, 100]) {
    const viewSize = 2000 / zoom;
    const rect: Rect = {
      x: 5000 - viewSize / 2,
      y: 5000 - viewSize / 2,
      w: viewSize,
      h: viewSize,
    };
    bench(`zoom=${zoom} viewSize=${viewSize.toFixed(0)}px`, () => {
      queryRect(index, rect);
    });
  }
});

describe('queryRect — frequent viewport movement (panning)', () => {
  const doc = buildReusableDoc(1000, AREA_SIZE);
  const index = buildSpatialIndex(doc);
  const positions: Rect[] = Array.from({ length: 100 }, (_, i) => ({
    x: 1000 + i * 80,
    y: 1000 + i * 60,
    w: 800,
    h: 600,
  }));

  bench('pan 100 positions', () => {
    for (const pos of positions) {
      queryRect(index, pos);
    }
  });
});

describe('queryRect — incremental finding updates', () => {
  const doc = buildReusableDoc(1000, AREA_SIZE);
  const index = buildSpatialIndex(doc);
  const smallRect: Rect = { x: 4950, y: 4950, w: 100, h: 100 };
  const largeRect: Rect = { x: 3000, y: 3000, w: 4000, h: 4000 };

  bench('queryRect small rect (few cells)', () => {
    queryRect(index, smallRect);
  });

  bench('queryRect large rect (many cells)', () => {
    queryRect(index, largeRect);
  });
});

describe('overlay-scale finding counts', () => {
  for (const count of [5000, 20000]) {
    const doc = generateUniform(count, AREA_SIZE * 2);
    const index = buildSpatialIndex(doc);
    const viewport: Rect = { x: 5000, y: 5000, w: 2000, h: 2000 };

    bench(`overlay cull ${count} findings`, () => {
      queryRect(index, viewport);
    });
  }
});

describe('overlay-scale dense cluster', () => {
  const doc = generateDenseCluster(5000, 10000, 10000, 500);
  const index = buildSpatialIndex(doc);
  const viewport: Rect = { x: 9500, y: 9500, w: 2000, h: 2000 };

  bench('dense 5k cluster viewport cull', () => {
    queryRect(index, viewport);
  });
});
