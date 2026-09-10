/**
 * Precision selection policy — maps user intent to model/precision/provider.
 *
 * Core insight from benchmarking: INT8 is NOT universally faster. On
 * AVX2-only CPUs it is ~6x *slower* than FP32, but its 3.5x smaller file
 * size benefits download time, storage, and load-time memory pressure.
 *
 * This module treats these as SEPARATE optimization goals rather than
 * conflating them under a single "performance" label:
 *
 *   User mode          → Goal
 *   ──────────────────────────────────────────
 *   'automatic'        → Fastest inference, FP32-safe
 *   'fastest'          → Benchmarked fastest (FP32 on AVX2)
 *   'lowMemory'        → Lowest runtime memory (INT8 weights)
 *   'smallDownload'    → Smallest download (INT8, 3.5x smaller)
 *   'highestQuality'   → Best output quality (FP32)
 *
 * The policy is hardware-aware: it consults PrecisionCapabilities to
 * avoid selecting INT8 for inference on CPUs where it is slower, while
 * still allowing INT8 for download-size or memory goals.
 *
 * Research basis:
 *   - u2netp benchmark: INT8 6.2x slower than FP32 on Ryzen 3 5300U
 *     (Zen 2, AVX2). See apps/desktop/public/models/quantized/u2netp-benchmark.json.
 *   - realesr benchmark: INT8 6.3x slower than FP32 on same hardware.
 *   - ORT CPU EP: INT8 GEMM requires AVX-512 VNNI for acceleration.
 */

import { isInt8Validated } from '../inference/manifest';
import type { ModelPrecision } from '../inference/types';
import { detectPrecisionCapabilities, getPrecisionCapabilitiesSync } from './precisionCapabilities';

/** User-facing precision modes. */
export type PrecisionMode =
  | 'automatic'
  | 'fastest'
  | 'lowMemory'
  | 'smallDownload'
  | 'highestQuality';

export const DEFAULT_PRECISION_MODE: PrecisionMode = 'automatic';

export interface ModelVariant {
  modelId: string;
  precision: ModelPrecision;
  sizeBytes: number;
  quality: number;
}

export interface PrecisionSelection {
  /** The model ID to load and run. */
  modelId: string;
  /** The precision of the selected model. */
  precision: ModelPrecision;
  /** Why this selection was made (for diagnostics). */
  reason: string;
  /** True when the selection differs from the user's literal request. */
  adjusted: boolean;
  /** The original user mode. */
  requestedMode: PrecisionMode;
  /** Estimated download size in bytes. */
  downloadSizeBytes: number;
  /** Human-readable label for the selection. */
  label: string;
}

/**
 * Available model variants for the bundled models that have INT8 versions.
 * In a full implementation this would be derived from the manifest.
 */
const INT8_VARIANTS: Record<string, { int8Id: string; fp32Bytes: number; int8Bytes: number }> = {
  u2netp: { int8Id: 'u2netp-int8', fp32Bytes: 4_574_861, int8Bytes: 1_376_269 },
  'upscale-realesr-general': {
    int8Id: 'upscale-realesr-general-int8',
    fp32Bytes: 4_866_438,
    int8Bytes: 1_283_015,
  },
};

/**
 * Check whether an INT8 variant passed quality validation.
 *
 * INT8 quantization can silently destroy model quality (e.g. u2netp-int8
 * produces near-blank output: MAE 0.4177, PSNR 3.8dB). Never select an
 * INT8 model for inference unless it has passed quality validation —
 * regardless of the user's download-size or memory preference.
 */
async function isInt8QualitySafe(int8ModelId: string): Promise<boolean> {
  try {
    return await isInt8Validated(int8ModelId);
  } catch {
    return false;
  }
}

/**
 * Select the best model variant for a given source model and user mode.
 *
 * This is the single decision point that replaces the old
 * "performance = INT8" assumption with hardware-aware logic.
 *
 * Safety gate: INT8 variants that failed quality validation are never
 * selected for inference, even when the user requests small download
 * or low memory. Producing garbage output is never acceptable.
 *
 * @param sourceModelId  The FP32 source model ID (e.g. 'u2netp').
 * @param mode           The user's precision mode.
 * @param provider       The active execution provider.
 * @param runBenchmark   Whether to run a micro-benchmark if static detection is inconclusive.
 */
