import type { Document, SceneNode } from '@varve/scene';

export interface EffectPreviewSession {
  /** Stable identity for one mounted draft session. */
  readonly sessionId: string;
  readonly documentId: string;
  readonly ownerId: string;
  readonly targetIds: readonly string[];
  readonly treatmentId: string;
  readonly instanceId: string;
  readonly baselineRevision: number;
  /** Monotonic generation; draft document revisions are intentionally not used. */
  readonly generation: number;
  readonly ownedFilterIds: readonly string[];
}

export interface EffectPreviewSessionInput {
  sessionId: string;
  document: Document;
  targetIds: readonly string[];
  treatmentId: string;
  instanceId: string;
  baselineRevision: number;
  generation: number;
  ownedFilterIds: readonly string[];
}

export function createEffectPreviewSession(input: EffectPreviewSessionInput): EffectPreviewSession {
  return {
    sessionId: input.sessionId,
    documentId: input.document.id,
    ownerId: input.targetIds[0] ?? '',
    targetIds: [...input.targetIds],
    treatmentId: input.treatmentId,
    instanceId: input.instanceId,
    baselineRevision: input.baselineRevision,
    generation: input.generation,
    ownedFilterIds: [...input.ownedFilterIds],
  };
}

export function matchesEffectPreviewSession(
  session: EffectPreviewSession,
  current: Pick<
    EffectPreviewSession,
    'documentId' | 'ownerId' | 'treatmentId' | 'instanceId' | 'generation'
  >,
): boolean {
  return (
    session.documentId === current.documentId &&
    session.ownerId === current.ownerId &&
    session.treatmentId === current.treatmentId &&
    session.instanceId === current.instanceId &&
    session.generation === current.generation
  );
}

/**
 * Remove only the filters created by this preview from the current document.
 * This is intentionally a narrow reconciliation: unrelated edits made while
 * the preview was open stay on the current owner, and a deleted owner is not
 * resurrected from the baseline.
 */
export function reconcileEffectPreviewCancel(
  baseline: Document,
  current: Document,
  session: EffectPreviewSession,
): Document {
  if (baseline.id !== current.id || !session.ownerId) return current;
  const currentNode = current.nodes[session.ownerId];
  if (!currentNode) return current;
  const ownedIds = new Set(session.ownedFilterIds);
  if (ownedIds.size === 0) return current;
  const currentFilters = currentNode.smartFilters ?? [];
  if (!currentFilters.some((filter) => ownedIds.has(filter.id))) return current;

  const nextFilters = currentFilters.filter((filter) => !ownedIds.has(filter.id));
  let nextNode: SceneNode = { ...currentNode, smartFilters: nextFilters };

  // Preview insertion enables the stack. Restore that flag only when it still
  // has the preview's value; an external bypass change remains authoritative.
  if (currentNode.smartFiltersEnabled === true) {
    const baselineNode = baseline.nodes[session.ownerId];
    if (baselineNode?.smartFiltersEnabled === undefined) {
      const { smartFiltersEnabled: _ignored, ...withoutStackFlag } = nextNode;
      nextNode = withoutStackFlag as SceneNode;
    } else {
      nextNode = {
        ...nextNode,
        smartFiltersEnabled: baselineNode.smartFiltersEnabled,
      };
    }
  }

  return {
    ...current,
    nodes: { ...current.nodes, [session.ownerId]: nextNode },
  };
}
