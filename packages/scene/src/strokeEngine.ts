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
  type StrokeDabSession,
  type StrokePoint,
  smoothStrokePoints,
  strokeBounds,
} from './brush';
import {
  CausalStrokeReconstructor,
  reconstructionChordLength,
} from './strokeReconstruction';

export interface StrokeEngineState {
  readonly strokeId: string;
  readonly generation: number;
  /** Preset snapshot taken at pointer-down; never mutated mid-stroke. */
  readonly preset: BrushPreset;
  readonly session: StrokeDabSession;
  /** Last smoothed sample, so smoothing continues across batches. */
  lastSmoothed: StrokePoint | null;
  /** One-look-ahead continuous centreline reconstruction. */
  readonly reconstructor: CausalStrokeReconstructor;
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
    reconstructor: new CausalStrokeReconstructor({
      maxChordLength: reconstructionChordLength(preset.radius, preset.spacing),
    }),
    dabCount: 0,
  };
}

export interface StrokeBatch {
  dabs: BrushDab[];
  bounds: { x: number; y: number; w: number; h: number };
}

export interface AppendStrokeOptions {
  /** Flush the held one-sample tail at pointer-up. */
  final?: boolean;
}

/** Feed new input samples into a stroke and get the dabs they produce. */
export function appendStrokePoints(
  state: StrokeEngineState,
  points: readonly StrokePoint[],
  options: AppendStrokeOptions = {},
): StrokeBatch {
  const smoothed =
    points.length > 0
      ? smoothStrokePoints([...points], state.preset.smoothing, state.lastSmoothed)
      : [];
  state.lastSmoothed = smoothed[smoothed.length - 1] ?? state.lastSmoothed;
  const reconstructed: StrokePoint[] = [];
  for (const point of smoothed) reconstructed.push(...state.reconstructor.append(point));
  if (options.final) reconstructed.push(...state.reconstructor.finish());
  if (reconstructed.length === 0) return { dabs: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
  const dabs = generateDabs(reconstructed, state.preset, { session: state.session });
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
  return appendStrokePoints(state, points, { final: true });
}
