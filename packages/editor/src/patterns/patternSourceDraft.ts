import {
  type Document,
  type PatternDefinition,
  type SceneNode,
  updatePatternDefinition,
} from '@varve/scene';
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
    const x = transform[4] + dx;
    const y = transform[5] + dy;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Pattern motif movement exceeds finite coordinates.');
    }
    return {
      ...node,
      transform: [transform[0], transform[1], transform[2], transform[3], x, y],
    } as SceneNode;
  });
}

/** Check the document and definition captured when a source draft was opened. */
export function getPatternSourceDraftStatus(
  document: Pick<Document, 'id' | 'patternDefinitions'>,
  definitionId: string,
  expectedDocumentId: string,
  expectedRevision: number,
): 'ready' | 'document-changed' | 'missing' | 'stale' {
  if (document.id !== expectedDocumentId) return 'document-changed';
  const current = document.patternDefinitions?.[definitionId];
  if (!current) return 'missing';
  if (current.revision !== expectedRevision) return 'stale';
  return 'ready';
}

/** Apply a draft to the latest document while rejecting document/source conflicts. */
export function applyPatternSourceDraft(
  document: Document,
  draft: PatternDefinition,
  expectedDocumentId: string,
  expectedRevision: number,
): { status: 'ready' | 'document-changed' | 'missing' | 'stale'; document: Document } {
  const status = getPatternSourceDraftStatus(
    document,
    draft.id,
    expectedDocumentId,
    expectedRevision,
  );
  if (status !== 'ready') return { status, document };
  return {
    status,
    document: updatePatternDefinition(document, draft.id, (current) => ({
      ...current,
      source: draft.source,
    })),
  };
}

/** Rebase a source draft and compile its cached preview from that same document revision. */
export function applyPatternSourceDraftWithPreview(
  document: Document,
  draft: PatternDefinition,
  expectedDocumentId: string,
  expectedRevision: number,
  compilePreview: (document: Document, definition: PatternDefinition) => string,
): {
  status: 'ready' | 'document-changed' | 'missing' | 'stale' | 'preview-failed';
  document: Document;
  error?: unknown;
} {
  const applied = applyPatternSourceDraft(document, draft, expectedDocumentId, expectedRevision);
  if (applied.status !== 'ready') return applied;

  const definition = applied.document.patternDefinitions?.[draft.id];
  if (!definition) return { status: 'missing', document };

  let previewSrc: string;
  try {
    previewSrc = compilePreview(applied.document, definition);
    if (!previewSrc) throw new Error('The pattern preview is empty.');
  } catch (error) {
    return { status: 'preview-failed', document, error };
  }

  return {
    status: 'ready',
    document: {
      ...applied.document,
      patternDefinitions: {
        ...applied.document.patternDefinitions,
        [draft.id]: {
          ...definition,
          previewSrc,
          previewRevision: definition.revision,
        },
      },
    },
  };
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