export async function selectModelVariant(
  sourceModelId: string,
  mode: PrecisionMode,
  provider = 'wasm',
  runBenchmark = false,
): Promise<PrecisionSelection> {
  const variant = INT8_VARIANTS[sourceModelId];
  const caps = await detectPrecisionCapabilities(provider, runBenchmark);

  // Models without an INT8 variant always use FP32.
  if (!variant) {
    return {
      modelId: sourceModelId,
      precision: 'fp32',
      reason: `No INT8 variant available for ${sourceModelId}.`,
      adjusted: mode !== 'automatic' && mode !== 'highestQuality',
      requestedMode: mode,
      downloadSizeBytes: 0,
      label: 'FP32 (only variant)',
    };
  }

  // Quality gate: INT8 is only an option if it passed quality validation.
  const int8QualitySafe = await isInt8QualitySafe(variant.int8Id);

  switch (mode) {
    case 'highestQuality':
      return {
        modelId: sourceModelId,
        precision: 'fp32',
        reason: 'Highest quality mode: FP32 avoids quantization artifacts.',
        adjusted: false,
        requestedMode: mode,
        downloadSizeBytes: variant.fp32Bytes,
        label: 'FP32 (highest quality)',
      };

    case 'smallDownload':
      if (int8QualitySafe) {
        return {
          modelId: variant.int8Id,
          precision: 'int8',
          reason: `Small download mode: INT8 is ${formatRatio(variant.fp32Bytes, variant.int8Bytes)}x smaller (${formatBytes(variant.int8Bytes)} vs ${formatBytes(variant.fp32Bytes)}).`,
          adjusted: false,
          requestedMode: mode,
          downloadSizeBytes: variant.int8Bytes,
          label: 'INT8 (small download)',
        };
      }
      return {
        modelId: sourceModelId,
        precision: 'fp32',
        reason: `Small download requested but INT8 variant failed quality validation. Using FP32 for correct results.`,
        adjusted: true,
        requestedMode: mode,
        downloadSizeBytes: variant.fp32Bytes,
        label: 'FP32 (INT8 quality-failed)',
      };

    case 'lowMemory':
      if (int8QualitySafe) {
        // INT8 weights are 3.5x smaller → lower peak memory.
        return {
          modelId: variant.int8Id,
          precision: 'int8',
          reason: `Low memory mode: INT8 weights are ${formatRatio(variant.fp32Bytes, variant.int8Bytes)}x smaller, reducing peak memory.`,
          adjusted: false,
          requestedMode: mode,
          downloadSizeBytes: variant.int8Bytes,
          label: 'INT8 (low memory)',
        };
      }
      return {
        modelId: sourceModelId,
        precision: 'fp32',
        reason: `Low memory requested but INT8 variant failed quality validation. Using FP32 for correct results.`,
        adjusted: true,
        requestedMode: mode,
        downloadSizeBytes: variant.fp32Bytes,
        label: 'FP32 (INT8 quality-failed)',
      };

    case 'fastest':
      // Only use INT8 for inference if it's actually faster AND quality-safe.
      if (caps.int8Accelerated && int8QualitySafe) {
        return {
          modelId: variant.int8Id,
          precision: 'int8',
          reason: `Fastest mode: benchmark shows INT8 is faster on this CPU. ${caps.reason}`,
          adjusted: false,
          requestedMode: mode,
          downloadSizeBytes: variant.int8Bytes,
          label: 'INT8 (benchmark-verified faster)',
        };
      }
      return {
        modelId: sourceModelId,
        precision: 'fp32',
        reason: `Fastest mode: ${caps.reason} FP32 is the fastest option on this hardware.`,
        adjusted: true,
        requestedMode: mode,
        downloadSizeBytes: variant.fp32Bytes,
        label: 'FP32 (fastest on this CPU)',
      };
    default:
      // Conservative default: FP32 for inference. INT8 is never faster
      // unless benchmarked otherwise AND quality-validated.
      if (caps.int8Accelerated && int8QualitySafe) {
        return {
          modelId: variant.int8Id,
          precision: 'int8',
          reason: `Automatic: benchmark-verified INT8 acceleration. ${caps.reason}`,
          adjusted: false,
          requestedMode: mode,
          downloadSizeBytes: variant.int8Bytes,
          label: 'INT8 (auto, benchmark-verified)',
        };
      }
      return {
        modelId: sourceModelId,
        precision: 'fp32',
        reason: `Automatic: ${caps.reason} Defaulting to FP32 for reliable inference speed.`,
        adjusted: false,
        requestedMode: mode,
        downloadSizeBytes: variant.fp32Bytes,
        label: 'FP32 (auto)',
      };
  }
}

/**
 * Synchronous quality gate for INT8 variants.
 *
 * Mirrors the async isInt8QualitySafe() for the sync path. Bundled INT8
 * models have their quality validation status known at build time (set
 * in modelCatalog.ts); this set enumerates the ones that failed.
 */
const INT8_QUALITY_FAILED = new Set<string>(['u2netp-int8', 'upscale-realesr-general-int8']);

