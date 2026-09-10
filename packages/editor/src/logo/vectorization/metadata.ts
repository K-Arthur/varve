/**
 * Trace provenance helpers: build `TraceMetadata` for inserted trace groups
 * and restore `VectorizationSettings` from stored metadata (Edit Trace).
 *
 * Metadata is deliberately lightweight — no raster bytes, only the source
 * node id, options, and result statistics — so re-traces can detect source
 * changes via the node identity without duplicating the image.
 */

import { isTauriRuntime } from '@varve/platform';
import type { TraceMetadata } from '@varve/scene';
import type { TraceDiagnostics } from './session';
import { DEFAULT_VECTORIZATION_SETTINGS, type VectorizationSettings } from './settings';

/** Which provider engine produced the result (best-effort label). */
export function traceEngineLabel(): TraceMetadata['engine'] {
  if (isTauriRuntime()) return 'native';
  return typeof Worker !== 'undefined' ? 'worker' : 'direct';
}

/** Build versioned provenance for a trace insertion. */
export function buildTraceMetadata(
  sourceNodeId: string,
  settings: VectorizationSettings,
  diagnostics: TraceDiagnostics,
  omittedHoles: number,
  engine: TraceMetadata['engine'],
): TraceMetadata {
  return {
    schemaVersion: 1,
    sourceNodeId,
    mode: settings.mode,
    traceMode: settings.traceMode,
    threshold: settings.threshold,
    foreground: settings.foreground,
    alphaThreshold: settings.alphaThreshold,
    minArea: settings.minArea,
    simplifyTolerance: settings.simplifyTolerance,
    maxPaths: settings.maxPaths,
    maxColors: settings.maxColors,
    compoundHoles: settings.compoundHoles,
    cornerAngle: settings.cornerAngle,
    maxError: settings.maxError,
    centerlineWidth: settings.centerlineWidth,
    centerlinePrune: settings.centerlinePrune,
    engine,
    stats: {
      pathCount: diagnostics.pathCount,
      pointCount: diagnostics.pointCount,
      holeCount: diagnostics.holeCount,
      omittedHoles,
    },
    createdAt: Date.now(),
  };
}

/** Restore editable settings from stored metadata (unknown fields use defaults). */
export function settingsFromTraceMetadata(metadata: TraceMetadata): VectorizationSettings {
  return {
    presetId: null,
    mode: metadata.mode ?? DEFAULT_VECTORIZATION_SETTINGS.mode,
    traceMode: metadata.traceMode ?? DEFAULT_VECTORIZATION_SETTINGS.traceMode,
    threshold: metadata.threshold ?? DEFAULT_VECTORIZATION_SETTINGS.threshold,
    minArea: metadata.minArea ?? DEFAULT_VECTORIZATION_SETTINGS.minArea,
    simplifyTolerance:
      metadata.simplifyTolerance ?? DEFAULT_VECTORIZATION_SETTINGS.simplifyTolerance,
    maxPaths: metadata.maxPaths ?? DEFAULT_VECTORIZATION_SETTINGS.maxPaths,
    maxColors: metadata.maxColors ?? DEFAULT_VECTORIZATION_SETTINGS.maxColors,
    compoundHoles: metadata.compoundHoles ?? DEFAULT_VECTORIZATION_SETTINGS.compoundHoles,
    cornerAngle: metadata.cornerAngle ?? DEFAULT_VECTORIZATION_SETTINGS.cornerAngle,
    maxError: metadata.maxError ?? DEFAULT_VECTORIZATION_SETTINGS.maxError,
    foreground: metadata.foreground ?? DEFAULT_VECTORIZATION_SETTINGS.foreground,
    alphaThreshold: metadata.alphaThreshold ?? DEFAULT_VECTORIZATION_SETTINGS.alphaThreshold,
    centerlineWidth: metadata.centerlineWidth ?? DEFAULT_VECTORIZATION_SETTINGS.centerlineWidth,
    centerlinePrune: metadata.centerlinePrune ?? DEFAULT_VECTORIZATION_SETTINGS.centerlinePrune,
    prep: { ...DEFAULT_VECTORIZATION_SETTINGS.prep },
  };
}
