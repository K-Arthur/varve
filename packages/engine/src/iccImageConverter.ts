/**
 * ICC-aware image conversion pipeline for print/export.
 *
 * Canonical flow:
 * 1. Decode source image (via ImageCache or raw bytes)
 * 2. Normalize pixel representation
 * 3. Convert to destination profile via WASM ICC (fallback analytical)
 * 4. Cache with safe invalidation
 * 5. Return converted pixels for PDF/print rendering
 */

import { convertToCmykIcc } from './adjustment/colorConversion';
import { getImageCache } from './imageCache';

export interface ImageConversionOptions {
  /** Destination ICC profile name (default 'Fogra39'). */
  profile?: string;
  /** Rendering intent (default 'relativeColorimetric'). */
  renderingIntent?: string;
  /** Black point compensation (default true). */
  blackPointCompensation?: boolean;
  /** Max dimension for preview conversion (default 2048). */
  previewMaxDimension?: number;
  /** Whether this is a preview (lower quality, faster) or final export. */
  preview?: boolean;
  /** Output color space. 'cmyk' (default) or 'rgb'. */
  outputColorSpace?: 'cmyk' | 'rgb';
}

export interface ConvertedImage {
  /** Pixel data (4 bytes per pixel: CMYK or RGBA depending on outputColorSpace). */
  data: Uint8Array;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
  /** Number of channels (4 for CMYK or RGBA). */
  channels: number;
  /** Profile used for conversion. */
  profile: string;
  /** Color space of the output data. */
  colorSpace: 'cmyk' | 'rgb';
}

export interface ExportImageResource {
  id: string;
  src: string;
  mimeType: string;
  width: number;
  height: number;
  /** RGBA pixel data converted to destination color space. */
  data: Uint8Array;
  colorSpace: 'cmyk' | 'rgb';
}

const conversionCache = new Map<string, ConvertedImage>();
const CACHE_MAX = 50;

function cacheKey(
  url: string,
  profile: string,
  intent: string,
  bpc: boolean,
  outputSpace: string,
): string {
  return `${url}::${profile}::${intent}::${bpc}::${outputSpace}`;
}

/**
 * Scale dimensions to fit within a maximum dimension, preserving aspect ratio.
 * Returns original dimensions if both are within the limit.
 */
export function scaleDimensions(
  w: number,
  h: number,
  maxDim: number,
): { width: number; height: number } {
  if (w <= maxDim && h <= maxDim) return { width: w, height: h };
  const scale = Math.min(maxDim / w, maxDim / h, 1);
  return {
    width: Math.round(w * scale),
    height: Math.round(h * scale),
  };
}

/**
 * Load an image URL into a canvas and extract RGBA pixel data.
 * Works in both browser (HTMLCanvasElement) and worker (OffscreenCanvas) contexts.
 * Returns null if canvas access is unavailable.
 */
export async function loadImagePixels(
  url: string,
  maxDim?: number,
): Promise<{ rgba: Uint8Array; width: number; height: number } | null> {
  const imageCache = getImageCache();
  const img = await imageCache.load(url);
  if (!img) return null;

  const w = 'naturalWidth' in img ? img.naturalWidth : img.width;
  const h = 'naturalHeight' in img ? img.naturalHeight : img.height;
  if (w === 0 || h === 0) return null;

  const dims = maxDim ? scaleDimensions(w, h, maxDim) : { width: w, height: h };

  if (typeof OffscreenCanvas !== 'undefined') {
    const oc = new OffscreenCanvas(dims.width, dims.height);
    const ctx = oc.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, dims.width, dims.height);
    const imageData = ctx.getImageData(0, 0, dims.width, dims.height);
    return {
      rgba: new Uint8Array(imageData.data.buffer),
      width: dims.width,
      height: dims.height,
    };
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = dims.width;
    canvas.height = dims.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, dims.width, dims.height);
    const imageData = ctx.getImageData(0, 0, dims.width, dims.height);
    return {
      rgba: new Uint8Array(imageData.data.buffer),
      width: dims.width,
      height: dims.height,
    };
  }

  return null;
}

