/**
 * Unified model catalog — merges manifest.json entries with runtime-only
 * models (future intelligence models) and provides helper functions for
 * model selection, INT8 resolution, and compatibility checks.
 *
 * This is the single API surface for model management:
 * - Background removal models (segmentation)
 * - Upscaling models (Real-ESRGAN)
 * - Future intelligence models
 * - Quantized variants
 */

import { ModelRegistry } from './ModelRegistry';
import { getInt8Variant, loadModelCatalog } from './manifest';
import type { ModelManifestEntry, ModelState } from './types';

const FALLBACK_ENTRIES: ModelManifestEntry[] = [
  {
    id: 'u2netp',
    name: 'U\u00B2-Net Light (FP32)',
    description: 'Fast preview quality segmentation. Bundled with the app.',
    sizeBytes: 4_700_000,
    remoteUrl: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx',
    checksum: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
    bundled: true,
    inputSpec: null,
    quality: 3,
    precision: 'fp32',
    category: 'segmentation',
    peakMemoryBytes: 18_800_000,
    gpuRecommended: false,
  },
  {
    id: 'u2netp-int8',
    name: 'U\u00B2-Net Light (INT8)',
    description: 'INT8 quantized variant of U\u00B2-Net Light. Bundled with the app.',
    sizeBytes: 1_200_000,
    remoteUrl: '',
    checksum: '7b3355af9c9f76d75c3ad263f711c4ef20f812bae426b798d89c80e098b9edf3',
    bundled: true,
    inputSpec: null,
    quality: 2.5,
    precision: 'int8',
    category: 'segmentation',
    sourceModelId: 'u2netp',
    sourceSha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
    peakMemoryBytes: 3_000_000,
    gpuRecommended: false,
    qualityValidation: {
      passed: false,
      meanMae: 0.2091,
      meanPsnrDb: 30.88,
      validatedAt: '2026-07-21T00:00:00Z',
      ortVersion: '1.27.0',
      failureReasons: [
        'MAE 0.4177 > 0.05 on synthetic portrait',
        'PSNR 3.8dB < 25.0 on synthetic portrait',
        'Correlation loss 1.0034 > 0.03 on synthetic portrait',
        'Correlation loss 0.9986 > 0.03 on synthetic random',
      ],
    },
  },
  {
    id: 'isnet-general-use',
    name: 'IS-Net General Use',
    description: 'Enhanced balanced quality segmentation.',
    sizeBytes: 178_648_008,
    remoteUrl:
      'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
    checksum: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
    bundled: false,
    inputSpec: null,
    quality: 4,
    precision: 'fp32',
    category: 'segmentation',
    peakMemoryBytes: 714_600_000,
    gpuRecommended: true,
  },
  {
    id: 'birefnet-general-lite',
    name: 'BiRefNet Lite',
    description: 'High quality segmentation for complex edges.',
    sizeBytes: 224_005_088,
    remoteUrl:
      'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx',
    checksum: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333',
    bundled: false,
    inputSpec: null,
    quality: 4.5,
    precision: 'fp32',
    category: 'segmentation',
    peakMemoryBytes: 896_000_000,
    gpuRecommended: true,
  },
  {
    id: 'birefnet-general',
    name: 'BiRefNet Full',
    description: 'Best quality segmentation for hair, fur, transparency.',
    sizeBytes: 928_000_000,
    remoteUrl:
      'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx',
    checksum: '',
    bundled: false,
    inputSpec: null,
    quality: 5,
    precision: 'fp32',
    category: 'segmentation',
    peakMemoryBytes: 3_712_000_000,
    gpuRecommended: true,
  },
  {
    id: 'upscale-realesr-general',
    name: 'Real-ESRGAN x4 (FP32)',
    description: 'Real-ESRGAN general-purpose x4 upscaling. Bundled.',
    sizeBytes: 4_866_438,
    remoteUrl: '',
    checksum: '856e1f4d77f553e8871302f1782b58e315a12dac52bb0b856dde2dde149b96f7',
    bundled: true,
    inputSpec: null,
    quality: 4,
    precision: 'fp32',
    category: 'upscaling',
    peakMemoryBytes: 17_032_533,
    gpuRecommended: false,
  },
  {
    id: 'upscale-realesr-general-int8',
    name: 'Real-ESRGAN x4 (INT8)',
    description: 'INT8 quantized Real-ESRGAN general-purpose x4 upscaling. Bundled.',
    sizeBytes: 1_300_000,
    remoteUrl: '',
    checksum: '357ebd6732007dbb0d663931e8a7f923baaf9f20a4ca38511fbcd90a1fa06711',
    bundled: true,
    inputSpec: null,
    quality: 3.5,
    precision: 'int8',
    category: 'upscaling',
    sourceModelId: 'upscale-realesr-general',
    sourceSha256: '856e1f4d77f553e8871302f1782b58e315a12dac52bb0b856dde2dde149b96f7',
    peakMemoryBytes: 4_550_000,
    gpuRecommended: false,
    qualityValidation: {
      passed: false,
      meanMae: 0.0377,
      meanPsnrDb: 26.44,
      validatedAt: '2026-07-21T00:00:00Z',
      ortVersion: '1.27.0',
      failureReasons: [
        'Correlation loss 0.2201 > 0.05 on synthetic upscale',
        'Correlation loss 0.2269 > 0.05 on synthetic random',
      ],
    },
  },
  {
    id: 'scunet',
    name: 'SCUNet Denoise',
    description:
      'Real-world image denoising — removes noise, JPEG artifacts, and grain while preserving detail. No verified ONNX export currently available; needs sourcing before this model can be downloaded.',
    sizeBytes: 18_000_000,
    remoteUrl: '',
    checksum: '',
    bundled: false,
    inputSpec: null,
    quality: 4,
    precision: 'fp32',
    category: 'denoising',
    peakMemoryBytes: 72_000_000,
    gpuRecommended: false,
  },
  {
    id: 'sam2-hiera-tiny',
    name: 'SAM2 Tiny',
    description:
      'SAM2-Hiera-Tiny — interactive segmentation via point/box/mask prompts. Click foreground/background points, drag boxes, iteratively refine.',
    sizeBytes: 39_000_000,
    remoteUrl: '',
    checksum: '',
    bundled: false,
    inputSpec: null,
    quality: 3.5,
    precision: 'fp32',
    category: 'segmentation',
    peakMemoryBytes: 312_000_000,
    gpuRecommended: false,
  },
  {
    id: 'sam2-hiera-small',
    name: 'SAM2 Small',
    description:
      'SAM2-Hiera-Small — higher quality interactive segmentation. Better detail preservation than Tiny at ~2.4x the size.',
    sizeBytes: 92_000_000,
    remoteUrl: '',
    checksum: '',
    bundled: false,
    inputSpec: null,
    quality: 4,
    precision: 'fp32',
    category: 'segmentation',
    peakMemoryBytes: 736_000_000,
    gpuRecommended: true,
  },
  {
    id: 'depth-anything-v2-small',
    name: 'Depth-Anything-V2 Small (INT8)',
    description:
      'Monocular depth estimation — enables lens blur, 3D parallax, depth-aware masking, and lighting effects. Input: 518x518 RGB (multiple of 14). Output: relative depth map. Verified source: onnx-community/depth-anything-v2-small (Apache-2.0).',
    sizeBytes: 27_300_000,
    remoteUrl:
      'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_int8.onnx',
    checksum: '',
    bundled: false,
    inputSpec: null,
    quality: 4.5,
    precision: 'int8',
    category: 'depth',
    peakMemoryBytes: 100_000_000,
    gpuRecommended: false,
  },
  {
    id: 'tr-ocr-base-printed',
    name: 'TrOCR (Printed Text)',
    description:
      'Microsoft TrOCR-base-printed — OCR for printed Latin text in images, screenshots, and scanned documents. Produces structured text with per-character confidence.',
    sizeBytes: 340_000_000,
    remoteUrl: '',
    checksum: '',
    bundled: false,
    inputSpec: null,
    quality: 4,
    precision: 'fp32',
    category: 'ocr',
    peakMemoryBytes: 1_360_000_000,
    gpuRecommended: true,
  },
];

