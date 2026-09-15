/**
 * Module-level overlay state for the Liquify tool.
 *
 * The tool owns the live stroke; the overlay component owns presentation. A
 * tiny external store keeps them in sync without routing per-pointer-event
 * data through the editor context (which would re-render the whole shell on
 * every sample).
 */

import type { LiquifyFreezeMask, LiquifyMode } from '@varve/engine';

export type LiquifyFreezeTool = 'off' | 'freeze' | 'thaw';

export interface LiquifyOverlaySnapshot {
  /** Document node currently targeted, or null when liquify has no target. */
  targetId: string | null;
  /** Composited layer-space cursor position while the pointer is over canvas. */
  cursorLayer: { x: number; y: number } | null;
  /** Brush radius in layer pixels. */
  radiusLayer: number;
  /** 0..1 edge hardness (1 = hard edge). */
  hardness: number;
  mode: LiquifyMode;
  freezeTool: LiquifyFreezeTool;
  /** Session freeze mask being painted (not yet committed to the document). */
  sessionFreeze: { width: number; height: number; data: Uint8Array } | null;
  /** Bumped whenever sessionFreeze contents change. */
  sessionFreezeRevision: number;
  /** Freeze mask persisted on the target (document state mirror). */
  persistedFreeze: LiquifyFreezeMask | null;
  showGrid: boolean;
  showFreeze: boolean;
}

const INITIAL: LiquifyOverlaySnapshot = {
  targetId: null,
  cursorLayer: null,
  radiusLayer: 80,
  hardness: 0.5,
  mode: 'push',
  freezeTool: 'off',
  sessionFreeze: null,
  sessionFreezeRevision: 0,
  persistedFreeze: null,
  showGrid: false,
  showFreeze: true,
};

let snapshot: LiquifyOverlaySnapshot = INITIAL;
const listeners = new Set<() => void>();

export function getLiquifyOverlaySnapshot(): LiquifyOverlaySnapshot {
  return snapshot;
}

export function subscribeLiquifyOverlay(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function patchLiquifyOverlay(patch: Partial<LiquifyOverlaySnapshot>): void {
  const next = { ...snapshot, ...patch };
  if (shallowEqualSnapshot(snapshot, next)) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

export function resetLiquifyOverlay(): void {
  patchLiquifyOverlay({ ...INITIAL });
}

function shallowEqualSnapshot(a: LiquifyOverlaySnapshot, b: LiquifyOverlaySnapshot): boolean {
  return (
    a.targetId === b.targetId &&
    a.cursorLayer === b.cursorLayer &&
    a.radiusLayer === b.radiusLayer &&
    a.hardness === b.hardness &&
    a.mode === b.mode &&
    a.freezeTool === b.freezeTool &&
    a.sessionFreeze === b.sessionFreeze &&
    a.sessionFreezeRevision === b.sessionFreezeRevision &&
    a.persistedFreeze === b.persistedFreeze &&
    a.showGrid === b.showGrid &&
    a.showFreeze === b.showFreeze
  );
}
