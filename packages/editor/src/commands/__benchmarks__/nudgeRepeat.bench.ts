import {
  createDocument,
  type Document,
  makeShapeNode,
  type NodeId,
  type SceneNode,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import { bench, describe } from 'vitest';
import { createNudgeGestureSession, planNudge, planNudgeRepeat } from '../nudge';

const DOCUMENT_NODE_COUNT = 10_000;

function makeDocument(nodeCount: number): Document {
  const base = createDocument('nudge repeat benchmark');
  const nodes: Record<NodeId, SceneNode> = { ...base.nodes };
  const rootChildren = [...base.rootChildren];

  for (let index = 0; index < nodeCount; index += 1) {
    const id = `nudge-${index}` as NodeId;
    nodes[id] = makeShapeNode(
      id,
      { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
      { name: id, transform: [1, 0, 0, 1, index * 24, 0] as Affine },
    );
    rootChildren.push(id);
  }

  return { ...base, nodes, rootChildren };
}

function applyPositions(
  document: Document,
  positions: ReadonlyArray<{ id: NodeId; x: number; y: number }>,
): Document {
  const nodes = { ...document.nodes };
  for (const position of positions) {
    const node = nodes[position.id];
    if (!node) continue;
    nodes[position.id] = {
      ...node,
      transform: [
        node.transform[0],
        node.transform[1],
        node.transform[2],
        node.transform[3],
        position.x,
        position.y,
      ] as Affine,
    };
  }
  return { ...document, nodes };
}

describe('keyboard nudge repeat planning', () => {
  for (const selectionCount of [1, 10, 100, 1_000]) {
    const selection = Array.from(
      { length: selectionCount },
      (_, index) => `nudge-${index}` as NodeId,
    );
    let freshDocument = makeDocument(DOCUMENT_NODE_COUNT);
    let repeatDocument = makeDocument(DOCUMENT_NODE_COUNT);
    const first = planNudge('right', 1, repeatDocument, selection);
    const session = createNudgeGestureSession(repeatDocument, selection, first);
    if (!session) throw new Error('benchmark fixture must produce a nudge session');
    repeatDocument = applyPositions(repeatDocument, first.positions);

    bench(
      `fresh plan + batch mutation (${selectionCount} selected / ${DOCUMENT_NODE_COUNT} nodes)`,
      () => {
        const plan = planNudge('right', 1, freshDocument, selection);
        freshDocument = applyPositions(freshDocument, plan.positions);
      },
    );

    bench(
      `held-key repeat + batch mutation (${selectionCount} selected / ${DOCUMENT_NODE_COUNT} nodes)`,
      () => {
        const plan = planNudgeRepeat(session, 'right', 1, repeatDocument, selection);
        if (!plan)
          throw new Error('repeat session must remain valid during its own batch mutation');
        repeatDocument = applyPositions(repeatDocument, plan.positions);
      },
    );
  }
});
