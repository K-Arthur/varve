/**
 * Offline model manifest — delegates to the unified inference manifest.
 *
 * This module re-exports from ../inference/manifest (the single source of
 * truth for all ONNX models) while preserving backward compatibility for
 * bg-removal consumers that expect the raw JSON entry shape.
 *
 * ADR-0005: offline-first model bundling.
 */

import {
  getModelEntry as infGetModelEntry,
  resetManifestCache as infResetCache,
  loadModelCatalog,
  sha256Hex,
  verifyChecksum,
} from '../inference/manifest';
import type { ModelManifestEntry as InfModelManifestEntry } from '../inference/types';

/** Legacy raw-entry shape (matches the on-disk manifest.json schema). */
export interface ModelManifestEntry {
  id: string;
  filename: string;
  localPath: string;
  sha256: string | null;
  bundled: boolean;
  remoteUrl: string;
  /** Weight precision. 'fp32' is the default when omitted. */
  precision?: 'fp32' | 'int8';
  /** For INT8 variants: the FP32 source model this was quantized from. */
  sourceModelId?: string;
  /** SHA-256 of the FP32 source at quantization time (provenance). */
  sourceSha256?: string;
  notes?: string;
}

export interface ModelManifest {
  version: number;
  models: ModelManifestEntry[];
}

function toLegacyEntry(e: InfModelManifestEntry): ModelManifestEntry {
  return {
    id: e.id,
    filename: `${e.id}.onnx`,
    localPath: e.localPath ?? `/models/${e.id}.onnx`,
    sha256: e.checksum || null,
    bundled: e.bundled,
    remoteUrl: e.remoteUrl,
    precision: e.precision,
    sourceModelId: e.sourceModelId,
    sourceSha256: e.sourceSha256,
    notes: e.description || undefined,
  };
}

export async function loadModelManifest(signal?: AbortSignal): Promise<ModelManifest | null> {
  const catalog = await loadModelCatalog(signal);
  if (!catalog) return null;
  return {
    version: 2,
    models: catalog.map(toLegacyEntry),
  };
}

export function resetModelManifestCache(): void {
  infResetCache();
}

export async function getManifestEntry(
  modelId: string,
  signal?: AbortSignal,
): Promise<ModelManifestEntry | null> {
  const entry = await infGetModelEntry(modelId, signal);
  if (!entry) return null;
  return toLegacyEntry(entry);
}

/** Get the FP32 source entry for an INT8 variant, or the entry itself if FP32. */
export async function getSourceManifestEntry(
  modelId: string,
  signal?: AbortSignal,
): Promise<ModelManifestEntry | null> {
  const entry = await getManifestEntry(modelId, signal);
  if (!entry) return null;
  if (entry.precision !== 'int8' || !entry.sourceModelId) return entry;
  return getManifestEntry(entry.sourceModelId, signal);
}

export { sha256Hex, verifyChecksum as verifyModelChecksum };
