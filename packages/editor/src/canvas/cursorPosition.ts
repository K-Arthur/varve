/**
 * Live canvas cursor position (world coordinates) as a tiny external store.
 *
 * The pointer pipeline publishes the latest world point at most once per
 * animation frame. It deliberately does not live in `EditorState`: every
 * `useEditor()` consumer re-renders on any state patch, so a per-frame cursor
 * patch re-rendered the entire editor (Layers rows, Inspector, overlays) while
 * the pointer merely hovered. Only the few surfaces that display or publish the
 * cursor subscribe here.
 */

import { useSyncExternalStore } from 'react';

export interface CursorWorldPosition {
  readonly x: number;
  readonly y: number;
}

type Listener = () => void;

let current: CursorWorldPosition | null = null;
const listeners = new Set<Listener>();

/** Publish the latest cursor world position; `null` when the pointer leaves. */
export function publishCursorWorldPosition(next: CursorWorldPosition | null): void {
  if (next === current) return;
  if (next && current && next.x === current.x && next.y === current.y) return;
  current = next;
  for (const listener of listeners) listener();
}

export function getCursorWorldPosition(): CursorWorldPosition | null {
  return current;
}

export function subscribeCursorWorldPosition(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Subscribe a component to the live cursor. Re-renders only that component,
 * but at sync priority from the pointer's animation-frame callback, and React
 * folds pending editor updates (an active drag) into that flush. Reserve it
 * for diagnostics; per-frame product surfaces should write their own output
 * from `subscribeCursorWorldPosition` (see `CursorPositionReadout`).
 */
export function useCursorWorldPosition(): CursorWorldPosition | null {
  return useSyncExternalStore(
    subscribeCursorWorldPosition,
    getCursorWorldPosition,
    getCursorWorldPosition,
  );
}
