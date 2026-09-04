/**
 * Selection-state helpers for the Inspector.
 *
 * The Inspector renders one of three shapes: empty (document props), single
 * (full property set), or multi (shared union with "Mixed" placeholders).
 * `summarize` derives the shape; `commonValue` powers the "Mixed" affordance
 * (WCAG 1.4.1 — never by colour alone: a literal "—" + aria-valuetext="Mixed
 * values" is conveyed to assistive tech).
 *
 * Research basis: Figma / Affinity multi-select inspector behaviour.
 */
import type { SceneNode } from '@varve/scene';
import { classifySelectionProperty, samePropertyValue } from '../propertyState';

export type SelectionKind = 'empty' | 'single' | 'multi';

export interface SelectionSummary {
  kind: SelectionKind;
  count: number;
  /** Present only when every selected node shares the same kind. */
  sharedKind?: SceneNode['kind'];
}

export function summarize(nodes: SceneNode[]): SelectionSummary {
  if (nodes.length === 0) return { kind: 'empty', count: 0 };
  if (nodes.length === 1) return { kind: 'single', count: 1, sharedKind: nodes[0]?.kind };
  const first = nodes[0]?.kind;
  const homogeneous = nodes.every((n) => n.kind === first);
  return {
    kind: 'multi',
    count: nodes.length,
    sharedKind: homogeneous ? first : undefined,
  };
}

/** Sentinel for "values differ across the selection". */
export const MIXED = Symbol('strata.inspector.mixed');

export type MaybeMixed<T> = T | typeof MIXED;

/**
 * Read an accessor across the selection. Returns the common value when every
 * node agrees, or MIXED when they differ. Used to drive NumberField's `mixed`
 * prop and to gate batch edits.
 */
export function commonValue<T>(nodes: SceneNode[], accessor: (n: SceneNode) => T): MaybeMixed<T> {
  const state = classifySelectionProperty(nodes.map(accessor), { equals: samePropertyValue });
  if (state.kind === 'common') return state.value;
  // Preserve this legacy helper's return shape for callers that use undefined
  // as a meaningful “not configured” value. New controls should consume the
  // explicit `unset` state from classifySelectionProperty instead.
  if (state.kind === 'unset') return undefined as T;
  return MIXED;
}

/** True when the value is the MIXED sentinel. Narrows the type for callers. */
export function isMixed<T>(v: MaybeMixed<T>): v is typeof MIXED {
  return v === MIXED;
}
