/**
 * Unified model manifest loader — single source of truth for all ONNX models.
 *
 * Reads /models/manifest.json (version 2 format) and serves entries for
 * background removal, upscaling, and future model families through the
 * same interface. Consolidates the separate model sets formerly scattered
 * across modelManifest.ts and upscaleModels.ts.
 */
import type {
  ModelAcquisition,
  ModelManifestEntry,
  ModelPrecision,
  ModelUnavailableReason,
} from './types';

export interface RawManifestEntry {
  id: string;
  filename: string;
  localPath: string;
  sha256: string | null;
  bundled: boolean;
  remoteUrl: string;
  /**
   * Sibling `.onnx.data` holding weights stored outside the graph. Dropping it
   * here would download a graph that cannot initialize a session.
   */
  remoteDataUrl?: string;
  precision?: ModelPrecision;
  sourceModelId?: string;
  sourceSha256?: string;
  notes?: string;
}

export interface RawManifest {
  version: number;
  models: RawManifestEntry[];
}

let cachedManifest: ModelManifestEntry[] | null = null;
let manifestPromise: Promise<ModelManifestEntry[] | null> | null = null;

const MANIFEST_FETCH_TIMEOUT = 5_000;

function inferCategory(id: string): string {
  if (id.startsWith('upscale-')) return 'upscaling';
  if (id.startsWith('birefnet-') || id.startsWith('u2netp') || id.startsWith('isnet-'))
    return 'segmentation';
  if (id.startsWith('sam2-')) return 'segmentation';
  if (id === 'scunet') return 'denoising';
  if (id.startsWith('depth-')) return 'depth';
  if (id.includes('ocr') || id.includes('text-detect') || id.startsWith('tr-ocr')) return 'ocr';
  if (id.includes('classifier') || id.includes('embedder')) return 'classification';
  if (
    id.startsWith('font-') ||
    (id.includes('font') && (id.includes('detect') || id.includes('match') || id.includes('recog')))
  )
    return 'classification';
  return 'other';
}

const KNOWN_SIZES: Record<string, number> = {
  u2netp: 4_574_861,
  'u2netp-int8': 1_200_000,
  'isnet-general-use': 178_648_008,
  'birefnet-general-lite': 224_005_088,
  'birefnet-general': 972_666_916,
  'upscale-realesr-general': 4_866_438,
  'upscale-realesr-general-int8': 1_300_000,
  scunet: 18_000_000,
  'sam2-hiera-tiny': 154902133_902_201,
  'sam2-hiera-small': 183344311_344_379,
  'tr-ocr-base-printed': 340_000_000,
  'depth-anything-v2-small': 25_000_000,
};

function computeSizeBytes(id: string, bundled: boolean): number {
  const known = KNOWN_SIZES[id];
  if (known !== undefined) return known;
  return bundled ? 5_000_000 : 50_000_000;
}

function computePeakMemory(sizeBytes: number, isInt8: boolean, isUpscale: boolean): number {
  if (isUpscale) {
    return Math.round(sizeBytes * 3.5);
  }
  const mult = isInt8 ? 2.5 : 4.0;
  return Math.round(sizeBytes * mult);
}

function entryDescription(id: string, notes?: string): string {
  if (notes) return notes;
  if (id === 'u2netp' || id === 'u2netp-int8')
    return 'Fast preview quality, works on most images. Bundled with the app.';
  if (id === 'isnet-general-use')
    return 'Enhanced balanced quality for people, animals, vehicles, and objects.';
  if (id === 'birefnet-general-lite')
    return 'High quality, handles complex edges including hair and fur.';
  if (id === 'birefnet-general')
    return 'Best quality, handles hair, fur, transparency, and fine detail.';
  if (id === 'upscale-realesr-general' || id === 'upscale-realesr-general-int8')
    return 'Real-ESRGAN x4 general-purpose upscaling for photos and illustrations. Bundled with the app.';
  if (id === 'scunet')
    return 'SCUNet — removes noise, JPEG artifacts, and grain from photos while preserving detail.';
  if (id === 'sam2-hiera-tiny' || id === 'sam2-hiera-small')
    return 'SAM2 — interactive object segmentation via point, box, or mask prompts. Click foreground/background, drag box, iteratively refine.';
  if (id === 'tr-ocr-base-printed')
    return 'TrOCR — printed Latin text recognition from images. Produces structured text with confidence scores.';

  if (id === 'depth-anything-v2-small')
    return 'Depth-Anything-V2 Small — monocular depth estimation for lens blur, 3D effects, depth-aware masking. Input: 518x518 RGB. Output: relative depth map.';
  return '';
}

