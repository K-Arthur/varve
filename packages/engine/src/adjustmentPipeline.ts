/**
 * Adjustment pipeline — shared contract for nondestructive filter execution.
 *
 * Every adjustment in the system follows this execution model regardless of
 * whether it runs on CPU, GPU, or during export. This module defines the
 * contract and provides shared infrastructure; individual filter engines
 * (gradientMap, colorHalftone, halftone, tritone, curves, levels, etc.)
 * implement the per-pixel or per-image processing step.
 *
 * Architecture
 * ────────────
 *                    ┌──────────────┐
 *                    │  Adjustment   │  scene-layer type (serialized in doc)
 *                    │  (filters.ts) │
 *                    └──────┬───────┘
 *                           │ adjustmentToFilter()
 *                           ▼
 *                    ┌──────────────┐
 *                    │   FilterIR   │  portable IR (engine/types.ts)
 *                    │  + opacity   │
 *                    │  + blendMode │
 *                    └──────┬───────┘
 *                           │
 *               ┌───────────┼───────────┐
 *               ▼           ▼           ▼
 *        ┌──────────┐ ┌──────────┐ ┌──────────┐
 *        │  GPU     │ │   CPU   │ │  Export  │
 *        │  (WGSL)  │ │ (JS px) │ │(raster)  │
 *        └──────────┘ └──────────┘ └──────────┘
 *               │           │           │
 *               └───────┬───┘           │
 *                       ▼               ▼
 *                ┌──────────────┐ ┌──────────────┐
 *                │  Composite   │ │  Encoded     │
 *                │  (canvas)    │ │  (PNG/SVG    │
 *                │              │ │   embed)     │
 *                └──────────────┘ └──────────────┘
 *
 * Color and alpha rules
 * ─────────────────────
 * 1. Input to every filter kernel is straight (non-premultiplied) RGBA,
 *    sRGB-encoded (gamma ≈ 2.2).
 * 2. Kernels operate in sRGB-encoded space unless explicitly documented
 *    otherwise (e.g., blur uses linear-light internally for proper
 *    colour-bleeding, but converts back before returning).
 * 3. Per-stop opacity (gradientMap), per-filter opacity, and per-layer
 *    opacity compose multiplicatively: finalAlpha = sourceAlpha × stopOp ×
 *    filterOp × layerOp.
 * 4. Kernels must preserve the alpha channel — transparent input pixels
 *    (a === 0) are skipped; semi-transparent pixels are transformed
 *    proportionally.
 * 5. Premultiplied alpha is an internal implementation detail of specific
 *    kernels (sharpen, blur) and must be undone before returning.
 *
 * Bounds
 * ──────
 * Every adjustment rendered on canvas captures backdrop from the bounding
 * box of its scope targets. The captured region may expand to include
 * neighbouring pixels that blur or spread effects would sample. Expansion
 * is documented per-filter in effectBounds().
 *
 * Cache keys
 * ──────────
 * The SubtreeIrCache key for an adjustment node includes:
 *   - The adjustment node's own node ID and version
 *   - All adjustment parameter values
 *   - The scope-target node IDs (for backdrop capture invalidation)
 *   - The document zoom level (for GPU resolution-dependent kernels)
 *
 * Export
 * ──────
 * Adjustments are CPU-rasterized during export. The export pipeline
 * renders the affected subtree (target nodes within the adjustment scope)
 * at the export resolution, applies the filter stack via the same CPU path
 * used in preview, and embeds the result. Unaffected nodes remain vector
 * elements in the output. See exportRasterizedSubtree().
 *
 * Capability detection
 * ────────────────────
 * WebGPU compute support is probed once at startup via
 * selectWebGpuAdapter() + device creation. When unavailable (no WebGPU,
 * software adapter declined, or device lost), all GPU paths fall through
 * to the CPU, which always produces identical output.
 */

import { type AdapterSelectionResult, selectWebGpuAdapter } from './gpuAdapter';
import type { FilterIR } from './types';

// ── Capability state ───────────────────────────────────────────────────────

export type GpuCapability =
  | { kind: 'unavailable' }
  | { kind: 'available'; adapter: GPUAdapter; device: GPUDevice }
  | { kind: 'declined-software' };

let gpuCapability: GpuCapability = { kind: 'unavailable' };
let gpuInitPromise: Promise<GpuCapability> | null = null;

export function getGpuCapability(): GpuCapability {
  return gpuCapability;
}

