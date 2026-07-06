/**
 * Smart Animate bridge — computes layer match values for screen transitions.
 */
import type { Document, NodeId } from '@strata/scene';
import { buildSmartAnimateValues, matchLayersByName } from '@strata/prototype';

export interface SmartAnimateTransition {
  fromScreenId: NodeId;
  toScreenId: NodeId;
  values: Record<string, Record<string, unknown>>;
}

/** Compute smart-animate property deltas between two frame screens. */
export function computeSmartAnimateTransition(
  doc: Document,
  fromScreenId: NodeId,
  toScreenId: NodeId,
): SmartAnimateTransition | null {
  const matches = matchLayersByName(doc.nodes, fromScreenId, toScreenId);
  if (matches.length === 0) return null;
  const values = buildSmartAnimateValues(doc.nodes, matches);
  return { fromScreenId, toScreenId, values };
}
