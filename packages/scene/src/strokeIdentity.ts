import type { Stroke } from './types';

let strokeIdCounter = 0;

/** Mint an identity for a newly-created stroke instance. */
export function createStrokeId(prefix = 'stroke'): string {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  strokeIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${strokeIdCounter.toString(36)}`;
}

/** Deterministic identity used when opening a legacy document without IDs. */
export function legacyStrokeId(nodeId: string, index: number): string {
  return `stroke-${nodeId}-${index}`;
}

/**
 * Add stable per-node identities without changing authored stroke values.
 * Existing valid IDs are preserved, including through reorder operations.
 */
export function normalizeStrokeIds(
  nodeId: string,
  strokes: Stroke[] | undefined,
): Stroke[] | undefined {
  if (!strokes) return strokes;
  const used = new Set<string>();
  return strokes.map((stroke, index) => {
    const requested =
      typeof stroke.id === 'string' && stroke.id.trim() ? stroke.id : legacyStrokeId(nodeId, index);
    let id = requested;
    let suffix = 2;
    while (used.has(id)) {
      id = `${requested}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    return stroke.id === id ? stroke : { ...stroke, id };
  });
}

/** Use for a copied style so a destination owns independent stroke instances. */
export function cloneStrokesWithFreshIds(strokes: Stroke[]): Stroke[] {
  return strokes.map((stroke) => ({ ...stroke, id: createStrokeId() }));
}
