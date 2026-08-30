/**
 * Safe, identity-preserving transfer of node-local appearance stacks.
 *
 * The editor exposes this through layer-row badges: users can drag a stack to
 * another layer, or select destination layers and activate the same badge by
 * keyboard. This intentionally replaces only the matching stack on the
 * destination (Layer Effects or Object Filters), leaving every other aspect
 * of both layers unchanged.
 */

import type { Adjustment } from '@varve/engine';
import type { Document } from './document';
import { detectCompositingCycles, validateEffectMaskBinding } from './effectMasks';
import { cloneEffects } from './effects';
import { canHaveSmartFilters, cloneSmartFilters } from './smartFilters';
import type { Effect, NodeId, SceneNode } from './types';

export type EffectStackKind = 'layer-effects' | 'object-filters';
/** Replace the target stack, or append a copied segment after its entries. */
export type EffectStackTransferMode = 'replace' | 'append';

export type EffectStackPayload =
  | {
      kind: 'layer-effects';
      effects: Effect[];
    }
  | {
      kind: 'object-filters';
      smartFilters: Adjustment[];
      smartFiltersEnabled: boolean;
    };

export interface EffectStackTransferResult {
  /** Replacement node, with all copied entry IDs freshly minted. */
  node: SceneNode;
  /** Number of stack entries now owned by the destination. */
  entryCount: number;
  /** Effect masks omitted because they are invalid on the new owner. */
  omittedMaskCount: number;
  /**
   * A bypassed Object Filter stack has no segment-level bypass field once it
   * is appended. Its copied entries are therefore individually hidden so the
   * destination preserves the source's rendered state.
   */
  convertedBypassedObjectFilterCount: number;
}

export interface EffectStackBatchTransferResult {
  /** The original document when no compatible target could be updated. */
  document: Document;
  /** False when the source is missing, incompatible, or has an empty stack. */
  sourceHasStack: boolean;
  /** Destination ids whose matching stack was replaced. */
  copiedTargetIds: NodeId[];
  /** Source, missing, or incompatible target ids that were not changed. */
  skippedTargetIds: NodeId[];
  /** Entry count of the source stack. */
  entryCount: number;
  /** Number of copied layer-effect masks safely omitted across all targets. */
  omittedMaskCount: number;
  /** Number of bypassed Object Filters converted to hidden entries on append. */
  convertedBypassedObjectFilterCount: number;
}

type EffectOwner = Extract<SceneNode, { effects: Effect[] }>;

function canHaveLayerEffects(node: SceneNode): node is EffectOwner {
  return 'effects' in node && Array.isArray(node.effects);
}

/** Whether a node can receive a particular source stack. */
export function canReceiveEffectStack(node: SceneNode, kind: EffectStackKind): boolean {
  return kind === 'layer-effects' ? canHaveLayerEffects(node) : canHaveSmartFilters(node);
}

/**
 * Capture an independent snapshot of a non-empty stack from a source node.
 * The snapshot is cloned again for each destination so one multi-target copy
 * cannot accidentally share entry ids between target layers.
 */
export function createEffectStackPayload(
  source: SceneNode,
  kind: EffectStackKind,
): EffectStackPayload | null {
  if (kind === 'layer-effects') {
    if (!canHaveLayerEffects(source) || source.effects.length === 0) return null;
    return { kind, effects: cloneEffects(source.effects) };
  }

  const smartFilters = source.smartFilters ?? [];
  if (!canHaveSmartFilters(source) || smartFilters.length === 0) return null;
  return {
    kind,
    smartFilters: cloneSmartFilters(smartFilters),
    smartFiltersEnabled: source.smartFiltersEnabled !== false,
  };
}

function withoutInvalidMasks(
  doc: Document,
  target: EffectOwner,
  effects: readonly Effect[],
  initialEffects: readonly Effect[] = [],
): { effects: Effect[]; omittedMaskCount: number } {
  const accepted: Effect[] = [...initialEffects];
  let omittedMaskCount = 0;

  for (const effect of effects) {
    if (!effect.mask) {
      accepted.push(effect);
      continue;
    }

    const maskError = validateEffectMaskBinding(doc, target.id, effect.mask);
    const candidateNode = { ...target, effects: [...accepted, effect] } as EffectOwner;
    const candidateDoc: Document = {
      ...doc,
      nodes: { ...doc.nodes, [target.id]: candidateNode },
    };
    if (maskError || detectCompositingCycles(candidateDoc).length > 0) {
      const { mask: _mask, ...effectWithoutMask } = effect;
      accepted.push(effectWithoutMask as Effect);
      omittedMaskCount++;
      continue;
    }

    accepted.push(effect);
  }

  return { effects: accepted, omittedMaskCount };
}

