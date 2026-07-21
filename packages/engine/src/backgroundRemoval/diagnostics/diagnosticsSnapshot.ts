/**
 * Diagnostics snapshot — comprehensive pipeline state for the UI.
 *
 * Provides a single structured view of the resolved model, execution
 * provider, memory class, and fallback reason. This is the canonical
 * source of truth for the diagnostics panel shown to users.
 *
 * Privacy: never includes document contents, input images, or other
 * private data. Only model metadata and performance metrics.
 */

import type { EnvironmentCapabilities } from '../environmentCapabilities';
import type { WorkerModelId } from '../types';

export type MemoryClass = 'low' | 'medium' | 'high' | 'ultra';

export interface PipelineDiagnostics {
  /** The model that was resolved for this operation. */
  resolvedModel: WorkerModelId | null;
  /** Human-readable model name. */
  resolvedModelName: string;
  /** Model precision (fp32 or int8). */
  precision: 'fp32' | 'int8';
  /** Execution provider that succeeded. */
  executionProvider: 'webgpu' | 'webgl' | 'wasm' | 'native' | 'unknown';
  /** Memory class based on estimated peak memory. */
  memoryClass: MemoryClass;
  /** Estimated peak memory in bytes. */
  estimatedPeakBytes: number;
  /** Whether the selection fell back from a higher tier. */
  fellBack: boolean;
  /** The originally requested tier, if different from resolved. */
  requestedTier?: string;
  /** Human-readable reason for the final selection. */
  fallbackReason: string;
  /** Environment summary. */
  environment: string;
  /** Whether the model is quality-validated (false for INT8 failures). */
  qualityValidated: boolean;
  /** True when WASM memory safety check blocked a model. */
  wasmSafetyBlocked: boolean;
}

const MODEL_NAMES: Record<string, string> = {
  u2netp: 'U^2-Net Light',
  'u2netp-int8': 'U^2-Net Light (INT8)',
  'isnet-general-use': 'IS-Net General Use',
  'birefnet-general-lite': 'BiRefNet Lite',
  'birefnet-general': 'BiRefNet Full',
};

const MODEL_PEAK_BYTES: Record<string, number> = {
  u2netp: 14_100_000,
  'u2netp-int8': 3_600_000,
  'isnet-general-use': 714_600_000,
  'birefnet-general-lite': 896_000_000,
  'birefnet-general': 3_712_000_000,
};

export function classifyMemory(peakBytes: number): MemoryClass {
  if (peakBytes < 50_000_000) return 'low';
  if (peakBytes < 500_000_000) return 'medium';
  if (peakBytes < 1_000_000_000) return 'high';
  return 'ultra';
}

export interface DiagnosticsInput {
  resolvedModel: WorkerModelId | null;
  executionProvider: string;
  caps: EnvironmentCapabilities;
  fellBack: boolean;
  requestedTier?: string;
  fallbackReason: string;
  qualityValidated?: boolean;
  wasmSafetyBlocked?: boolean;
}

/**
 * Build a comprehensive diagnostics snapshot from the resolved pipeline state.
 */
export function buildDiagnostics(input: DiagnosticsInput): PipelineDiagnostics {
  const peakBytes = input.resolvedModel ? (MODEL_PEAK_BYTES[input.resolvedModel] ?? 0) : 0;

  return {
    resolvedModel: input.resolvedModel,
    resolvedModelName: input.resolvedModel
      ? (MODEL_NAMES[input.resolvedModel] ?? input.resolvedModel)
      : 'none',
    precision: input.resolvedModel?.endsWith('-int8') ? 'int8' : 'fp32',
    executionProvider: (['webgpu', 'webgl', 'wasm', 'native'].includes(input.executionProvider)
      ? input.executionProvider
      : 'unknown') as PipelineDiagnostics['executionProvider'],
    memoryClass: classifyMemory(peakBytes),
    estimatedPeakBytes: peakBytes,
    fellBack: input.fellBack,
    requestedTier: input.requestedTier,
    fallbackReason: input.fallbackReason,
    environment: input.caps.label,
    qualityValidated: input.qualityValidated ?? true,
    wasmSafetyBlocked: input.wasmSafetyBlocked ?? false,
  };
}
