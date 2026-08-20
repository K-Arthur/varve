/**
 * Brush worker — runs the canonical stroke engine off the main thread.
 *
 * The worker owns per-stroke engine state so the host can dispatch input
 * incrementally (`appendPoints`) instead of resending an ever-growing point
 * list, which would make a long stroke quadratic. Every message carries the
 * stroke id and generation it belongs to, so a response that arrives after its
 * stroke was cancelled can be recognised and dropped rather than painted.
 *
 * Cancellation is a real message, not just a rejected promise on the host: the
 * worker drops the stroke's state so no further CPU is spent on it.
 */
import {
  appendStrokePoints,
  beginStroke,
  type BrushDab,
  type BrushPreset,
  type StrokeEngineState,
  type StrokePoint,
} from '@varve/scene';

export type BrushWorkerCommand =
  | {
      type: 'beginStroke';
      strokeId: string;
      generation: number;
      preset: BrushPreset;
      jitterSeed: number;
    }
  | {
      type: 'appendPoints';
      strokeId: string;
      generation: number;
      seq: number;
      points: StrokePoint[];
      /** True for the final batch of the stroke. */
      final?: boolean;
    }
  | { type: 'cancelStroke'; strokeId: string; generation: number };

export type BrushWorkerResponse =
  | {
      type: 'dabs';
      strokeId: string;
      generation: number;
      seq: number;
      dabs: BrushDab[];
      bounds: { x: number; y: number; w: number; h: number };
      final: boolean;
      /** Worker-side compute time in ms, for the paint profiler. */
      computeMs: number;
    }
  | { type: 'strokeError'; strokeId: string; generation: number; seq: number; message: string };

const strokes = new Map<string, StrokeEngineState>();

function strokeKey(strokeId: string, generation: number): string {
  return `${strokeId}#${generation}`;
}

export function handleBrushCommand(
  cmd: BrushWorkerCommand,
  post: (r: BrushWorkerResponse) => void,
  now: () => number = () => Date.now(),
): void {
  switch (cmd.type) {
    case 'beginStroke': {
      strokes.set(
        strokeKey(cmd.strokeId, cmd.generation),
        beginStroke(cmd.strokeId, cmd.generation, cmd.preset, cmd.jitterSeed),
      );
      return;
    }
    case 'cancelStroke': {
      strokes.delete(strokeKey(cmd.strokeId, cmd.generation));
      return;
    }
    case 'appendPoints': {
      const key = strokeKey(cmd.strokeId, cmd.generation);
      const state = strokes.get(key);
      // Cancelled (or never begun): stay silent rather than inventing dabs.
      if (!state) return;
      const started = now();
      try {
        const batch = appendStrokePoints(state, cmd.points);
        post({
          type: 'dabs',
          strokeId: cmd.strokeId,
          generation: cmd.generation,
          seq: cmd.seq,
          dabs: batch.dabs,
          bounds: batch.bounds,
          final: cmd.final === true,
          computeMs: now() - started,
        });
      } catch (err) {
        post({
          type: 'strokeError',
          strokeId: cmd.strokeId,
          generation: cmd.generation,
          seq: cmd.seq,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      if (cmd.final) strokes.delete(key);
      return;
    }
  }
}

/** Test seam: drop all retained stroke state. */
export function resetBrushWorkerState(): void {
  strokes.clear();
}

type BrushWorkerScope = {
  onmessage: ((e: MessageEvent<BrushWorkerCommand>) => void) | null;
  postMessage: (r: BrushWorkerResponse) => void;
};

const scope = globalThis as unknown as Partial<BrushWorkerScope>;
// Guarded so the module can also be imported directly by tests and by the
// synchronous fallback without trying to install a message handler.
if (
  typeof scope.postMessage === 'function' &&
  typeof (globalThis as { document?: unknown }).document === 'undefined'
) {
  (scope as BrushWorkerScope).onmessage = (e: MessageEvent<BrushWorkerCommand>) => {
    handleBrushCommand(
      e.data,
      (r) => (scope as BrushWorkerScope).postMessage(r),
      () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    );
  };
}