export async function initGpuCapability(): Promise<GpuCapability> {
  if (gpuInitPromise) return gpuInitPromise;
  gpuInitPromise = initGpuInternal();
  return gpuInitPromise;
}

async function initGpuInternal(): Promise<GpuCapability> {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    gpuCapability = { kind: 'unavailable' };
    return gpuCapability;
  }

  try {
    const result: AdapterSelectionResult = await selectWebGpuAdapter(navigator.gpu, {
      requireHardwareAdapter: false,
    });

    if (result.kind === 'unavailable') {
      gpuCapability = { kind: 'unavailable' };
    } else if (result.kind === 'declined-software') {
      gpuCapability = { kind: 'declined-software' };
    } else {
      const device = await result.adapter.requestDevice();
      gpuCapability = { kind: 'available', adapter: result.adapter, device };
    }
  } catch {
    gpuCapability = { kind: 'unavailable' };
  }

  return gpuCapability;
}

/** Reset GPU capability (e.g., on device loss). */
export function resetGpuCapability(): void {
  const current = gpuCapability;
  if (current.kind === 'available') {
    current.device.destroy();
  }
  gpuCapability = { kind: 'unavailable' };
  gpuInitPromise = null;
}

// ── Filter properties ──────────────────────────────────────────────────────

/**
 * Filter capability classification.
 * - 'css-canvas' — Canvas2D ctx.filter (CSS-compatible, GPU when available)
 * - 'software-cpu' — Pure JS pixel-by-pixel (fallback or only path)
 * - 'gpu-compute' — WebGPU compute shader exists
 * - 'raster-export' — Must be rasterized for SVG/PDF export
 */
export type FilterCapability = 'css-canvas' | 'software-cpu' | 'gpu-compute' | 'raster-export';

export interface FilterProperties {
  /** Descriptive name */
  name: string;
  /** Capabilities this filter supports */
  capabilities: FilterCapability[];
  /** Whether the filter requires GPU init to attempt GPU path */
  hasGpuPath: boolean;
  /** Whether the filter has a CSS ctx.filter equivalent */
  hasCssPath: boolean;
  /** Whether the filter must always be rasterized for export */
  requiresRasterExport: boolean;
}

