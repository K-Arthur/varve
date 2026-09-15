/**
 * Module-level overlay state for the retouch tools.
 *
 * The tools own the live source anchor; the canvas overlay owns presentation.
 * A tiny external store keeps the clone/heal source marker and cursor in sync
 * without routing per-pointer-event data through the editor context (which
 * would re-render the whole shell on every sample), and without letting the
 * overlay hold document state it does not own.
 */

export interface RetouchOverlaySnapshot {
  /** Which retouch tool published the anchor, so stale anchors never leak. */
  toolId: string | null;
  /** Clone/heal source anchor in world coordinates, or null when unset. */
  cloneSourceWorld: { x: number; y: number } | null;
  /** Pointer world position while a clone/heal stroke is in progress. */
  cloneCursorWorld: { x: number; y: number } | null;
}

const INITIAL: RetouchOverlaySnapshot = {
  toolId: null,
  cloneSourceWorld: null,
  cloneCursorWorld: null,
};

let snapshot: RetouchOverlaySnapshot = INITIAL;
const listeners = new Set<() => void>();

export function getRetouchOverlaySnapshot(): RetouchOverlaySnapshot {
  return snapshot;
}

export function subscribeRetouchOverlay(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function patchRetouchOverlay(patch: Partial<RetouchOverlaySnapshot>): void {
  const next = { ...snapshot, ...patch };
  if (shallowEqualSnapshot(snapshot, next)) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

export function resetRetouchOverlay(): void {
  patchRetouchOverlay({ ...INITIAL });
}

function samePoint(
  a: { x: number; y: number } | null,
  b: { x: number; y: number } | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y;
}

function shallowEqualSnapshot(a: RetouchOverlaySnapshot, b: RetouchOverlaySnapshot): boolean {
  return (
    a.toolId === b.toolId &&
    samePoint(a.cloneSourceWorld, b.cloneSourceWorld) &&
    samePoint(a.cloneCursorWorld, b.cloneCursorWorld)
  );
}