function normalizeEntry(raw: RawManifestEntry): ModelManifestEntry {
  const isInt8 = raw.precision === 'int8';
  const isUpscale = raw.id.startsWith('upscale-');
  const isBundledInt8 = isInt8 && raw.bundled;
  const isBundled = raw.bundled;
  const category = inferCategory(raw.id) as ModelManifestEntry['category'];

  const sizeBytes = computeSizeBytes(raw.id, isBundled);
  // Prefer the manifest's recorded peak (measured on hardware) over the
  // size-derived heuristic: the heuristic underestimates segmentation
  // models by 3-17x (measured retained RSS 2026-08-13: u2netp ~330 MB,
  // IS-Net ~1.3 GB, BiRefNet Lite ~7 GB, BiRefNet Full ~8.5 GB).
  const manifestPeak = (
    raw as RawManifestEntry & {
      tensorContract?: { peakMemoryBytes?: number };
    }
  ).tensorContract?.peakMemoryBytes;
  const peakMemoryBytes = manifestPeak ?? computePeakMemory(sizeBytes, isInt8, isUpscale);
  const base: ModelManifestEntry = {
    id: raw.id,
    name: modelDisplayName(raw.id),
    description: entryDescription(raw.id, raw.notes),
    sizeBytes,
    remoteUrl: raw.remoteUrl ?? '',
    ...(raw.remoteDataUrl ? { remoteDataUrl: raw.remoteDataUrl } : {}),
    checksum: raw.sha256 ?? '',
    bundled: isBundled,
    inputSpec: null,
    quality: modelQuality(raw.id),
    peakMemoryBytes,
    gpuRecommended: !isBundledInt8 && !isUpscale,
    precision: raw.precision ?? 'fp32',
    ...(raw.sourceModelId ? { sourceModelId: raw.sourceModelId } : {}),
    ...(raw.sourceSha256 ? { sourceSha256: raw.sourceSha256 } : {}),
    ...(category ? { category } : {}),
    ...(raw.localPath ? { localPath: raw.localPath } : {}),
    acquisition: deriveAcquisition(raw),
  };

  // Quality validation is read from the validation report files at
  // apps/desktop/public/models/quantized/{model}-validation-report.json.
  // We do NOT hardcode a pass here — the reports show INT8 quality is
  // model-dependent and must be measured, not assumed.
  if (isBundledInt8) {
    base.qualityValidation = {
      passed: false,
      meanMae: 0.0,
      meanPsnrDb: 0.0,
      validatedAt: 'unvalidated',
      ortVersion: '1.27.1',
    };
  }

  return base;
}

/**
 * Derive an acquisition strategy from raw manifest fields. This centralises
 * the previously-scattered truthiness checks (`remoteUrl === ''`,
 * `sha256 === null`, etc.) into one place.
 */
function deriveAcquisition(raw: RawManifestEntry): ModelAcquisition {
  // Bundled models ship with the app — no download needed.
  if (raw.bundled) {
    return {
      kind: 'bundled',
      assetPath: raw.localPath || `/models/${raw.id}.onnx`,
      sha256: raw.sha256 ?? '',
    };
  }

  // Has a download URL and a checksum → directly downloadable.
  if (raw.remoteUrl && raw.sha256) {
    return {
      kind: 'remote',
      sources: [{ url: raw.remoteUrl, sha256: raw.sha256 }],
      sha256: raw.sha256,
    };
  }

  // No URL, not bundled → unavailable.
  if (!raw.remoteUrl) {
    const notes = raw.notes ?? '';
    let reasonCode: ModelUnavailableReason = 'source-unavailable';
    if (
      notes.toLowerCase().includes('no public onnx') ||
      notes.toLowerCase().includes('export pending')
    ) {
      reasonCode = 'no-public-onnx';
    }
    return {
      kind: 'unavailable',
      reasonCode,
      detail: notes || 'No download source available',
    };
  }

  // Has URL but no checksum — ambiguous, treat as unavailable.
  return {
    kind: 'unavailable',
    reasonCode: 'source-unavailable',
    detail: 'Model has a download URL but no integrity checksum',
  };
}

function modelDisplayName(id: string): string {
  const names: Record<string, string> = {
    u2netp: 'U\u00B2-Net Light (FP32)',
    'u2netp-int8': 'U\u00B2-Net Light (INT8)',
    'isnet-general-use': 'IS-Net General Use',
    'birefnet-general-lite': 'BiRefNet Lite',
    'birefnet-general': 'BiRefNet Full',
    'upscale-realesr-general': 'Real-ESRGAN x4 (FP32)',
    'upscale-realesr-general-int8': 'Real-ESRGAN x4 (INT8)',
    scunet: 'SCUNet Denoise',
    'sam2-hiera-tiny': 'SAM2 Tiny',
    'sam2-hiera-small': 'SAM2 Small',
    'tr-ocr-base-printed': 'TrOCR (Printed Text)',
    'depth-anything-v2-small': 'Depth-Anything-V2 Small',
  };
  return names[id] ?? id;
}