let registry: ModelRegistry | null = null;

function getRegistry(entries?: ModelManifestEntry[]): ModelRegistry {
  if (!registry) {
    registry = new ModelRegistry(entries ?? FALLBACK_ENTRIES);
  }
  return registry;
}

export async function initializeModelCatalog(signal?: AbortSignal): Promise<ModelRegistry> {
  const manifest = await loadModelCatalog(signal);
  registry = getRegistry(manifest ?? undefined);
  return registry;
}

export function getModelRegistry(): ModelRegistry {
  return getRegistry();
}

export async function resolveBestModel(
  primaryId: string,
  preferPerformance: boolean,
  signal?: AbortSignal,
): Promise<{ modelId: string; isInt8: boolean }> {
  if (preferPerformance) {
    let int8Entry: ModelManifestEntry | null = null;
    try {
      int8Entry = await getInt8Variant(primaryId, signal);
    } catch {
      // manifest unavailable
    }
    if (!int8Entry) {
      int8Entry =
        FALLBACK_ENTRIES.find((e) => e.sourceModelId === primaryId && e.precision === 'int8') ??
        null;
    }
    if (int8Entry) {
      const reg = getModelRegistry();
      if (!reg.knows(int8Entry.id)) {
        reg.register(int8Entry);
      }
      if (reg.isReady(int8Entry.id)) {
        return { modelId: int8Entry.id, isInt8: true };
      }
      if (int8Entry.bundled) {
        return { modelId: int8Entry.id, isInt8: true };
      }
    }
  }

  return { modelId: primaryId, isInt8: false };
}

