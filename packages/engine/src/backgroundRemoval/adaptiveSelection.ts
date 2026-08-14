/**
 * Adaptive model selection — device-aware Automatic mode.
 *
 * Chooses the best segmentation model for the active device, considering:
 *   - installed models (bundled, downloaded, native)
 *   - provider availability (WebGPU, WebGL, native, WASM)
 *   - measured acceleration
 *   - memory budget (model size + estimated peak)
 *   - source dimensions (larger images need more memory)
 *   - operation type (preview vs full-resolution apply)
 *
 * Selection never silently routes a 928 MB model into WASM. When a requested
 * model is unsafe or unavailable, it falls back with a structured reason.
 *
 * Research basis:
 *   - BiRefNet at ~4GB WASM crashes vs ~445MB native (docs/audits/background-
 *     removal-wasm-memory-hardening-2026-07-18.md)
 *   - u2netp (4.7MB) is the only model safe for bare-WASM in all environments
 *   - WebGPU/WebGL enable larger models but have compatibility constraints
 */

import type { ModelPrecision } from '../inference/types';
import type { EnvironmentCapabilities } from './environmentCapabilities';
import type { PrecisionMode } from './precisionPolicy';
import type { WorkerModelId } from './types';

export interface AdaptiveSelection {
  modelId: WorkerModelId;
  modelPath: string;
  precision: ModelPrecision;
  /** The tier that was selected. */
  tier: 'fast' | 'balanced' | 'quality' | 'maximum';
  /** True when selection fell back from a higher tier. */
  fellBack: boolean;
  /** The tier that was requested but not available (when fellBack). */
  requestedTier?: 'fast' | 'balanced' | 'quality' | 'maximum';
  /** Human-readable reason for the selection (for diagnostics). */
  reason: string;
  /** Estimated peak memory for this selection on this device. */
  estimatedPeakBytes: number;
}

export interface AdaptiveSelectionOptions {
  /** Desired quality tier. */
  tier: 'fast' | 'balanced' | 'quality' | 'maximum' | 'automatic';
  /** Device capabilities from environmentCapabilities.ts. */
  caps: EnvironmentCapabilities;
  /** Is the native Tauri runtime ready? */
  nativeReady: boolean;
  /** Source image width. */
  sourceWidth: number;
  /** Source image height. */
  sourceHeight: number;
  /** Is this a preview (downscaled) or full-resolution apply? */
  isPreview: boolean;
  /** Model path resolver. */
  getModelPath: (modelId: string) => Promise<string | null>;
  /** Check if a model is installed (bundled, downloaded, or native). */
  isInstalled: (modelId: string) => Promise<boolean>;
  /** Precision mode for INT8 variant selection (default: 'automatic'). */
  precisionMode?: PrecisionMode;
}

interface TierSpec {
  id: WorkerModelId;
  name: string;
  sizeBytes: number;
  /** Peak memory multiplier over model size at inference time. */
  peakMultiplier: number;
  /** Minimum provider tier required. */
  minProvider: 'wasm' | 'webgl' | 'webgpu' | 'native';
  /** Whether this model can run on bare WASM (without acceleration). */
  wasmSafe: boolean;
}

const TIER_SPECS: Record<'fast' | 'balanced' | 'quality' | 'maximum', TierSpec> = {
  fast: {
    id: 'u2netp',
    name: 'U^2-Net Light',
    sizeBytes: 4_574_861,
    peakMultiplier: 3,
    minProvider: 'wasm',
    wasmSafe: true,
  },
  balanced: {
    id: 'isnet-general-use',
    name: 'IS-Net General Use',
    sizeBytes: 178_648_008,
    peakMultiplier: 4,
    minProvider: 'wasm',
    wasmSafe: false,
  },
  quality: {
    id: 'birefnet-general-lite',
    name: 'BiRefNet Lite',
    sizeBytes: 224_005_088,
    peakMultiplier: 4,
    minProvider: 'wasm',
    wasmSafe: false,
  },
  maximum: {
    id: 'birefnet-general',
    name: 'BiRefNet Full',
    sizeBytes: 972_666_916,
    peakMultiplier: 4,
    minProvider: 'native',
    wasmSafe: false,
  },
};

const PROVIDER_RANK: Record<string, number> = {
  wasm: 0,
  webgl: 1,
  webgpu: 2,
  native: 3,
};

function getProviderRank(caps: EnvironmentCapabilities, nativeReady = false): number {
  if (nativeReady) return PROVIDER_RANK.native!;
  if (caps.hasWebGPU) return PROVIDER_RANK.webgpu!;
  if (caps.hasWebGL && !caps.isWebKitGTK) return PROVIDER_RANK.webgl!;
  return PROVIDER_RANK.wasm!;
}

function estimatePeakBytes(spec: TierSpec, sourcePixels: number): number {
  const basePeak = spec.sizeBytes * spec.peakMultiplier;
  const inputTensorBytes = sourcePixels * 3 * 4;
  return basePeak + inputTensorBytes;
}

/**
 * Select the best model tier for the active device and operation.
 *
 * Resolution order for 'automatic':
 *   1. If native runtime ready with BiRefNet Full installed → maximum
 *   2. Else if native/WebGPU with BiRefNet Lite installed → quality
 *   3. Else if IS-Net installed and memory allows → balanced
 *   4. Else → fast (u2netp, always bundled)
 *
 * For explicit tiers, the requested tier is attempted first, then falls back
 * through lower tiers with documented reasons.
 */
