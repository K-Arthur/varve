/**
 * Print image manifest — decoded image pixels for the Rust print pipeline.
 *
 * `varve-print` embeds an image fill only when an `ExportManifest` resolves
 * its `src`; without one, `render_fills` substitutes a 16×16 checkerboard
 * placeholder (see `crates/varve-print/src/lib.rs`). The desktop PDF
 * raster-fallback (`export_node_pdf`) and the PDF/X commands all accept a
 * `manifest_json` argument, but nothing ever built one — so every image
 * reaching those routes would silently export a checkerboard. This module is
 * the single builder.
 *
 * Contract (mirrors `resources::ImageResource`, which has no serde rename):
 * - `data`: raw **RGBA** bytes, base64 standard alphabet with padding. The
 *   Rust deserializer accepts base64 or a JSON byte array; base64 keeps the
 *   IPC payload at ~4/3 of the pixel bytes instead of ~4x.
 * - `color_space`: `'Rgb'` — un-premultiplied sRGB straight from canvas
 *   readback (alpha is extracted into a PDF SMask by the Rust side).
 *   Press CMYK conversion of image pixels is NOT implemented in this path;
 *   PDF/X-1a therefore still receives RGB images (documented boundary —
 *   strictly better than the checkerboard placeholder it replaced).
 * - Bounded: total decoded bytes are capped so a huge page fails with an
 *   actionable error instead of exhausting memory on 4 GB-class devices.
 */

import { cachedImageDims, getImageCache } from '@varve/engine';

/** Maximum total decoded RGBA bytes accepted into one print manifest. */
export const PRINT_MANIFEST_MAX_TOTAL_BYTES = 192 * 1024 * 1024;

export interface PrintImageResource {
  id: string;
  src: string;
  mime_type: string;
  width: number;
  height: number;
  /** base64 (standard, padded) raw RGBA bytes. */
  data: string;
  color_space: 'Rgb';
}

export interface PrintImageManifest {
  images: PrintImageResource[];
  patterns: never[];
}

interface RgbaEntry {
  src: string;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function bytesToBase64(bytes: Uint8ClampedArray): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function assembleManifest(entries: readonly RgbaEntry[]): string | undefined {
  if (entries.length === 0) return undefined;
  let total = 0;
  const images: PrintImageResource[] = entries.map((entry, index) => {
    total += entry.data.length;
    return {
      id: `print-image-${index}`,
      src: entry.src,
      // The payload is raw RGBA samples (already decoded); mime_type records
      // the originating raster encoding for diagnostics only.
      mime_type: 'image/raw-rgba',
      width: entry.width,
      height: entry.height,
      data: bytesToBase64(entry.data),
      color_space: 'Rgb',
    };
  });
  if (total > PRINT_MANIFEST_MAX_TOTAL_BYTES) {
    const limitMb = Math.round(PRINT_MANIFEST_MAX_TOTAL_BYTES / (1024 * 1024));
    const totalMb = Math.round(total / (1024 * 1024));
    throw new Error(
      `PDF export image content (${totalMb} MB decoded) exceeds the ${limitMb} MB print limit. Reduce the export scale or export a smaller region and try again.`,
    );
  }
  return JSON.stringify({ images, patterns: [] } satisfies PrintImageManifest);
}

async function readRgbaFromSource(src: string): Promise<RgbaEntry> {
  const image = await getImageCache().load(src);
  const { width, height } = cachedImageDims(image);
  if (width <= 0 || height <= 0) {
    throw new Error(
      'PDF export could not read the decoded dimensions of an embedded image. The image failed to decode; export again after the image loads.',
    );
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('PDF export could not allocate a 2D context to read image pixels.');
  }
  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  return { src, width, height, data: imageData.data };
}

/**
 * Build the manifest JSON for a set of image-fill sources (scene/engine
 * `fill.src` values). Deduplicates sources; returns `undefined` when the set
 * is empty so callers can omit the IPC argument entirely.
 */
export async function buildPrintImageManifestForSrcs(
  srcs: readonly string[],
): Promise<string | undefined> {
  const entries: RgbaEntry[] = [];
  const seen = new Set<string>();
  for (const src of srcs) {
    if (!src || seen.has(src)) continue;
    seen.add(src);
    entries.push(await readRgbaFromSource(src));
  }
  return assembleManifest(entries);
}

/**
 * Build the manifest for a freshly rasterized PNG blob (the desktop PDF
 * raster-fallback route). Decodes through `createImageBitmap` + canvas
 * readback — the same path the browser's PNG-in-PDF writer uses — so the
 * export-sized bitmap never enters the shared image cache.
 */
export async function buildPrintImageManifestFromPngBlob(
  blob: Blob,
  src: string,
): Promise<string | undefined> {
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = bitmap;
    if (width <= 0 || height <= 0) {
      throw new Error('PDF export rasterized to an empty image.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('PDF export could not allocate a 2D context to read image pixels.');
    }
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);
    return assembleManifest([{ src, width, height, data: imageData.data }]);
  } finally {
    bitmap.close?.();
  }
}

/**
 * Collect `src` values of every visible image fill in an engine-flat
 * subtree (the shape `flattenSceneToEngine` returns). Both fill shapes are
 * accepted: the wire/scene shape nests the payload (`fill.image.src`, which
 * is exactly what `varve-bridge` reads for `FillIR::Image.src`) and the
 * flattened engine IR carries `fill.src` directly. Pattern tiles are
 * intentionally excluded: they need `PatternResource` entries this builder
 * does not produce, and the print pipeline falls back to a grey tile with an
 * explicit warning comment rather than a silent placeholder.
 */
export function collectImageFillSrcs(
  nodes: readonly {
    fills?: readonly {
      type?: string;
      visible?: boolean;
      src?: string;
      image?: { src?: string };
    }[];
  }[],
): string[] {
  const srcs: string[] = [];
  for (const node of nodes) {
    for (const fill of node.fills ?? []) {
      if (fill.type !== 'image' || fill.visible === false) continue;
      const src = fill.image?.src ?? fill.src;
      if (src) srcs.push(src);
    }
  }
  return srcs;
}
