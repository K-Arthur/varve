/**
 * Ordering facade — generates deterministic ordering keys for scene nodes.
 *
 * Wraps the `fractional-indexing` package (David Greenspan's base-62 midpoint
 * algorithm, proven in Figma, Linear, and Jazz) for CRDT-safe concurrent
 * editing. O(1) insertions between any two keys without renumbering neighbours.
 *
 * The facade preserves the same API surface as the old zero-padded integer
 * implementation, making this a transparent swap for callers.
 *
 * Research basis: Greenspan "fractional-indexing" — base-62 midpoint between
 * ordered keys. Phase 2 (real CRDT) replaces the per-node `index: number`
 * field with exclusive use of `order: OrderKey`. Phase 1 hybrid: array-order
 * is truth for paint order, `order` is generated on insert for future
 * migration.
 */

import {
  generateKeyBetween as fiBetween,
  generateNKeysBetween as fiNBetween,
} from 'fractional-indexing';

export type OrderKey = string;

/**
 * Generate an ordering key between `a` and `b`.
 * - `generateKeyBetween(null, 'b')` → key before 'b'
 * - `generateKeyBetween('a', null)` → key after 'a'
 * - `generateKeyBetween('a', 'b')` → key between 'a' and 'b'
 *
 * When both are null, returns the default starting key ('a0' per fractional-indexing).
 */
export function generateKeyBetween(a: OrderKey | null, b: OrderKey | null): OrderKey {
  return fiBetween(a, b);
}

/**
 * Generate `n` ordering keys between `a` and `b`.
 */
export function generateNKeysBetween(
  a: OrderKey | null,
  b: OrderKey | null,
  n: number,
): OrderKey[] {
  return fiNBetween(a, b, n);
}

/** Alias for `generateKeyBetween`. */
export function midPoint(a: OrderKey, b: OrderKey): OrderKey {
  return fiBetween(a, b);
}
