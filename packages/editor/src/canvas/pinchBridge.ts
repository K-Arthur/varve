/**
 * Tauri pinch-bridge payload → semantic action resolution.
 *
 * The native side (apps/desktop/src-tauri, Linux) emits `canvas://pinch-zoom`
 * in two shapes:
 *
 * - `{ phase: 'begin'|'update'|'end', scale, x, y }` — the GtkGestureZoom
 *   stream. `scale` is cumulative since begin; `x`/`y` are webview-local CSS
 *   pixels for the gesture centre (null when the gesture could not report a
 *   bounding box, e.g. some cancel paths).
 * - `{ factor }` — the WebKit page-zoom fallback: a per-notify DELTA factor
 *   the canvas should multiply its zoom by.
 *
 * This module is the single validation point for that wire contract so the
 * pipeline handler only ever sees well-formed actions. Invalid shapes resolve
 * to 'ignore' — the canvas never guesses.
 */

export interface PinchBridgePayload {
  factor?: number;
  phase?: 'begin' | 'update' | 'end';
  scale?: number;
  x?: number | null;
  y?: number | null;
}

export type PinchBridgeAction =
  | {
      kind: 'gesture';
      phase: 'begin' | 'update' | 'end';
      scale: number;
      x: number | null;
      y: number | null;
    }
  | { kind: 'factor'; factor: number }
  | { kind: 'ignore' };

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function resolvePinchBridgeAction(
  payload: PinchBridgePayload | undefined | null,
): PinchBridgeAction {
  if (!payload) return { kind: 'ignore' };
  if (payload.phase === 'begin' || payload.phase === 'update' || payload.phase === 'end') {
    const scale =
      typeof payload.scale === 'number' && Number.isFinite(payload.scale) && payload.scale > 0
        ? payload.scale
        : 1;
    return {
      kind: 'gesture',
      phase: payload.phase,
      scale,
      x: finiteOrNull(payload.x),
      y: finiteOrNull(payload.y),
    };
  }
  const factor = payload.factor;
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) {
    return { kind: 'ignore' };
  }
  return { kind: 'factor', factor };
}