export function isModelAvailable(entry: ModelManifestEntry): boolean {
  const reg = getModelRegistry();
  return reg.isReady(entry.id);
}

export function isModelReady(modelId: string): boolean {
  const reg = getModelRegistry();
  return reg.isReady(modelId);
}

export function getModelById(modelId: string): ModelManifestEntry | undefined {
  const reg = getModelRegistry();
  return reg.getEntry(modelId) ?? FALLBACK_ENTRIES.find((e) => e.id === modelId);
}

export function listAllModels(): ModelManifestEntry[] {
  const reg = getModelRegistry();
  const registered = reg.listEntries();
  if (registered.length > 0) return registered;
  return FALLBACK_ENTRIES;
}

export function listModelsByCategory(
  category: NonNullable<ModelManifestEntry['category']>,
): ModelManifestEntry[] {
  return listAllModels().filter((m) => m.category === category);
}

export function setModelState(modelId: string, state: ModelState): void {
  const reg = getModelRegistry();
  reg.setState(modelId, state);
}

export function subscribeToModel(
  modelId: string,
  fn: (modelId: string, state: ModelState) => void,
): () => void {
  const reg = getModelRegistry();
  return reg.subscribe(modelId, fn);
}

export function resetModelCatalog(): void {
  registry = null;
}

export function estimateModelMemory(modelId: string, batchSize = 1): number {
  const entry = getModelById(modelId);
  if (!entry) return 0;
  return (entry.peakMemoryBytes ?? entry.sizeBytes * 4) * batchSize;
}

export function getRecommendedProvider(modelId: string): 'cpu' | 'gpu' | 'any' {
  const entry = getModelById(modelId);
  if (!entry) return 'cpu';
  if (entry.gpuRecommended) return 'gpu';
  if (entry.precision === 'int8') return 'cpu';
  return 'any';
}