/**
 * Convert an image URL to a destination ICC profile.
 * Uses ImageCache to load the source image, then converts pixels.
 * Returns the converted image data or null if conversion fails.
 */
export async function convertImageForExport(
  url: string,
  options: ImageConversionOptions = {},
): Promise<ConvertedImage | null> {
  const profile = options.profile ?? 'Fogra39';
  const intent = options.renderingIntent ?? 'relativeColorimetric';
  const bpc = options.blackPointCompensation ?? true;
  const outputSpace = options.outputColorSpace ?? 'cmyk';
  const key = cacheKey(url, profile, intent, bpc, outputSpace);

  const cached = conversionCache.get(key);
  if (cached) return cached;

  const maxDim = options.preview ? (options.previewMaxDimension ?? 2048) : Infinity;

  const pixels = await loadImagePixels(url, maxDim);
  if (!pixels) return null;

  const { rgba, width, height } = pixels;
  let converted: Uint8Array;

  if (outputSpace === 'cmyk') {
    const cmyk = await convertToCmykIcc(rgba, width, height, profile, intent, bpc);
    if (!cmyk) return null;
    converted = cmyk;
  } else {
    converted = rgba;
  }

  const result: ConvertedImage = {
    data: converted,
    width,
    height,
    channels: 4,
    profile,
    colorSpace: outputSpace,
  };

  if (conversionCache.size >= CACHE_MAX) {
    const firstKey = conversionCache.keys().next().value;
    if (firstKey) conversionCache.delete(firstKey);
  }
  conversionCache.set(key, result);

  return result;
}

/**
 * Build an export manifest from scene nodes, converting image fills to
 * the destination color space. Walks all nodes looking for image fills,
 * loads each unique image URL once, converts via ICC pipeline, and
 * returns the manifest ready to pass to the Rust print engine.
 */
export async function buildExportImageManifest(
  srcUrls: string[],
  options: ImageConversionOptions = {},
): Promise<ExportImageResource[]> {
  const seen = new Set<string>();
  const resources: ExportImageResource[] = [];
  let idCounter = 0;

  for (const src of srcUrls) {
    if (seen.has(src)) continue;
    seen.add(src);

    const converted = await convertImageForExport(src, options);
    if (!converted) continue;

    const mimeType = guessMimeType(src);

    resources.push({
      id: `img_${idCounter++}`,
      src,
      mimeType,
      width: converted.width,
      height: converted.height,
      data: converted.data,
      colorSpace: converted.colorSpace,
    });
  }

  return resources;
}

function guessMimeType(src: string): string {
  if (src.startsWith('data:image/')) {
    return src.slice(5, src.indexOf(';'));
  }
  if (src.endsWith('.png')) return 'image/png';
  if (src.endsWith('.jpg') || src.endsWith('.jpeg')) return 'image/jpeg';
  if (src.endsWith('.webp')) return 'image/webp';
  if (src.endsWith('.gif')) return 'image/gif';
  if (src.endsWith('.avif')) return 'image/avif';
  return 'image/png';
}

/**
 * Invalidate the ICC conversion cache for a given URL (or all entries).
 */
export function invalidateIccCache(url?: string): void {
  if (url) {
    for (const key of conversionCache.keys()) {
      if (key.startsWith(url)) conversionCache.delete(key);
    }
  } else {
    conversionCache.clear();
  }
}

/**
 * Collect all unique image source URLs from a set of scene node fills.
 * Scans FillIR image fills and pattern fills for image URLs.
 */
export function collectImageSrcsFromFills(fills: unknown[]): string[] {
  const srcs: string[] = [];
  for (const fill of fills) {
    const f = fill as Record<string, unknown>;
    if (f.type === 'image' && f.visible !== false) {
      const src = f.src as string | undefined;
      if (src) srcs.push(src);
    }
    if (f.type === 'pattern' && f.visible !== false) {
      const tileSrc = f.tileSrc as string | undefined;
      if (tileSrc) srcs.push(tileSrc);
    }
  }
  return srcs;
}
