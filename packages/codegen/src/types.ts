/**
 * Shared types for the codegen emitter system.
 *
 * Kept in a separate module so emitters can import them without
 * creating a circular dependency through index.ts.
 */

import type { Document, SceneNode } from '@strata/scene';

/** A feature that a node uses which the target format cannot represent faithfully. */
export interface TargetGap {
  nodeId: string;
  nodeName: string;
  feature: string;
  severity: 'warning' | 'error';
  fallback?: string;
}

/**
 * A code emitter — wraps a single export function with a companion
 * `targetGaps()` that reports unsupported features for a given node.
 */
export interface CodeEmitter<O = unknown> {
  format: string;
  emit(node: SceneNode, doc: Document, opts?: O): string;
  targetGaps(node: SceneNode, doc: Document): TargetGap[];
}
