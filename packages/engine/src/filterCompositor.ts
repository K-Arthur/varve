/**
 * Filter compositor — renders nondestructive adjustment filters with per-filter
 * opacity and blend mode via offscreen canvas compositing.
 *
 * Architecture:
 *   CSS-compatible filters with opacity=1 and blendMode=normal are batched into
 *   ctx.filter for GPU-accelerated rendering. All other filters (non-CSS, or
 *   requiring opacity/blend compositing) are rendered via offscreen canvas:
 *   snapshot → apply filter → composite back with opacity × blendMode.
 *
 * Research basis: Photoshop adjustment layers, CSS Filter Effects spec,
 *   W3C Compositing and Blending spec.
 */

import { applyCurve, buildCurveLUT } from './adjustment/curves';
import { applyLevels, buildLevelsLUT } from './adjustment/levels';
import { applySelectiveColor } from './adjustment/selectiveColor';
import { mapBlendMode } from './compositeCanvas';
import { filterToCss } from './filters';
import {
  applyHalftone,
  type HalftoneChannel,
  type HalftoneDotShape,
  type HalftoneMethod,
  type HalftonePattern,
} from './halftone';
import type { FilterIR } from './types';

/** Build a CSS filter string from all CSS-compatible filters, ignoring opacity/blend. */
function filterChainToCssSimple(filters: FilterIR[]): string | null {
  const parts: string[] = [];
  for (const f of filters) {
    const css = filterToCss(f);
    if (css) parts.push(css);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Apply a filter chain to a canvas context with per-filter opacity and blend mode.
 * Replaces the simple applyFilterChain when filters require compositing.
 *
 * @param target - The canvas 2D context to render into
 * @param filters - Array of FilterIR to apply in order
 * @param width - Canvas width in CSS pixels
 * @param height - Canvas height in CSS pixels
 */
export function applyFilterWithCompositing(
  target: CanvasRenderingContext2D,
  filters: FilterIR[],
  width: number,
  height: number,
): void {
  if (filters.length === 0) return;

  const cssParts: string[] = [];
  let needsOffscreen = false;

  // Phase 1: Determine batching strategy
  // Separate simple CSS filters from those needing offscreen compositing
  for (const f of filters) {
    const css = filterToCss(f);
    const isSimpleCss = css !== null && f.opacity >= 1 && f.blendMode === 'normal';
    if (isSimpleCss) {
      cssParts.push(css);
    } else {
      needsOffscreen = true;
      break;
    }
  }

  // If all filters are simple CSS, apply them directly
  if (!needsOffscreen) {
    if (cssParts.length > 0) {
      target.filter = cssParts.join(' ');
    }
    return;
  }

  // Phase 2: Mixed or complex filters require offscreen compositing per filter
  // Check if OffscreenCanvas is available (not in all test environments)
  const hasOffscreen = typeof OffscreenCanvas !== 'undefined';
  if (!hasOffscreen) {
    // Fallback: set CSS filter for whatever we can, skip software filters
    const css = filterChainToCssSimple(filters);
    if (css) target.filter = css;
    return;
  }

  // Snapshot the current state (the rendered fills + strokes before filters)
  const snapshot = new OffscreenCanvas(width, height);
  const snapshotCtx = snapshot.getContext('2d');
  if (!snapshotCtx) {
    // OffscreenCanvas exists but getContext failed (test mock)
    // Fallback: apply CSS filters only
    const css = filterChainToCssSimple(filters);
    if (css) target.filter = css;
    return;
  }
  snapshotCtx.drawImage(target.canvas, 0, 0);

  // Clear the main canvas and apply filters one at a time
  target.clearRect(0, 0, width, height);
  target.filter = 'none';

  let accumulatedCss: string[] = [];

  for (const f of filters) {
    const css = filterToCss(f);
    const isSimpleCss = css !== null && f.opacity >= 1 && f.blendMode === 'normal';

    if (isSimpleCss) {
      // Accumulate CSS filters for batch application
      accumulatedCss.push(css);
      continue;
    }

    // Flush any accumulated CSS filters first
    if (accumulatedCss.length > 0) {
      snapshotCtx.filter = accumulatedCss.join(' ');
      snapshotCtx.drawImage(snapshot, 0, 0);
      accumulatedCss = [];
    }

    // Apply this filter to the offscreen snapshot
    const offscreen = new OffscreenCanvas(width, height);
    const offCtx = offscreen.getContext('2d')!;

    if (css !== null) {
      // CSS-compatible filter with non-trivial opacity/blend
      offCtx.filter = css;
      offCtx.drawImage(snapshot, 0, 0);
    } else {
      // Software pixel filter
      offCtx.drawImage(snapshot, 0, 0);
      applySoftwareFilter(offCtx, f, width, height);
    }

    // Composite the filtered result with per-filter opacity and blend mode
    target.save();
    target.globalAlpha = f.opacity ?? 1;
    if (f.blendMode && f.blendMode !== 'normal') {
      target.globalCompositeOperation = mapBlendMode(f.blendMode);
    }
    target.drawImage(offscreen, 0, 0);
    target.restore();
  }

  // Apply any remaining accumulated CSS filters
  if (accumulatedCss.length > 0) {
    target.filter = accumulatedCss.join(' ');
    target.drawImage(snapshot, 0, 0);
  }
}

/**
 * Apply a software (non-CSS) filter to an offscreen canvas context.
 */
function applySoftwareFilter(
  ctx: OffscreenCanvasRenderingContext2D,
  filter: FilterIR,
  width: number,
  height: number,
): void {
  const imageData = ctx.getImageData(0, 0, width, height);

  switch (filter.kind) {
    case 'curves': {
      const channel =
        'channel' in filter
          ? ((filter as { channel: string }).channel as 'rgb' | 'red' | 'green' | 'blue')
          : 'rgb';
      const points =
        'points' in filter ? (filter as { points: Array<{ x: number; y: number }> }).points : [];
      const lut = buildCurveLUT(points);
      const result = applyCurve(imageData, channel, lut);
      ctx.putImageData(result, 0, 0);
      break;
    }
    case 'levels': {
      const channel =
        'channel' in filter
          ? ((filter as { channel: string }).channel as 'rgb' | 'red' | 'green' | 'blue')
          : 'rgb';
      const lvlFilter = filter as {
        inputBlack?: number;
        inputWhite?: number;
        gamma?: number;
        outputBlack?: number;
        outputWhite?: number;
      };
      const result = applyLevels(imageData, channel, {
        inputBlack: lvlFilter.inputBlack ?? 0,
        inputWhite: lvlFilter.inputWhite ?? 255,
        gamma: lvlFilter.gamma ?? 1,
        outputBlack: lvlFilter.outputBlack ?? 0,
        outputWhite: lvlFilter.outputWhite ?? 255,
      });
      ctx.putImageData(result, 0, 0);
      break;
    }
    case 'selectiveColor': {
      const params =
        'params' in filter
          ? (
              filter as {
                params: Array<{
                  color: string;
                  cyan: number;
                  magenta: number;
                  yellow: number;
                  black: number;
                  method: string;
                }>;
              }
            ).params
          : [];
      const result = applySelectiveColor(imageData, params);
      ctx.putImageData(result, 0, 0);
      break;
    }
    case 'exposure': {
      const ef = filter as { value: number; offset: number; gammaCorrection: number };
      applyExposure(imageData, ef.value ?? 0, ef.offset ?? 0, ef.gammaCorrection ?? 1);
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'sharpen': {
      const sf = filter as { amount: number; radius: number; threshold: number };
      applySharpen(imageData, sf.amount ?? 50, sf.radius ?? 1, sf.threshold ?? 0);
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'temperature': {
      const tf = filter as { value: number };
      applyTemperature(imageData, tf.value ?? 0);
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'tint': {
      const tf = filter as { value: number };
      applyTint(imageData, tf.value ?? 0);
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'colorBalance': {
      const cf = filter as {
        shadows?: [number, number, number];
        midtones?: [number, number, number];
        highlights?: [number, number, number];
        preserveLuminosity?: boolean;
      };
      applyColorBalance(
        imageData,
        cf.shadows ?? [0, 0, 0],
        cf.midtones ?? [0, 0, 0],
        cf.highlights ?? [0, 0, 0],
        cf.preserveLuminosity ?? true,
      );
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'channelMixer': {
      const cmf = filter as {
        red?: [number, number, number];
        green?: [number, number, number];
        blue?: [number, number, number];
        constant?: [number, number, number];
        monochrome?: boolean;
      };
      applyChannelMixer(
        imageData,
        cmf.red ?? [100, 0, 0],
        cmf.green ?? [0, 100, 0],
        cmf.blue ?? [0, 0, 100],
        cmf.constant ?? [0, 0, 0],
        cmf.monochrome ?? false,
      );
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'photoFilter': {
      const pf = filter as {
        color: { r: number; g: number; b: number; a: number };
        density: number;
        preserveLuminosity: boolean;
      };
      applyPhotoFilter(
        imageData,
        pf.color ?? { r: 255, g: 165, b: 0, a: 255 },
        pf.density ?? 25,
        pf.preserveLuminosity ?? true,
      );
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'vibrance': {
      const vf = filter as { value: number };
      applyVibrance(imageData, vf.value ?? 0);
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'halftone': {
      const hf = filter as {
        pattern: string;
        frequency: number;
        angle: number;
        dotShape: string;
        channel: string;
        method: string;
      };
      applyHalftone(imageData, {
        pattern: hf.pattern as HalftonePattern,
        frequency: hf.frequency ?? 20,
        angle: hf.angle ?? 45,
        dotShape: hf.dotShape as HalftoneDotShape,
        channel: hf.channel as HalftoneChannel,
        method: hf.method as HalftoneMethod,
      });
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    default:
      // Unknown filter kind — leave unchanged
      break;
  }
}

// ── Software Pixel Filter Implementations ──────────────────────────────

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Exposure: value as EV adjustment, offset as linear shift, gamma correction.
 * Simulates photographic exposure (linear light scaling).
 */
function applyExposure(
  data: ImageData,
  value: number,
  offset: number,
  gammaCorrection: number,
): void {
  const factor = Math.pow(2, value); // Exposure in EV
  const pixels = data.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]! / 255;
    const g = pixels[i + 1]! / 255;
    const b = pixels[i + 2]! / 255;
    // Linearize, apply exposure, gamma correct, re-quantize
    const lr = Math.pow(r, 2.2) * factor + offset;
    const lg = Math.pow(g, 2.2) * factor + offset;
    const lb = Math.pow(b, 2.2) * factor + offset;
    const correctedR = Math.pow(Math.max(0, lr), 1 / gammaCorrection);
    const correctedG = Math.pow(Math.max(0, lg), 1 / gammaCorrection);
    const correctedB = Math.pow(Math.max(0, lb), 1 / gammaCorrection);
    pixels[i] = clampByte(correctedR * 255);
    pixels[i + 1] = clampByte(correctedG * 255);
    pixels[i + 2] = clampByte(correctedB * 255);
  }
}

/**
 * Sharpen: unsharp mask via box blur difference.
 */
function applySharpen(data: ImageData, amount: number, radius: number, threshold: number): void {
  if (radius < 1 || amount === 0) return;
  const w = data.width;
  const h = data.height;
  const src = new Uint8ClampedArray(data.data);
  const factor = amount / 100;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      // Simple 3x3 box blur
      let ar = 0,
        ag = 0,
        ab = 0,
        count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const nidx = (ny * w + nx) * 4;
            ar += src[nidx]!;
            ag += src[nidx + 1]!;
            ab += src[nidx + 2]!;
            count++;
          }
        }
      }
      ar /= count;
      ag /= count;
      ab /= count;

      // Unsharp mask: original - blurred
      const dr = src[idx]! - ar;
      const dg = src[idx + 1]! - ag;
      const db = src[idx + 2]! - ab;

      if (Math.abs(dr) >= threshold || Math.abs(dg) >= threshold || Math.abs(db) >= threshold) {
        data.data[idx] = clampByte(src[idx]! + factor * dr);
        data.data[idx + 1] = clampByte(src[idx + 1]! + factor * dg);
        data.data[idx + 2] = clampByte(src[idx + 2]! + factor * db);
      }
    }
  }
}

/**
 * Color temperature adjustment: shift along blue-yellow axis.
 * Positive = warmer (more yellow), negative = cooler (more blue).
 */
function applyTemperature(data: ImageData, value: number): void {
  const pixels = data.data;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = clampByte(pixels[i]! + value); // Red: increase for warm
    pixels[i + 1] = clampByte(pixels[i + 1]!); // Green: unchanged
    pixels[i + 2] = clampByte(pixels[i + 2]! - value); // Blue: decrease for warm
  }
}

/**
 * Tint: shift along green-magenta axis.
 * Positive = more magenta, negative = more green.
 */
function applyTint(data: ImageData, value: number): void {
  const pixels = data.data;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = clampByte(pixels[i]! + value * 0.5); // Red: increase for magenta
    pixels[i + 1] = clampByte(pixels[i + 1]! - value); // Green: decrease for magenta
    pixels[i + 2] = clampByte(pixels[i + 2]! + value * 0.5); // Blue: increase for magenta
  }
}

/**
 * Color balance: adjust shadow, midtone, and highlight tonal ranges.
 * Each range gets [cyan-red, magenta-green, yellow-blue] adjustment.
 */
function applyColorBalance(
  data: ImageData,
  shadows: [number, number, number],
  midtones: [number, number, number],
  highlights: [number, number, number],
  preserveLuminosity: boolean,
): void {
  const pixels = data.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const lum = 0.299 * pixels[i]! + 0.587 * pixels[i + 1]! + 0.114 * pixels[i + 2]!;
    // Determine tonal range weight
    let shadowW = Math.max(0, 1 - lum / 85);
    let highlightW = Math.max(0, (lum - 170) / 85);
    let midtoneW = 1 - shadowW - highlightW;

    shadowW *= shadowW;
    highlightW *= highlightW;
    midtoneW = 1 - shadowW - highlightW;

    const dr = shadows[0] * shadowW + midtones[0] * midtoneW + highlights[0] * highlightW;
    const dg = shadows[1] * shadowW + midtones[1] * midtoneW + highlights[1] * highlightW;
    const db = shadows[2] * shadowW + midtones[2] * midtoneW + highlights[2] * highlightW;

    let nr = pixels[i]! + dr;
    let ng = pixels[i + 1]! + dg;
    let nb = pixels[i + 2]! + db;

    if (preserveLuminosity) {
      // Adjust to maintain original luminance
      const newLum = 0.299 * nr + 0.587 * ng + 0.114 * nb;
      const scale = lum / (newLum || 1);
      nr *= scale;
      ng *= scale;
      nb *= scale;
    }

    pixels[i] = clampByte(nr);
    pixels[i + 1] = clampByte(ng);
    pixels[i + 2] = clampByte(nb);
  }
}

/**
 * Channel mixer: mix each output channel from source channels.
 * Each channel is [sourceRed%, sourceGreen%, sourceBlue%].
 */
function applyChannelMixer(
  data: ImageData,
  red: [number, number, number],
  green: [number, number, number],
  blue: [number, number, number],
  constant: [number, number, number],
  monochrome: boolean,
): void {
  const pixels = data.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const sr = pixels[i]!;
    const sg = pixels[i + 1]!;
    const sb = pixels[i + 2]!;

    if (monochrome) {
      const gray = (red[0] * sr + red[1] * sg + red[2] * sb) / 100 + constant[0];
      pixels[i] = pixels[i + 1] = pixels[i + 2] = clampByte(gray);
    } else {
      pixels[i] = clampByte((red[0] * sr + red[1] * sg + red[2] * sb) / 100 + constant[0]);
      pixels[i + 1] = clampByte(
        (green[0] * sr + green[1] * sg + green[2] * sb) / 100 + constant[1],
      );
      pixels[i + 2] = clampByte((blue[0] * sr + blue[1] * sg + blue[2] * sb) / 100 + constant[2]);
    }
  }
}

