import type { PatternDefinition, SceneNode } from '@varve/scene';
import type { Affine } from '@varve/shared';

/** Move a top-level motif in the copied source scene without touching the document. */
export function translatePatternSourceRoot(
  definition: PatternDefinition,
  nodeId: string,
  dx: number,
  dy: number,
): PatternDefinition {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    throw new Error('Pattern motif movement must use finite coordinates.');
  }
  return updateVectorRoot(definition, nodeId, (node) => {
    if (!('transform' in node) || !Array.isArray(node.transform) || node.transform.length !== 6) {
      throw new Error('This pattern motif does not support transform editing.');
    }
    const transform = node.transform as Affine;
    if (!transform.every(Number.isFinite)) {
      throw new Error('This pattern motif has an invalid transform.');
    }
    return {
      ...node,
      transform: [
        transform[0],
        transform[1],
        transform[2],
        transform[3],
        transform[4] + dx,
        transform[5] + dy,
      ],
    } as SceneNode;
  });
}

/** Set the authored rotation of one root motif in the copied source scene. */
export function setPatternSourceRootRotation(
  definition: PatternDefinition,
  nodeId: string,
  rotation: number,
): PatternDefinition {
  if (!Number.isFinite(rotation)) throw new Error('Pattern motif rotation must be finite.');
  return updateVectorRoot(definition, nodeId, (node) => ({ ...node, rotation }) as SceneNode);
}

function updateVectorRoot(
  definition: PatternDefinition,
  nodeId: string,
  update: (node: SceneNode) => SceneNode,
): PatternDefinition {
  const source = definition.source;
  if (source.kind !== 'vector') {
    throw new Error('Only vector pattern sources contain editable motifs.');
  }
  if (!source.rootIds.includes(nodeId)) {
    throw new Error('Pattern motif edits must target a canonical source root.');
  }
  const node = source.nodes[nodeId];
  if (!node) throw new Error(`Pattern source motif "${nodeId}" is missing.`);
  return {
    ...definition,
    source: {
      ...source,
      nodes: { ...source.nodes, [nodeId]: update(node) },
    },
  };
}