const FILTER_PROPERTIES: Record<string, FilterProperties> = {
  brightness: {
    name: 'Brightness',
    capabilities: ['css-canvas', 'software-cpu'],
    hasGpuPath: false,
    hasCssPath: true,
    requiresRasterExport: false,
  },
  contrast: {
    name: 'Contrast',
    capabilities: ['css-canvas', 'software-cpu'],
    hasGpuPath: false,
    hasCssPath: true,
    requiresRasterExport: false,
  },
  saturation: {
    name: 'Saturation',
    capabilities: ['css-canvas', 'software-cpu'],
    hasGpuPath: false,
    hasCssPath: true,
    requiresRasterExport: false,
  },
  hueRotate: {
    name: 'Hue Rotate',
    capabilities: ['css-canvas', 'software-cpu'],
    hasGpuPath: false,
    hasCssPath: true,
    requiresRasterExport: false,
  },
  sepia: {
    name: 'Sepia',
    capabilities: ['css-canvas', 'software-cpu'],
    hasGpuPath: false,
    hasCssPath: true,
    requiresRasterExport: false,
  },
  grayscale: {
    name: 'Grayscale',
    capabilities: ['css-canvas', 'software-cpu'],
    hasGpuPath: false,
    hasCssPath: true,
    requiresRasterExport: false,
  },
  invert: {
    name: 'Invert',
    capabilities: ['css-canvas', 'software-cpu'],
    hasGpuPath: false,
    hasCssPath: true,
    requiresRasterExport: false,
  },
  opacity: {
    name: 'Opacity',
    capabilities: ['css-canvas', 'software-cpu'],
    hasGpuPath: false,
    hasCssPath: true,
    requiresRasterExport: false,
  },
  blur: {
    name: 'Blur',
    capabilities: ['css-canvas', 'software-cpu'],
    hasGpuPath: false,
    hasCssPath: true,
    requiresRasterExport: false,
  },
  exposure: {
    name: 'Exposure',
    capabilities: ['software-cpu'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  sharpen: {
    name: 'Sharpen',
    capabilities: ['software-cpu'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  temperature: {
    name: 'Temperature',
    capabilities: ['software-cpu'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  tint: {
    name: 'Tint',
    capabilities: ['software-cpu'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  vibrance: {
    name: 'Vibrance',
    capabilities: ['software-cpu'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  levels: {
    name: 'Levels',
    capabilities: ['software-cpu'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  curves: {
    name: 'Curves',
    capabilities: ['software-cpu'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  selectiveColor: {
    name: 'Selective Color',
    capabilities: ['software-cpu'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  colorBalance: {
    name: 'Color Balance',
    capabilities: ['software-cpu'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  channelMixer: {
    name: 'Channel Mixer',
    capabilities: ['software-cpu'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  photoFilter: {
    name: 'Photo Filter',
    capabilities: ['software-cpu'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  halftone: {
    name: 'Halftone',
    capabilities: ['software-cpu', 'raster-export'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  gradientMap: {
    name: 'Gradient Map',
    capabilities: ['software-cpu', 'raster-export'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  tritone: {
    name: 'Tritone',
    capabilities: ['software-cpu', 'raster-export'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  colorHalftone: {
    name: 'Color Halftone',
    capabilities: ['gpu-compute', 'software-cpu', 'raster-export'],
    hasGpuPath: true,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  duotone: {
    name: 'Duotone',
    capabilities: ['software-cpu', 'raster-export'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  blackAndWhite: {
    name: 'Black & White',
    capabilities: ['software-cpu', 'raster-export'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  posterize: {
    name: 'Posterize',
    capabilities: ['software-cpu', 'raster-export'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  threshold: {
    name: 'Threshold',
    capabilities: ['software-cpu', 'raster-export'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  lut: {
    name: 'LUT',
    capabilities: ['software-cpu', 'raster-export'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  dither: {
    name: 'Dither',
    capabilities: ['software-cpu', 'raster-export'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  paletteSnap: {
    name: 'Palette Snap',
    capabilities: ['gpu-compute', 'software-cpu', 'raster-export'],
    hasGpuPath: true,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  bloom: {
    name: 'Bloom',
    capabilities: ['gpu-compute', 'software-cpu', 'raster-export'],
    hasGpuPath: true,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  rgbSplit: {
    name: 'RGB Split',
    capabilities: ['gpu-compute', 'software-cpu', 'raster-export'],
    hasGpuPath: true,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  crt: {
    name: 'CRT',
    capabilities: ['gpu-compute', 'software-cpu', 'raster-export'],
    hasGpuPath: true,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  vhs: {
    name: 'VHS',
    capabilities: ['gpu-compute', 'software-cpu', 'raster-export'],
    hasGpuPath: true,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  lightShafts: {
    name: 'Light Shafts',
    capabilities: ['gpu-compute', 'software-cpu', 'raster-export'],
    hasGpuPath: true,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  lensFlare: {
    name: 'Lens Flare',
    capabilities: ['gpu-compute', 'software-cpu', 'raster-export'],
    hasGpuPath: true,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  lightLeak: {
    name: 'Light Leak',
    capabilities: ['gpu-compute', 'software-cpu', 'raster-export'],
    hasGpuPath: true,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  caustics: {
    name: 'Caustics',
    capabilities: ['gpu-compute', 'software-cpu', 'raster-export'],
    hasGpuPath: true,
    hasCssPath: false,
    requiresRasterExport: true,
  },
  chain: {
    name: 'Filter Chain',
    capabilities: ['software-cpu', 'raster-export'],
    hasGpuPath: false,
    hasCssPath: false,
    requiresRasterExport: true,
  },
};

export function getFilterProperties(kind: string): FilterProperties | undefined {
  return FILTER_PROPERTIES[kind];
}

/**
 * Whether a filter kind must be rasterized for SVG/PDF export.
 * CSS-compatible filters can be represented natively; all others need
 * CPU rasterization at export resolution.
 */
export function requiresRasterExport(kind: string): boolean {
  return FILTER_PROPERTIES[kind]?.requiresRasterExport ?? true;
}

/**
 * Whether any filter in the list requires raster export.
 */
export function anyRequiresRasterExport(filters: FilterIR[]): boolean {
  return filters.some((f) => requiresRasterExport(f.kind));
}

// ── Bounds helpers ─────────────────────────────────────────────────────────

/**
 * Compute the expanded pixel bounds for a filter when applied to a given
 * source region. Expansion accounts for neighbouring-pixel sampling (blur,
 * sharpen) and dot radius (halftone).
 *
 * Returns [left, top, right, bottom] pixel offsets to expand the source rect.
 */
export function effectPixelExpansion(filter: FilterIR): [number, number, number, number] {
  switch (filter.kind) {
    case 'blur':
      return [
        Math.ceil(filter.radius),
        Math.ceil(filter.radius),
        Math.ceil(filter.radius),
        Math.ceil(filter.radius),
      ];
    case 'sharpen': {
      const r = Math.ceil(filter.radius);
      return [r, r, r, r];
    }
    case 'colorHalftone': {
      const cellSize = Math.max(2, Math.round(72 / Math.max(1, filter.screenSize)));
      return [cellSize, cellSize, cellSize, cellSize];
    }
    case 'halftone': {
      const cellSize = Math.max(2, Math.round(72 / Math.max(1, filter.frequency)));
      return [cellSize, cellSize, cellSize, cellSize];
    }
    case 'bloom': {
      const radius = Math.ceil(filter.radius ?? 0);
      const streak = Math.ceil((filter.streakLength ?? 0) * (filter.streakIntensity ?? 0) * 0.5);
      const pad = Math.max(radius, streak);
      return [pad, pad, pad, pad];
    }
    case 'rgbSplit': {
      const offsets = [
        Math.abs(filter.redX ?? 0),
        Math.abs(filter.redY ?? 0),
        Math.abs(filter.greenX ?? 0),
        Math.abs(filter.greenY ?? 0),
        Math.abs(filter.blueX ?? 0),
        Math.abs(filter.blueY ?? 0),
      ];
      const off = Math.ceil(
        Math.max(...offsets, filter.mode === 'radial' ? (filter.amount ?? 0) : 0),
      );
      return [off, off, off, off];
    }
    case 'dither':
    case 'paletteSnap': {
      const cell = Math.ceil((filter as { cellSize?: number }).cellSize ?? 1);
      return [cell, cell, cell, cell];
    }
    case 'caustics': {
      const pad = Math.ceil(32 * (filter.depth ?? 0) + (filter.refractionAmount ?? 0) * 24);
      return [pad, pad, pad, pad];
    }
    case 'crt':
    case 'vhs': {
      return [8, 8, 8, 8];
    }
    case 'lightShafts': {
      return [16, 16, 16, 16];
    }
    case 'lensFlare': {
      const pad = Math.ceil(128 * (filter.scale ?? 1) + (filter.streakIntensity ?? 0) * 64);
      return [pad, pad, pad, pad];
    }
    case 'lightLeak': {
      const pad = Math.ceil(64 * (filter.size ?? 1));
      return [pad, pad, pad, pad];
    }
    default:
      return [0, 0, 0, 0];
  }
}

/**
 * Total pixel expansion across a sequential filter stack. Spatial filters may
 * sample pixels generated by the previous filter, so their support adds rather
 * than merely taking the largest individual radius.
 */
export function totalEffectExpansion(filters: FilterIR[]): [number, number, number, number] {
  let l = 0,
    t = 0,
    r = 0,
    b = 0;
  for (const f of filters) {
    const [el, et, er, eb] = effectPixelExpansion(f);
    l += Number.isFinite(el) ? Math.max(0, el) : 0;
    t += Number.isFinite(et) ? Math.max(0, et) : 0;
    r += Number.isFinite(er) ? Math.max(0, er) : 0;
    b += Number.isFinite(eb) ? Math.max(0, eb) : 0;
  }
  return [l, t, r, b];
}

// ── RGBA helpers ───────────────────────────────────────────────────────────

export function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Convert sRGB-encoded byte to linear light [0,1].
 */
export function srgbToLinear(byte: number): number {
  const v = byte / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/**
 * Convert linear light [0,1] to sRGB-encoded byte.
 */
export function linearToSrgb(linear: number): number {
  const v = Math.max(0, Math.min(1, linear));
  const srgb = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return clampByte(srgb * 255);
}

/**
 * Blend two RGBA pixels with given alpha.
 * Uses standard over operator: result = src * a + dst * (1 - a).
 */
export function blendOver(
  src: [number, number, number, number],
  dst: [number, number, number, number],
  alpha: number,
): [number, number, number, number] {
  const a = clamp01(alpha);
  const invA = 1 - a;
  return [
    clampByte(src[0] * a + dst[0] * invA),
    clampByte(src[1] * a + dst[1] * invA),
    clampByte(src[2] * a + dst[2] * invA),
    clampByte(Math.round(src[3] * a + dst[3] * invA)),
  ];
}
