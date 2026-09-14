/**
 * Trace provenance helpers: build `TraceMetadata` for inserted trace groups
 * and restore `VectorizationSettings` from stored metadata (Edit Trace).
 *
 * Metadata is deliberately lightweight — no raster bytes, only the source
 * node id, the reproducible recipe, and result statistics — so re-traces can
 * detect source changes without duplicating the image.
 *
 * Schema v2 (2026-09-13) adds the full preparation stack, the provider that
 * actually produced the result, and the effective trace resolution. v1
 * payloads keep loading: every v2 field is optional and restored with
 * defaults.
 */

import { isTauriRuntime } from '@varve/platform';
import type { TraceMetadata, TracePrepSnapshot } from '@varve/scene';
import type { TraceDiagnostics } from './session';
import {
  DEFAULT_VECTORIZATION_SETTINGS,
  type SourcePrepSettings,
  type VectorizationSettings,
} from './settings';

/** Which provider engine produced the result (best-effort environment label).
 *  New code should record `providerId` from the trace result instead. */
export function traceEngineLabel(): TraceMetadata['engine'] {
  if (isTauriRuntime()) return 'native';
  return typeof Worker !== 'undefined' ? 'worker' : 'direct';
}

function engineForProvider(providerId: string | undefined): TraceMetadata['engine'] {
  if (!providerId) return traceEngineLabel();
  if (providerId.includes('native')) return 'native';
  if (providerId.includes('wasm')) return 'wasm';
  if (providerId.includes('worker')) return 'worker';
  return 'direct';
}

/**
 * Cheap, deterministic source identity hash (FNV-1a over the stored `src`
 * string). This detects a replaced asset under the same node id; it is not a
 * content hash of decoded pixels and is documented as such.
 */
export function hashTraceSource(src: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < src.length; i += 1) {
    hash ^= src.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${src.length.toString(36)}-${hash.toString(16).padStart(8, '0')}`;
}

function prepSnapshot(prep: SourcePrepSettings): TracePrepSnapshot {
  return {
    grayscale: prep.grayscale,
    invert: prep.invert,
    contrast: prep.contrast,
    brightness: prep.brightness,
    denoise: prep.denoise,
    threshold: prep.threshold,
    adaptiveThreshold: prep.adaptiveThreshold,
    adaptiveWindow: prep.adaptiveWindow,
    adaptiveSensitivity: prep.adaptiveSensitivity,
    removeBackground: prep.removeBackground,
  };
}

export interface TraceMetadataInput {
  sourceNodeId: string;
  settings: VectorizationSettings;
  diagnostics: TraceDiagnostics;
  omittedHoles: number;
  /** Provider that actually produced the result (from dispatch). */
  providerId?: string;
  /** Effective trace raster dimensions. */
  traceWidth?: number;
  traceHeight?: number;
  /** Source image pixel dimensions at trace time. */
  sourceWidth?: number;
  sourceHeight?: number;
  /** Identity hash of the stored source `src`. */
  sourceHash?: string;
}

/** Build versioned provenance for a trace insertion. */
export function buildTraceMetadata(input: TraceMetadataInput): TraceMetadata {
  const { settings } = input;
  return {
    schemaVersion: 2,
    sourceNodeId: input.sourceNodeId,
    ...(input.sourceHash ? { sourceHash: input.sourceHash } : {}),
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
    structure: settings.structure,
    cornerAngle: settings.cornerAngle,
    maxError: settings.maxError,
    centerlineWidth: settings.centerlineWidth,
    centerlinePrune: settings.centerlinePrune,
    prep: prepSnapshot(settings.prep),
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.traceWidth !== undefined ? { traceWidth: input.traceWidth } : {}),
    ...(input.traceHeight !== undefined ? { traceHeight: input.traceHeight } : {}),
    ...(input.sourceWidth !== undefined ? { sourceWidth: input.sourceWidth } : {}),
    ...(input.sourceHeight !== undefined ? { sourceHeight: input.sourceHeight } : {}),
    engine: engineForProvider(input.providerId),
    stats: {
      pathCount: input.diagnostics.pathCount,
      pointCount: input.diagnostics.pointCount,
      holeCount: input.diagnostics.holeCount,
      omittedHoles: input.omittedHoles,
    },
    createdAt: Date.now(),
  };
}

function restorePrep(snapshot: TracePrepSnapshot | undefined): SourcePrepSettings {
  const defaults = DEFAULT_VECTORIZATION_SETTINGS.prep;
  if (!snapshot) return { ...defaults };
  return {
    grayscale: snapshot.grayscale ?? defaults.grayscale,
    invert: snapshot.invert ?? defaults.invert,
    contrast: snapshot.contrast ?? defaults.contrast,
    brightness: snapshot.brightness ?? defaults.brightness,
    denoise: snapshot.denoise ?? defaults.denoise,
    threshold: snapshot.threshold ?? defaults.threshold,
    adaptiveThreshold: snapshot.adaptiveThreshold ?? defaults.adaptiveThreshold,
    adaptiveWindow: snapshot.adaptiveWindow ?? defaults.adaptiveWindow,
    adaptiveSensitivity: snapshot.adaptiveSensitivity ?? defaults.adaptiveSensitivity,
    removeBackground: snapshot.removeBackground ?? defaults.removeBackground,
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
    structure: metadata.structure ?? DEFAULT_VECTORIZATION_SETTINGS.structure,
    cornerAngle: metadata.cornerAngle ?? DEFAULT_VECTORIZATION_SETTINGS.cornerAngle,
    maxError: metadata.maxError ?? DEFAULT_VECTORIZATION_SETTINGS.maxError,
    foreground: metadata.foreground ?? DEFAULT_VECTORIZATION_SETTINGS.foreground,
    alphaThreshold: metadata.alphaThreshold ?? DEFAULT_VECTORIZATION_SETTINGS.alphaThreshold,
    centerlineWidth: metadata.centerlineWidth ?? DEFAULT_VECTORIZATION_SETTINGS.centerlineWidth,
    centerlinePrune: metadata.centerlinePrune ?? DEFAULT_VECTORIZATION_SETTINGS.centerlinePrune,
    prep: restorePrep(metadata.prep),
  };
}

/** True when the stored source identity no longer matches the current src. */
export function traceSourceChanged(metadata: TraceMetadata, currentSrc: string): boolean {
  if (!metadata.sourceHash) return false;
  return metadata.sourceHash !== hashTraceSource(currentSrc);
}