function isInt8QualitySafeSync(int8ModelId: string): boolean {
  return !INT8_QUALITY_FAILED.has(int8ModelId);
}

/**
 * Synchronous variant selection — uses cached capabilities without
 * running a benchmark. Falls back to conservative FP32.
 */
export function selectModelVariantSync(
  sourceModelId: string,
  mode: PrecisionMode,
  provider = 'wasm',
): PrecisionSelection {
  const variant = INT8_VARIANTS[sourceModelId];
  const caps = getPrecisionCapabilitiesSync(provider);

  if (!variant) {
    return {
      modelId: sourceModelId,
      precision: 'fp32',
      reason: `No INT8 variant for ${sourceModelId}.`,
      adjusted: mode !== 'automatic' && mode !== 'highestQuality',
      requestedMode: mode,
      downloadSizeBytes: 0,
      label: 'FP32 (only variant)',
    };
  }

  const int8QualitySafe = isInt8QualitySafeSync(variant.int8Id);

  switch (mode) {
    case 'highestQuality':
      return {
        modelId: sourceModelId,
        precision: 'fp32',
        reason: 'Highest quality: FP32.',
        adjusted: false,
        requestedMode: mode,
        downloadSizeBytes: variant.fp32Bytes,
        label: 'FP32 (highest quality)',
      };
    case 'smallDownload':
      if (int8QualitySafe) {
        return {
          modelId: variant.int8Id,
          precision: 'int8',
          reason: `Small download: INT8 ${formatRatio(variant.fp32Bytes, variant.int8Bytes)}x smaller.`,
          adjusted: false,
          requestedMode: mode,
          downloadSizeBytes: variant.int8Bytes,
          label: 'INT8 (small download)',
        };
      }
      return {
        modelId: sourceModelId,
        precision: 'fp32',
        reason: 'Small download requested but INT8 variant failed quality validation. Using FP32.',
        adjusted: true,
        requestedMode: mode,
        downloadSizeBytes: variant.fp32Bytes,
        label: 'FP32 (INT8 quality-failed)',
      };
    case 'lowMemory':
      if (int8QualitySafe) {
        return {
          modelId: variant.int8Id,
          precision: 'int8',
          reason: `Low memory: INT8 weights ${formatRatio(variant.fp32Bytes, variant.int8Bytes)}x smaller.`,
          adjusted: false,
          requestedMode: mode,
          downloadSizeBytes: variant.int8Bytes,
          label: 'INT8 (low memory)',
        };
      }
      return {
        modelId: sourceModelId,
        precision: 'fp32',
        reason: 'Low memory requested but INT8 variant failed quality validation. Using FP32.',
        adjusted: true,
        requestedMode: mode,
        downloadSizeBytes: variant.fp32Bytes,
        label: 'FP32 (INT8 quality-failed)',
      };
    case 'fastest':
      if (caps.int8Accelerated && int8QualitySafe) {
        return {
          modelId: variant.int8Id,
          precision: 'int8',
          reason: `Fastest: INT8 benchmarked faster. ${caps.reason}`,
          adjusted: false,
          requestedMode: mode,
          downloadSizeBytes: variant.int8Bytes,
          label: 'INT8 (benchmark-verified)',
        };
      }
      return {
        modelId: sourceModelId,
        precision: 'fp32',
        reason: `Fastest: ${caps.reason}`,
        adjusted: true,
        requestedMode: mode,
        downloadSizeBytes: variant.fp32Bytes,
        label: 'FP32 (fastest on this CPU)',
      };
    default:
      if (caps.int8Accelerated && int8QualitySafe) {
        return {
          modelId: variant.int8Id,
          precision: 'int8',
          reason: `Auto: INT8 benchmarked faster. ${caps.reason}`,
          adjusted: false,
          requestedMode: mode,
          downloadSizeBytes: variant.int8Bytes,
          label: 'INT8 (auto)',
        };
      }
      return {
        modelId: sourceModelId,
        precision: 'fp32',
        reason: `Auto: ${caps.reason}`,
        adjusted: false,
        requestedMode: mode,
        downloadSizeBytes: variant.fp32Bytes,
        label: 'FP32 (auto)',
      };
  }
}

/** Map the legacy InferenceQualityPreference to a PrecisionMode. */
export function preferenceToMode(
  preference: 'automatic' | 'performance' | 'quality',
): PrecisionMode {
  switch (preference) {
    case 'performance':
      return 'fastest';
    case 'quality':
      return 'highestQuality';
    default:
      return 'automatic';
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatRatio(larger: number, smaller: number): string {
  if (smaller <= 0) return '?';
  return (larger / smaller).toFixed(1);
}
