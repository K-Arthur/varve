/**
 * Shared effect rendering pipeline — deduplicates identical pixel-processing
 * logic between `replay.ts` (standalone IR replay) and `CanvasArea.tsx`
 * (group-level rendering in the editor).
 *
 * Extracted from: replay.ts:338-451 (paintGlassMaterial pixel pipeline),
 * replay.ts:355-371 (screen-bounds), CanvasArea.tsx:1691-1831 (glassMaterial),
 * CanvasArea.tsx:1833-1890 (backgroundBlur), replay.ts:734-781 (layerBlur).
 */

import { managedColorToNormalized } from '@varve/shared';
import { gaussianBlurSeparable } from './blur';
import { blendPixels, type CompositeCanvas } from './compositeCanvas';
import type { EngineColor } from './types';

type GlassMaterialEffect = Extract<import('./types').Effect, { type: 'glassMaterial' }>;
type ChromaticAberrationEffect = Extract<import('./types').Effect, { type: 'chromaticAberration' }>;
type GlitchEffect = Extract<import('./types').Effect, { type: 'glitch' }>;
type ChannelOffset = import('./types').ChannelOffset;

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
  const [r, g, b] = managedColorToNormalized(color);
  return { r: r * 255, g: g * 255, b: b * 255 };
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

function createSeededRandom(seed: number): () => number {
  let z = Math.floor(seed) | 0;
  if (z === 0) z = 0x6d2b79f5;
  return () => {
    z += 0x6d2b79f5;
    let t = z;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hasChannelShift(offsets: ChannelOffset): boolean {
  return (
    offsets.redX !== 0 ||
    offsets.redY !== 0 ||
    offsets.greenX !== 0 ||
    offsets.greenY !== 0 ||
    offsets.blueX !== 0 ||
    offsets.blueY !== 0
  );
}

/**
 * Resolve the glitch channel displacement for this render. Static mode uses
 * the authored offsets verbatim. Seeded mode treats each authored magnitude
 * as a symmetric maximum and derives a deterministic signed displacement from
 * the effect seed. Re-rendering the same document therefore remains stable.
 */
export function resolveGlitchChannelShift(effect: GlitchEffect): ChannelOffset {
  if (effect.channelShiftMode !== 'seeded') return effect.channelShift;
  const rng = createSeededRandom(effect.seed ^ 0x4348414e);
  const jitter = (value: number): number => Math.round((rng() * 2 - 1) * Math.abs(value));
  return {
    redX: jitter(effect.channelShift.redX),
    redY: jitter(effect.channelShift.redY),
    greenX: jitter(effect.channelShift.greenX),
    greenY: jitter(effect.channelShift.greenY),
    blueX: jitter(effect.channelShift.blueX),
    blueY: jitter(effect.channelShift.blueY),
  };
}

function shiftChannelData(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  W: number,
  H: number,
  rX: number,
  rY: number,
  gX: number,
  gY: number,
  bX: number,
  bY: number,
): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      const a = src[idx + 3]!;
      out[idx + 3] = a;
      const sxR = x - rX;
      const syR = y - rY;
      out[idx] = sxR >= 0 && sxR < W && syR >= 0 && syR < H ? src[(syR * W + sxR) * 4]! : 0;
      const sxG = x - gX;
      const syG = y - gY;
      out[idx + 1] = sxG >= 0 && sxG < W && syG >= 0 && syG < H ? src[(syG * W + sxG) * 4 + 1]! : 0;
      const sxB = x - bX;
      const syB = y - bY;
      out[idx + 2] = sxB >= 0 && sxB < W && syB >= 0 && syB < H ? src[(syB * W + sxB) * 4 + 2]! : 0;
    }
  }
}

export function applyChromaticAberration(
  cc: CompositeCanvas,
  w: number,
  h: number,
  effect: ChromaticAberrationEffect,
): void {
  const intensity = Math.max(0, effect.intensity ?? 1);
  const opacity = Math.max(0, Math.min(1, effect.opacity ?? 1));
  if (opacity <= 0 || intensity <= 0) return;

  const dpr = cc.devicePixelRatio;
  const src = cc.getImageData(0, 0, w, h);
  const W = src.width;
  const H = src.height;
  const out = new ImageData(W, H);
  const s = src.data;
  const o = out.data;

  const rX = Math.round(effect.offsets.redX * intensity * dpr);
  const rY = Math.round(effect.offsets.redY * intensity * dpr);
  const gX = Math.round(effect.offsets.greenX * intensity * dpr);
  const gY = Math.round(effect.offsets.greenY * intensity * dpr);
  const bX = Math.round(effect.offsets.blueX * intensity * dpr);
  const bY = Math.round(effect.offsets.blueY * intensity * dpr);

  shiftChannelData(s, o, W, H, rX, rY, gX, gY, bX, bY);

  if (opacity < 1 || effect.blendMode !== 'normal') {
    const blended = blendPixels(src, out, effect.blendMode, opacity);
    cc.putImageData(blended, 0, 0);
  } else {
    cc.putImageData(out, 0, 0);
  }
}