function modelQuality(id: string): number {
  const qualities: Record<string, number> = {
    u2netp: 3,
    'u2netp-int8': 2.5,
    'isnet-general-use': 4,
    'birefnet-general-lite': 4.5,
    'birefnet-general': 5,
    'upscale-realesr-general': 4,
    'upscale-realesr-general-int8': 3.5,
    scunet: 4,
    'sam2-hiera-tiny': 154902133.5,
    'sam2-hiera-small': 183344311,
    'tr-ocr-base-printed': 4,
    'depth-anything-v2-small': 4.5,
  };
  return qualities[id] ?? 1;
}

/** Load the model manifest from /models/manifest.json. */
export async function loadModelCatalog(signal?: AbortSignal): Promise<ModelManifestEntry[] | null> {
  if (cachedManifest) return cachedManifest;
  if (manifestPromise) return manifestPromise;

  manifestPromise = (async () => {
    try {
      if (typeof fetch === 'undefined') return null;

      // Check if caller already aborted
      if (signal?.aborted) return null;

      const controller = new AbortController();

      // Forward caller's abort signal to the internal controller
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });

      const timeout = setTimeout(() => controller.abort(), MANIFEST_FETCH_TIMEOUT);
      try {
        const res = await fetch('/models/manifest.json', { signal: controller.signal });
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        if (!res.ok) return null;
        const raw = (await res.json()) as RawManifest;
        cachedManifest = raw.models.map(normalizeEntry);
        return cachedManifest;
      } catch {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        return null;
      }
    } catch {
      return null;
    } finally {
      manifestPromise = null;
    }
  })();

  return manifestPromise;
}

/** Get a single manifest entry by model ID. */
export async function getModelEntry(
  modelId: string,
  signal?: AbortSignal,
): Promise<ModelManifestEntry | null> {
  const catalog = await loadModelCatalog(signal);
  return catalog?.find((m) => m.id === modelId) ?? null;
}

/** Get all models in a category. */
export async function getModelsByCategory(
  category: NonNullable<ModelManifestEntry['category']>,
  signal?: AbortSignal,
): Promise<ModelManifestEntry[]> {
  const catalog = await loadModelCatalog(signal);
  return catalog?.filter((m) => m.category === category) ?? [];
}

/** Get all FP32 models (non-quantized source models). */
export async function getSourceModels(signal?: AbortSignal): Promise<ModelManifestEntry[]> {
  const catalog = await loadModelCatalog(signal);
  return catalog?.filter((m) => !m.precision || m.precision === 'fp32') ?? [];
}

/** Get all INT8 quantized variants. */
export async function getQuantizedModels(signal?: AbortSignal): Promise<ModelManifestEntry[]> {
  const catalog = await loadModelCatalog(signal);
  return catalog?.filter((m) => m.precision === 'int8') ?? [];
}

/** Get the INT8 variant for a source model, if one exists. */
export async function getInt8Variant(
  sourceModelId: string,
  signal?: AbortSignal,
): Promise<ModelManifestEntry | null> {
  const catalog = await loadModelCatalog(signal);
  return catalog?.find((m) => m.sourceModelId === sourceModelId && m.precision === 'int8') ?? null;
}

/** Check if a model's INT8 quality validation passed. */
export async function isInt8Validated(modelId: string, signal?: AbortSignal): Promise<boolean> {
  const entry = await getModelEntry(modelId, signal);
  if (entry?.precision !== 'int8') return false;
  return entry.qualityValidation?.passed ?? false;
}

/** Reset the cached manifest (for testing). */
export function resetManifestCache(): void {
  cachedManifest = null;
  manifestPromise = null;
}

/** Compute SHA-256 hex digest from an ArrayBuffer. */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify an ArrayBuffer against an expected SHA-256 checksum.
 *
 * - `null` expected → skip verification (model metadata incomplete).
 * - `''` (empty string) → FAIL verification (model explicitly has no checksum).
 * - Valid hex string → normal SHA-256 comparison.
 */
export async function verifyChecksum(data: ArrayBuffer, expected: string | null): Promise<boolean> {
  if (expected === null) return true;
  if (expected === '') return false;
  const actual = await sha256Hex(data);
  return actual === expected.toLowerCase();
}
