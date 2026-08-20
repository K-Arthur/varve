/**
 * The canonical stroke → dab algorithm.
 *
 * There is exactly one implementation of "given these new input samples, what
 * dabs does this brush produce?", and both the brush worker and the
 * main-thread fallback call it. Workers exist to move this work off the main
 * thread, never to become a second set of paint semantics — so parity between
 * the two paths is a property of the code, not something tests have to police
 * after the fact.
 *
 * All state that makes a stroke continuous (spacing carry, arc length, jitter
 * sequence, smoothing history) lives in `StrokeEngineState`, which is owned by
 * whoever is running the stroke. Nothing here reads module-level mutable state,
 * so overlapping strokes cannot perturb one another.
 */

import {
  type BrushDab,
  type BrushPreset,
  createStrokeDabSession,
  generateDabs,
  smoothStrokePoints,
  type StrokeDabSession,
  type StrokePoint,
  strokeBounds,
} from './brush';

export interface StrokeEngineState {
  readonly strokeId: string;
  readonly generation: number;
  /** Preset snapshot taken at pointer-down; never mutated mid-stroke. */
  readonly preset: BrushPreset;
  readonly session: StrokeDabSession;
  /** Last smoothed sample, so smoothing continues across batches. */
  lastSmoothed: StrokePoint | null;
  /** Count of dabs emitted so far, for diagnostics and profiling. */
  dabCount: number;
}

export function beginStroke(
  strokeId: string,
  generation: number,
  preset: BrushPreset,
  jitterSeed: number,
  options: { lengthReference?: number } = {},
): StrokeEngineState {
  return {
    strokeId,
    generation,
    // Freeze the preset for the stroke's lifetime: changing brush size or
    // grain mid-stroke must not produce a stroke built from two brushes.
    preset: { ...preset, dynamics: [...preset.dynamics] },
    session: createStrokeDabSession(jitterSeed, options),
    lastSmoothed: null,
    dabCount: 0,
  };
}

export interface StrokeBatch {
  dabs: BrushDab[];
  bounds: { x: number; y: number; w: number; h: number };
}

/** Feed new input samples into a stroke and get the dabs they produce. */
export function appendStrokePoints(
  state: StrokeEngineState,
  points: readonly StrokePoint[],
): StrokeBatch {
  if (points.length === 0) return { dabs: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
  const smoothed = smoothStrokePoints([...points], state.preset.smoothing, state.lastSmoothed);
  state.lastSmoothed = smoothed[smoothed.length - 1] ?? state.lastSmoothed;
  const dabs = generateDabs(smoothed, state.preset, { session: state.session });
  state.dabCount += dabs.length;
  return { dabs, bounds: strokeBounds(dabs) };
}

/**
 * Convenience for tests and one-shot replays: run a whole stroke through the
 * engine in a single call.
 */
export function runWholeStroke(
  preset: BrushPreset,
  points: readonly StrokePoint[],
  jitterSeed: number,
): StrokeBatch {
  const state = beginStroke('whole', 0, preset, jitterSeed);
  return appendStrokePoints(state, points);
}
