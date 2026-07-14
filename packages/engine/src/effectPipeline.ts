/**
 * Shared effect rendering pipeline — deduplicates identical pixel-processing
 * logic between `replay.ts` (standalone IR replay) and `CanvasArea.tsx`
 * (group-level rendering in the editor).
 *
 * Extracted from: replay.ts:338-451 (paintGlassMaterial pixel pipeline),
 * replay.ts:355-371 (screen-bounds), CanvasArea.tsx:1691-1831 (glassMaterial),
 * CanvasArea.tsx:1833-1890 (backgroundBlur), replay.ts:734-781 (layerBlur).
 */

import { gaussianBlurSeparable } from './blur';
import type { CompositeCanvas } from './compositeCanvas';
import type { EngineColor } from './types';

type GlassMaterialEffect = Extract<import('./types').Effect, { type: 'glassMaterial' }>;

export function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Map a world-space rect through a 2x3 affine (DOMMatrix/CTM) to get
 * the axis-aligned screen-space bounding box that encloses all four corners.
 */
export function computeScreenBounds(
  transform: { a: number; b: number; c: number; d: number; e: number; f: number },
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } {
  const m = transform;
  const mapPoint = (px: number, py: number): [number, number] => [
    m.a * px + m.c * py + m.e,
    m.b * px + m.d * py + m.f,
  ];
  const pts = [mapPoint(x, y), mapPoint(x + w, y), mapPoint(x + w, y + h), mapPoint(x, y + h)];
  const minX = Math.floor(Math.min(...pts.map((p) => p[0])));
  const minY = Math.floor(Math.min(...pts.map((p) => p[1])));
  const maxX = Math.ceil(Math.max(...pts.map((p) => p[0])));
  const maxY = Math.ceil(Math.max(...pts.map((p) => p[1])));
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

/** Extract RGB channels from an EngineColor for tint blending. */
function extractRgb(color: EngineColor): { r: number; g: number; b: number } {
  if ('r' in color) return { r: color.r, g: color.g, b: color.b };
  if ('c' in color) return { r: 0, g: 0, b: 0 };
  if ('v' in color) return { r: color.v, g: color.v, b: color.v };
  return { r: 0, g: 0, b: 0 };
}

/**
 * Apply glass material pixel pipeline to an existing CompositeCanvas in-place.
 * The CompositeCanvas must already contain the captured (and optionally blurred)
 * backdrop. Pipeline: tint mix → saturation → brightness → noise.
 *
 * The caller is responsible for:
 * 1. Creating the CompositeCanvas and capturing the backdrop
 * 2. Applying blur if needed
 * 3. Compositing the processed canvas to the target (with clip-to-shape)
 */
export function applyGlassMaterialBackdrop(
  cc: CompositeCanvas,
  w: number,
  h: number,
  effect: GlassMaterialEffect,
): void {
  // Step 1: Tint (mix with tint color at tintOpacity)
  if (effect.tintOpacity > 0) {
    const tintData = cc.getImageData(0, 0, w, h);
    const pixels = tintData.data;
    const { r: tR, g: tG, b: tB } = extractRgb(effect.tint);
    const tA = effect.tintOpacity;
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = clampByte(pixels[i]! * (1 - tA) + tR * tA);
      pixels[i + 1] = clampByte(pixels[i + 1]! * (1 - tA) + tG * tA);
      pixels[i + 2] = clampByte(pixels[i + 2]! * (1 - tA) + tB * tA);
    }
    cc.putImageData(tintData, 0, 0);
  }

  // Step 2: Saturation adjustment
  if (effect.saturation !== 1) {
    const satData = cc.getImageData(0, 0, w, h);
    const pixels = satData.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      pixels[i] = clampByte(luma + (r - luma) * effect.saturation);
      pixels[i + 1] = clampByte(luma + (g - luma) * effect.saturation);
      pixels[i + 2] = clampByte(luma + (b - luma) * effect.saturation);
    }
    cc.putImageData(satData, 0, 0);
  }

  // Step 3: Brightness adjustment
  if (effect.brightness !== 1) {
    const briData = cc.getImageData(0, 0, w, h);
    const pixels = briData.data;
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = clampByte(pixels[i]! * effect.brightness);
      pixels[i + 1] = clampByte(pixels[i + 1]! * effect.brightness);
      pixels[i + 2] = clampByte(pixels[i + 2]! * effect.brightness);
    }
    cc.putImageData(briData, 0, 0);
  }

  // Step 4: Noise/grain
  if (effect.noise > 0) {
    const noiseData = cc.getImageData(0, 0, w, h);
    const pixels = noiseData.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const seed = x * 374761393 + y * 668265263;
        const noiseVal = ((seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        const offset = (noiseVal - 0.5) * 2 * effect.noise * 255;
        pixels[idx] = clampByte(pixels[idx]! + offset);
        pixels[idx + 1] = clampByte(pixels[idx + 1]! + offset);
        pixels[idx + 2] = clampByte(pixels[idx + 2]! + offset);
      }
    }
    cc.putImageData(noiseData, 0, 0);
  }
}

/**
 * Apply background blur to an existing CompositeCanvas in-place.
 * The CompositeCanvas must already contain the captured backdrop.
 */
export function applyBackgroundBlurBackdrop(
  cc: CompositeCanvas,
  _w: number,
  _h: number,
  radius: number,
): void {
  cc.applyBlur(radius);
}

/**
 * Apply layer blur with dual-path strategy:
 * - CSS filter (`blur(Npx)`) for small radii ≤32px (GPU-accelerated)
 * - Software separable blur for large radii >32px (faster than CSS for large kernels)
 *
 * `target` is the replay target with drawImage/filter/save/restore.
 * `surface` is the CompositeCanvas containing the fills+strokes to blur.
 * `drawW`/`drawH` are the destination dimensions in target coordinate space.
 */
export function applyLayerBlur(
  target: {
    drawImage?: (src: CanvasImageSource, dx: number, dy: number, dw: number, dh: number) => void;
    save?: () => void;
    restore?: () => void;
    filter?: string;
  },
  surface: CompositeCanvas,
  radius: number,
  drawX: number,
  drawY: number,
  drawW: number,
  drawH: number,
): void {
  target.save?.();
  if (radius > 32) {
    const imageData = surface.getImageData(0, 0, surface.width, surface.height);
    const blurred = gaussianBlurSeparable(imageData, radius);
    surface.putImageData(blurred, 0, 0);
    if (target.drawImage) {
      target.drawImage(surface.canvas as unknown as CanvasImageSource, drawX, drawY, drawW, drawH);
    }
  } else {
    target.filter = `blur(${radius}px)`;
    if (target.drawImage) {
      target.drawImage(surface.canvas as unknown as CanvasImageSource, drawX, drawY, drawW, drawH);
    }
  }
  target.restore?.();
}