export function applyGlitch(cc: CompositeCanvas, w: number, h: number, effect: GlitchEffect): void {
  const opacity = Math.max(0, Math.min(1, effect.opacity ?? 1));
  if (opacity <= 0) return;

  const dpr = cc.devicePixelRatio;
  const src = cc.getImageData(0, 0, w, h);
  const W = src.width;
  const H = src.height;

  // Start with channel-shifted copy if requested.
  let working = new ImageData(new Uint8ClampedArray(src.data), W, H);
  const resolvedChannelShift = resolveGlitchChannelShift(effect);
  if (hasChannelShift(resolvedChannelShift)) {
    const offsets = resolvedChannelShift;
    const rX = Math.round(offsets.redX * dpr);
    const rY = Math.round(offsets.redY * dpr);
    const gX = Math.round(offsets.greenX * dpr);
    const gY = Math.round(offsets.greenY * dpr);
    const bX = Math.round(offsets.blueX * dpr);
    const bY = Math.round(offsets.blueY * dpr);
    const shifted = new ImageData(W, H);
    shiftChannelData(src.data, shifted.data, W, H, rX, rY, gX, gY, bX, bY);
    working = shifted;
  }

  const rng = createSeededRandom(effect.seed);
  const temp = new ImageData(new Uint8ClampedArray(working.data), W, H);

  // Slice displacement
  const sliceHeight = Math.max(1, Math.round(effect.sliceHeight * dpr));
  const strength = effect.strength * dpr;
  const density = effect.density;
  if (strength !== 0 && density > 0) {
    for (let y = 0; y < H; y += sliceHeight) {
      if (rng() >= density) continue;
      const axis = effect.direction === 'both' ? (rng() < 0.5 ? 'x' : 'y') : effect.direction;
      const offset = Math.round((rng() * 2 - 1) * strength);
      if (offset === 0) continue;
      const yEnd = Math.min(y + sliceHeight, H);
      if (axis === 'x') {
        for (let row = y; row < yEnd; row++) {
          const srcRow = temp.data.subarray(row * W * 4, (row + 1) * W * 4);
          const dstRow = working.data.subarray(row * W * 4, (row + 1) * W * 4);
          if (offset > 0) {
            dstRow.fill(0);
            dstRow.set(srcRow.subarray(0, (W - offset) * 4), offset * 4);
          } else {
            dstRow.fill(0);
            dstRow.set(srcRow.subarray(-offset * 4, W * 4), 0);
          }
        }
      } else {
        for (let row = y; row < yEnd; row++) {
          const destY = row + offset;
          if (destY < 0 || destY >= H) continue;
          const srcRow = temp.data.subarray(row * W * 4, (row + 1) * W * 4);
          const dstRow = working.data.subarray(destY * W * 4, (destY + 1) * W * 4);
          dstRow.set(srcRow);
        }
      }
    }
  }

  // Block displacement
  const blockCount = Math.max(0, Math.round(effect.blockCount));
  const blockSize = Math.max(1, Math.round(effect.blockSize * dpr));
  const blockStrength = effect.blockStrength * dpr;
  if (blockCount > 0 && blockStrength !== 0 && blockSize > 0) {
    for (let i = 0; i < blockCount; i++) {
      const bx = Math.floor(rng() * W);
      const by = Math.floor(rng() * H);
      const offsetX = Math.round((rng() * 2 - 1) * blockStrength);
      const offsetY = Math.round((rng() * 2 - 1) * blockStrength);
      if (offsetX === 0 && offsetY === 0) continue;
      const srcX = Math.max(0, bx);
      const srcY = Math.max(0, by);
      const dstX = Math.max(0, srcX + offsetX);
      const dstY = Math.max(0, srcY + offsetY);
      const copyW = Math.min(blockSize, W - srcX, W - dstX);
      const copyH = Math.min(blockSize, H - srcY, H - dstY);
      if (copyW <= 0 || copyH <= 0) continue;
      for (let dy = 0; dy < copyH; dy++) {
        const srcRow = temp.data.subarray(
          ((srcY + dy) * W + srcX) * 4,
          ((srcY + dy) * W + srcX + copyW) * 4,
        );
        const dstRow = working.data.subarray(
          ((dstY + dy) * W + dstX) * 4,
          ((dstY + dy) * W + dstX + copyW) * 4,
        );
        dstRow.set(srcRow);
      }
    }
  }

  // Noise
  const noiseIntensity = Math.max(0, Math.min(1, effect.noiseIntensity ?? 0));
  if (noiseIntensity > 0) {
    const d = working.data;
    const amp = noiseIntensity * 255;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rng() * 2 - 1) * amp;
      d[i] = clampByte(d[i]! + n);
      d[i + 1] = clampByte(d[i + 1]! + n);
      d[i + 2] = clampByte(d[i + 2]! + n);
    }
  }

  // Scanlines
  const scanlineIntensity = Math.max(0, Math.min(1, effect.scanlineIntensity ?? 0));
  const scanlineSpacing = Math.max(1, Math.round(effect.scanlineSpacing * dpr));
  if (scanlineIntensity > 0 && scanlineSpacing > 0) {
    const d = working.data;
    const factor = 1 - scanlineIntensity;
    for (let y = 0; y < H; y += scanlineSpacing) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        d[idx] = clampByte(d[idx]! * factor);
        d[idx + 1] = clampByte(d[idx + 1]! * factor);
        d[idx + 2] = clampByte(d[idx + 2]! * factor);
      }
    }
  }

  if (opacity < 1 || effect.blendMode !== 'normal') {
    const blended = blendPixels(src, working, effect.blendMode, opacity);
    cc.putImageData(blended, 0, 0);
  } else {
    cc.putImageData(working, 0, 0);
  }
}
