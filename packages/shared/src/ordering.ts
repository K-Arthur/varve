/**
 * Ordering facade — generates deterministic ordering keys for scene nodes.
 *
 * Current implementation: zero-padded array-index strings ("0001", "0002").
 * Phase 2 replaces this with real fractional-index (base-62 midpoint) for
 * CRDT-safe concurrent editing. The API contract stays the same.
 *
 * Research basis: David Greenspan's fractional-indexing (Figma, Linear, Jazz)
 * for O(1) insertions between any two keys without renumbering neighbours.
 */
export type OrderKey = string;

/**
 * Generate an ordering key between `a` and `b`.
 * - `generateKeyBetween(null, '0005')` → key before '0005'
 * - `generateKeyBetween('0005', null)` → key after '0005'
 * - `generateKeyBetween('0005', '0010')` → key between
 *
 * Current impl: array-index facade. Real fractional-index in Phase 2.
 */
export function generateKeyBetween(a: OrderKey | null, b: OrderKey | null): OrderKey {
  if (a === null && b === null) return '0000';
  if (a === null) {
    const bi = toNumber(b ?? '0000');
    if (bi <= 0) return '0000';
    return pad(Math.floor(bi / 2));
  }
  if (b === null) {
    const ai = toNumber(a);
    return pad(ai + 1000);
  }
  const ai = toNumber(a);
  const bi = toNumber(b);
  const mid = Math.floor((ai + bi) / 2);
  if (mid === ai || mid === bi) {
    return pad(bi + 1);
  }
  return pad(mid);
}

export function generateNKeysBetween(
  a: OrderKey | null,
  b: OrderKey | null,
  n: number,
): OrderKey[] {
  const first = generateKeyBetween(a, b);
  const keys: OrderKey[] = [first];
  for (let i = 1; i < n; i++) {
    const prev = keys[i - 1];
    if (!prev) break;
    keys.push(generateKeyBetween(prev, b));
  }
  return keys;
}

export function midPoint(a: OrderKey, b: OrderKey): OrderKey {
  return generateKeyBetween(a, b);
}

function toNumber(s: string): number {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function pad(n: number): string {
  return String(n).padStart(4, '0');
}