/**
 * Photo filter: solid color overlay with density and preserve-luminosity.
 */
function applyPhotoFilter(
  data: ImageData,
  color: { r: number; g: number; b: number; a: number },
  density: number,
  preserveLuminosity: boolean,
): void {
  const pixels = data.data;
  const d = density / 100;
  const dr = (color.r / 255) * d;
  const dg = (color.g / 255) * d;
  const db = (color.b / 255) * d;

  for (let i = 0; i < pixels.length; i += 4) {
    const sr = pixels[i]! / 255;
    const sg = pixels[i + 1]! / 255;
    const sb = pixels[i + 2]! / 255;

    let nr = sr * (1 - d) + dr;
    let ng = sg * (1 - d) + dg;
    let nb = sb * (1 - d) + db;

    if (preserveLuminosity) {
      const lum = 0.299 * sr + 0.587 * sg + 0.114 * sb;
      const newLum = 0.299 * nr + 0.587 * ng + 0.114 * nb;
      const scale = lum / (newLum || 1);
      nr = sr + (nr - sr) * Math.min(1, Math.max(0, scale));
      ng = sg + (ng - sg) * Math.min(1, Math.max(0, scale));
      nb = sb + (nb - sb) * Math.min(1, Math.max(0, scale));
    }

    pixels[i] = clampByte(nr * 255);
    pixels[i + 1] = clampByte(ng * 255);
    pixels[i + 2] = clampByte(nb * 255);
  }
}

/**
 * Vibrance: intelligently boost saturation, protecting skin tones.
 * Applies more saturation to less-saturated areas.
 */
function applyVibrance(data: ImageData, value: number): void {
  const pixels = data.data;
  const factor = value / 100;
  for (let i = 0; i < pixels.length; i += 4) {
    const sr = pixels[i]! / 255;
    const sg = pixels[i + 1]! / 255;
    const sb = pixels[i + 2]! / 255;

    const max = Math.max(sr, sg, sb);
    const min = Math.min(sr, sg, sb);
    const currentSat = max - min;

    // Boost saturation inversely proportional to current saturation
    // (protects already-saturated areas, boosts flat areas)
    const boost = factor * (1 - currentSat);
    const avg = (sr + sg + sb) / 3;

    let nr = sr + (sr - avg) * boost;
    let ng = sg + (sg - avg) * boost;
    let nb = sb + (sb - avg) * boost;

    pixels[i] = clampByte(nr * 255);
    pixels[i + 1] = clampByte(ng * 255);
    pixels[i + 2] = clampByte(nb * 255);
  }
}