export async function selectAdaptiveModel(
  opts: AdaptiveSelectionOptions,
): Promise<AdaptiveSelection | null> {
  const { caps, tier, nativeReady } = opts;
  const sourcePixels = opts.sourceWidth * opts.sourceHeight;
  const providerRank = getProviderRank(caps, nativeReady);

  if (tier === 'automatic') {
    return selectAutomatic(opts, sourcePixels, providerRank);
  }

  return selectExplicitTier(opts, tier, sourcePixels, providerRank);
}

async function selectAutomatic(
  opts: AdaptiveSelectionOptions,
  sourcePixels: number,
  providerRank: number,
): Promise<AdaptiveSelection | null> {
  const tiers: Array<'maximum' | 'quality' | 'balanced' | 'fast'> = [
    'maximum',
    'quality',
    'balanced',
    'fast',
  ];

  for (const tier of tiers) {
    const result = await tryTier(opts, tier, sourcePixels, providerRank, false);
    if (result) return result;
  }

  return null;
}

async function selectExplicitTier(
  opts: AdaptiveSelectionOptions,
  tier: 'fast' | 'balanced' | 'quality' | 'maximum',
  sourcePixels: number,
  providerRank: number,
): Promise<AdaptiveSelection | null> {
  const tierOrder: Array<'fast' | 'balanced' | 'quality' | 'maximum'> = [
    'fast',
    'balanced',
    'quality',
    'maximum',
  ];
  const startIdx = tierOrder.indexOf(tier);

  // Try the requested tier first, then fall back to lower tiers only.
  // Never upgrade to a higher tier without explicit user consent.
  for (let i = startIdx; i >= 0; i--) {
    const candidateTier = tierOrder[i]!;
    const result = await tryTier(opts, candidateTier, sourcePixels, providerRank, i !== startIdx);
    if (result) {
      if (i !== startIdx) {
        result.fellBack = true;
        result.requestedTier = tier;
      }
      return result;
    }
  }

  return null;
}

async function tryTier(
  opts: AdaptiveSelectionOptions,
  tier: 'fast' | 'balanced' | 'quality' | 'maximum',
  sourcePixels: number,
  providerRank: number,
  isFallback: boolean,
): Promise<AdaptiveSelection | null> {
  const spec = TIER_SPECS[tier];
  const minProviderRank = PROVIDER_RANK[spec.minProvider]!;

  if (providerRank < minProviderRank) {
    return null;
  }

  if (tier !== 'fast' && !spec.wasmSafe && !opts.nativeReady && !capsHasAcceleration(opts.caps)) {
    return null;
  }

  if (tier === 'maximum' && !opts.nativeReady) {
    return null;
  }

  const installed = await opts.isInstalled(spec.id);
  if (!installed) {
    return null;
  }

  // Resolve INT8 variant through precisionPolicy when available.
  let resolvedModelId: string = spec.id;
  let resolvedPrecision: ModelPrecision = 'fp32';
  let resolvedPath = await opts.getModelPath(spec.id);
  if (!resolvedPath) {
    return null;
  }
  const precisionMode = opts.precisionMode ?? 'automatic';

  if (precisionMode !== 'highestQuality') {
    try {
      const { selectModelVariantSync } = await import('./precisionPolicy');
      const variant = selectModelVariantSync(spec.id, precisionMode, 'wasm');
      if (variant.precision === 'int8' && variant.modelId !== spec.id) {
        const int8Path = await opts.getModelPath(variant.modelId);
        if (int8Path) {
          resolvedModelId = variant.modelId;
          resolvedPrecision = 'int8';
          resolvedPath = int8Path;
        }
      }
    } catch {
      // precisionPolicy unavailable; use default FP32.
    }
  }

  const estimatedPeakBytes = estimatePeakBytes(spec, sourcePixels);

  // Only apply the bare-WASM memory limit when there's no acceleration.
  // With WebGPU/WebGL/native, the model runs on the GPU or native runtime,
  // which have their own (much larger) memory pools.
  const onBareWasm =
    !opts.nativeReady && !opts.caps.hasWebGPU && !(opts.caps.hasWebGL && !opts.caps.isWebKitGTK);
  if (!spec.wasmSafe && onBareWasm) {
    if (estimatedPeakBytes > opts.caps.wasmSafeModelBytes) {
      return null;
    }
  }

  const reasons: string[] = [];
  if (isFallback) reasons.push(`Fell back from higher tier`);
  reasons.push(`${spec.name} (${tier})`);
  if (resolvedPrecision === 'int8') reasons.push('INT8');
  if (opts.nativeReady) reasons.push('native runtime');
  else if (opts.caps.hasWebGPU) reasons.push('WebGPU');
  else if (opts.caps.hasWebGL) reasons.push('WebGL');
  else reasons.push('WASM');

  return {
    modelId: resolvedModelId as WorkerModelId,
    modelPath: resolvedPath,
    precision: resolvedPrecision,
    tier,
    fellBack: isFallback,
    reason: reasons.join(', '),
    estimatedPeakBytes,
  };
}

function capsHasAcceleration(caps: EnvironmentCapabilities): boolean {
  return caps.hasWebGPU || (caps.hasWebGL && !caps.isWebKitGTK);
}