/**
 * Replace one compatible stack on a destination node. The source is not part
 * of this operation; callers retain it untouched and can safely reuse the
 * same payload across several targets.
 */
export function applyEffectStackPayload(
  doc: Document,
  targetNodeId: NodeId,
  payload: EffectStackPayload,
  mode: EffectStackTransferMode = 'replace',
): EffectStackTransferResult | null {
  const target = doc.nodes[targetNodeId];
  if (!target || !canReceiveEffectStack(target, payload.kind)) return null;

  if (payload.kind === 'object-filters') {
    const copiedFilters = cloneSmartFilters(payload.smartFilters);
    const preserveBypassedSource = mode === 'append' && !payload.smartFiltersEnabled;
    const incomingFilters = preserveBypassedSource
      ? copiedFilters.map((filter) => ({ ...filter, visible: false }))
      : copiedFilters;
    const smartFilters =
      mode === 'append' ? [...(target.smartFilters ?? []), ...incomingFilters] : incomingFilters;
    return {
      node: {
        ...target,
        smartFilters,
        // Appending merges the two sets under the destination's single
        // stack-level bypass. Replacing can faithfully carry the source's.
        smartFiltersEnabled:
          mode === 'append' ? target.smartFiltersEnabled !== false : payload.smartFiltersEnabled,
      },
      entryCount: copiedFilters.length,
      omittedMaskCount: 0,
      convertedBypassedObjectFilterCount: preserveBypassedSource ? copiedFilters.length : 0,
    };
  }

  if (!canHaveLayerEffects(target)) return null;
  const { effects, omittedMaskCount } = withoutInvalidMasks(
    doc,
    target,
    cloneEffects(payload.effects),
    mode === 'append' ? target.effects : [],
  );
  return {
    node: { ...target, effects },
    entryCount: payload.effects.length,
    omittedMaskCount,
    convertedBypassedObjectFilterCount: 0,
  };
}

/**
 * Copy a source stack to several destination nodes as one immutable document
 * update. Each target gets independent ids, and later targets are validated
 * against earlier replacements so copied mask references cannot form a cycle
 * across a multi-layer transfer.
 */
export function transferEffectStackToNodes(
  doc: Document,
  sourceNodeId: NodeId,
  targetNodeIds: readonly NodeId[],
  kind: EffectStackKind,
  mode: EffectStackTransferMode = 'replace',
): EffectStackBatchTransferResult {
  const source = doc.nodes[sourceNodeId];
  const payload = source ? createEffectStackPayload(source, kind) : null;
  if (!payload) {
    return {
      document: doc,
      sourceHasStack: false,
      copiedTargetIds: [],
      skippedTargetIds: [],
      entryCount: 0,
      omittedMaskCount: 0,
      convertedBypassedObjectFilterCount: 0,
    };
  }

  let nextDoc = doc;
  const copiedTargetIds: NodeId[] = [];
  const skippedTargetIds: NodeId[] = [];
  let omittedMaskCount = 0;
  let convertedBypassedObjectFilterCount = 0;
  for (const targetNodeId of new Set(targetNodeIds)) {
    if (targetNodeId === sourceNodeId) {
      skippedTargetIds.push(targetNodeId);
      continue;
    }
    const result = applyEffectStackPayload(nextDoc, targetNodeId, payload, mode);
    if (!result) {
      skippedTargetIds.push(targetNodeId);
      continue;
    }
    nextDoc = {
      ...nextDoc,
      nodes: { ...nextDoc.nodes, [targetNodeId]: result.node },
    };
    copiedTargetIds.push(targetNodeId);
    omittedMaskCount += result.omittedMaskCount;
    convertedBypassedObjectFilterCount += result.convertedBypassedObjectFilterCount;
  }

  return {
    document: nextDoc,
    sourceHasStack: true,
    copiedTargetIds,
    skippedTargetIds,
    entryCount:
      payload.kind === 'layer-effects' ? payload.effects.length : payload.smartFilters.length,
    omittedMaskCount,
    convertedBypassedObjectFilterCount,
  };
}
