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
import { applyLevels } from './adjustment/levels';
import type { SelectiveColorParams, SelectiveColorTarget } from './adjustment/selectiveColor';
import { applySelectiveColor } from './adjustment/selectiveColor';
import { applyShadowHighlight } from './adjustment/shadowHighlight';
import { applyBlackAndWhite } from './blackAndWhite';
import { gaussianBlurSeparable } from './blur';
import {
  applyColorHalftone,
  type ColorHalftoneDotShape,
  type ColorHalftoneMode,
} from './colorHalftone';
import { blendPixels, mapBlendMode } from './compositeCanvas';
import { applyDuotone } from './duotone';
import { filterToCss, supportsCanvasFilter } from './filters';
import { applyGradientMapFilter } from './gradientMap';
import {
  applyHalftone,
  type HalftoneChannel,
  type HalftoneDotShape,
  type HalftoneMethod,
  type HalftonePattern,
} from './halftone';
import { applyBloom } from './liveEffects/bloom';
import { applyCaustics } from './liveEffects/caustics';
import { applyCrt } from './liveEffects/crt';
import { applyDither, type CoordSpace } from './liveEffects/dither';
import { applyLensFlare } from './liveEffects/lensFlare';
import { applyLightLeak } from './liveEffects/lightLeak';
import { applyLightShafts } from './liveEffects/lightShafts';
import { applyPaletteSnap } from './liveEffects/paletteSnap';
import type { EffectQuality } from './liveEffects/quality';
import { applyRgbSplit } from './liveEffects/rgbSplit';
import { applyVhs } from './liveEffects/vhs';
import { applyLutToImageData } from './lut/apply';
import { deserializeLutTransform } from './lut/codec';
import { applyPosterize } from './posterize';
import { createRasterSurface, type RasterCanvasContext } from './rasterSurface';
import { applyThreshold } from './threshold';
import { applyTritone } from './tritone';
import type { FilterIR } from './types';

/**
 * Render options for a filter chain: the caller's quality tier (the serialized
 * per-effect `quality` param resolves against this) and the coordinate-space
 * mapping used to anchor doc-space parameters (dither cells, split offsets,
 * bloom radii) so effects don't change when the canvas is panned or zoomed.
 */
export interface FilterRenderOptions {
  quality?: EffectQuality;
  coordSpace?: CoordSpace;
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
  options: FilterRenderOptions = {},
): void {
  if (filters.length === 0) return;

  let current: ReturnType<typeof createRasterSurface>;
  try {
    current = createRasterSurface(width, height);
  } catch {
    // This API is post-render: merely assigning ctx.filter here would only
    // affect a future draw and leave the existing pixels unchanged. Use the
    // portable software path when an intermediate surface is unavailable.
    for (const filter of filters)
      applySoftwareFilterWithCompositing(target, filter, width, height, options);
    return;
  }
  current.context.drawImage(target.canvas, 0, 0);

  for (const f of filters) {
    const css = filterToCss(f);
    let filtered: ReturnType<typeof createRasterSurface>;
    try {
      filtered = createRasterSurface(width, height);
    } catch {
      applySoftwareFilterWithCompositing(current.context, f, width, height, options);
      continue;
    }
    if (css && supportsCanvasFilter(filtered.context)) {
      filtered.context.filter = css;
      filtered.context.drawImage(current.canvas, 0, 0);
    } else {
      filtered.context.drawImage(current.canvas, 0, 0);
      applySoftwareFilter(filtered.context, f, width, height, options);
    }

    if ((f.opacity ?? 1) >= 1 && (!f.blendMode || f.blendMode === 'normal')) {
      current = filtered;
      continue;
    }

    try {
      const composed = createRasterSurface(width, height);
      composed.context.drawImage(current.canvas, 0, 0);
      composed.context.globalAlpha = f.opacity ?? 1;
      composed.context.globalCompositeOperation = mapBlendMode(
        f.blendMode ?? 'normal',
      ) as GlobalCompositeOperation;
      composed.context.drawImage(filtered.canvas, 0, 0);
      current = composed;
    } catch {
      const backdrop = current.context.getImageData(0, 0, width, height);
      const source = filtered.context.getImageData(0, 0, width, height);
      current.context.putImageData(
        blendPixels(backdrop, source, f.blendMode ?? 'normal', f.opacity ?? 1),
        0,
        0,
      );
    }
  }

  target.save();
  try {
    if (typeof target.setTransform === 'function') {
      target.setTransform(1, 0, 0, 1, 0, 0);
    }
    target.clearRect(0, 0, width, height);
    target.filter = 'none';
    target.globalAlpha = 1;
    target.globalCompositeOperation = 'source-over';
    target.drawImage(current.canvas, 0, 0);
  } finally {
    target.restore();
  }
}

/** Software-only fallback that preserves per-filter opacity and blend mode. */
function applySoftwareFilterWithCompositing(
  target: RasterCanvasContext,
  filter: FilterIR,
  width: number,
  height: number,
  options: FilterRenderOptions,
): void {
  const backdrop = target.getImageData(0, 0, width, height);
  applySoftwareFilter(target, filter, width, height, options);
  const opacity = filter.opacity ?? 1;
  if (opacity >= 1 && (!filter.blendMode || filter.blendMode === 'normal')) return;
  const source = target.getImageData(0, 0, width, height);
  target.putImageData(blendPixels(backdrop, source, filter.blendMode ?? 'normal', opacity), 0, 0);
}

/**
 * Apply a software (non-CSS) filter to an offscreen canvas context.
 */
export function applySoftwareFilter(
  ctx: RasterCanvasContext,
  filter: FilterIR,
  width: number,
  height: number,
  options: FilterRenderOptions = {},
): void {
  const imageData = ctx.getImageData(0, 0, width, height);

  switch (filter.kind) {
    case 'brightness':
    case 'contrast':
    case 'saturation':
    case 'hueRotate':
    case 'sepia':
    case 'grayscale':
    case 'invert':
    case 'opacity': {
      applyPortableCssFilter(imageData, filter);
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'blur': {
      ctx.putImageData(
        gaussianBlurSeparable(imageData, Math.max(0, Math.round(filter.radius))),
        0,
        0,
      );
      break;
    }
    case 'curves': {
      const channel =
        'channel' in filter
          ? ((filter as { channel: string }).channel as 'rgb' | 'red' | 'green' | 'blue')
          : 'rgb';
      const serializedPoints =
        'points' in filter
          ? (
              filter as unknown as {
                points: Array<{ input?: number; output?: number; x?: number; y?: number }>;
              }
            ).points
          : [];
      const points = serializedPoints.map((point) => ({
        x: point.input !== undefined ? point.input / 255 : (point.x ?? 0),
        y: point.output !== undefined ? point.output / 255 : (point.y ?? 0),
      }));
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
        inputShadows?: number;
        inputMidtones?: number;
        inputHighlights?: number;
        outputShadows?: number;
        outputHighlights?: number;
        inputBlack?: number;
        inputWhite?: number;
        gamma?: number;
        outputBlack?: number;
        outputWhite?: number;
      };
      const result = applyLevels(imageData, channel, {
        inputBlack: lvlFilter.inputShadows ?? lvlFilter.inputBlack ?? 0,
        inputWhite: lvlFilter.inputHighlights ?? lvlFilter.inputWhite ?? 255,
        gamma: lvlFilter.inputMidtones ?? lvlFilter.gamma ?? 1,
        outputBlack: lvlFilter.outputShadows ?? lvlFilter.outputBlack ?? 0,
        outputWhite: lvlFilter.outputHighlights ?? lvlFilter.outputWhite ?? 255,
      });
      ctx.putImageData(result, 0, 0);
      break;
    }
    case 'selectiveColor': {
      const scFilter = filter as {
        colorRange: string;
        cyan: number;
        magenta: number;
        yellow: number;
        black: number;
        relative: boolean;
      };
      const colorMap: Record<string, SelectiveColorTarget> = {
        reds: 'red',
        yellows: 'yellow',
        greens: 'green',
        cyans: 'cyan',
        blues: 'blue',
        magentas: 'magenta',
        whites: 'white',
        neutrals: 'neutral',
        blacks: 'black',
      };
      const params: SelectiveColorParams[] = [
        {
          color: colorMap[scFilter.colorRange] ?? 'neutral',
          cyan: scFilter.cyan ?? 0,
          magenta: scFilter.magenta ?? 0,
          yellow: scFilter.yellow ?? 0,
          black: scFilter.black ?? 0,
          method: scFilter.relative ? 'relative' : 'absolute',
        },
      ];
      const result = applySelectiveColor(imageData, params);
      ctx.putImageData(result, 0, 0);
      break;
    }
    case 'shadowHighlight': {
      const sf = filter as {
        shadows: number;
        highlights: number;
        tonalWidth: number;
        midpoint: number;
      };
      applyShadowHighlight(imageData, {
        shadows: sf.shadows ?? 0,
        highlights: sf.highlights ?? 0,
        tonalWidth: sf.tonalWidth ?? 50,
        midpoint: sf.midpoint ?? 50,
      });
      ctx.putImageData(imageData, 0, 0);
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
        shadows: { cyanRed: number; magentaGreen: number; yellowBlue: number };
        midtones: { cyanRed: number; magentaGreen: number; yellowBlue: number };
        highlights: { cyanRed: number; magentaGreen: number; yellowBlue: number };
        preserveLuminosity: boolean;
      };
      const triplet = (t: {
        cyanRed: number;
        magentaGreen: number;
        yellowBlue: number;
      }): [number, number, number] => [t.cyanRed, t.magentaGreen, t.yellowBlue];
      applyColorBalance(
        imageData,
        triplet(cf.shadows),
        triplet(cf.midtones),
        triplet(cf.highlights),
        cf.preserveLuminosity,
      );
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'channelMixer': {
      // FilterIR has single-output-channel format; engine expects all 3 at once.
      // Convert: outputChannel + redPercent/greenPercent/bluePercent define the
      // mix for one output channel; other channels pass through unchanged.
      const cmf = filter as {
        outputChannel: string;
        redPercent: number;
        greenPercent: number;
        bluePercent: number;
        constant: number;
        monochrome: boolean;
      };
      const rPct = cmf.redPercent ?? 100;
      const gPct = cmf.greenPercent ?? 0;
      const bPct = cmf.bluePercent ?? 0;
      const cnst = cmf.constant ?? 0;
      let red: [number, number, number];
      let green: [number, number, number];
      let blue: [number, number, number];
      let constant: [number, number, number];
      switch (cmf.outputChannel) {
        case 'red':
          red = [rPct, gPct, bPct];
          green = [0, 100, 0];
          blue = [0, 0, 100];
          constant = [cnst, 0, 0];
          break;
        case 'green':
          red = [100, 0, 0];
          green = [rPct, gPct, bPct];
          blue = [0, 0, 100];
          constant = [0, cnst, 0];
          break;
        case 'blue':
          red = [100, 0, 0];
          green = [0, 100, 0];
          blue = [rPct, gPct, bPct];
          constant = [0, 0, cnst];
          break;
        default:
          red = [100, 0, 0];
          green = [0, 100, 0];
          blue = [0, 0, 100];
          constant = [0, 0, 0];
      }
      applyChannelMixer(imageData, red, green, blue, constant, cmf.monochrome ?? false);
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'photoFilter': {
      // FilterIR stores color as [r,g,b,a] tuple; engine expects {r,g,b,a} object.
      const pf = filter as {
        color: readonly [number, number, number, number];
        density: number;
        preserveLuminosity: boolean;
      };
      const colorTuple = pf.color ?? [255, 165, 0, 255];
      applyPhotoFilter(
        imageData,
        { r: colorTuple[0], g: colorTuple[1], b: colorTuple[2], a: colorTuple[3] },
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
        threshold?: number;
        intensity?: number;
        softness?: number;
        invert?: boolean;
        foregroundColor?: [number, number, number];
        backgroundColor?: [number, number, number];
        channelAngles?: { c?: number; m?: number; y?: number; k?: number };
        registrationOffset?: {
          c?: [number, number];
          m?: [number, number];
          y?: [number, number];
          k?: [number, number];
        };
        tacLimit?: number;
        blackGeneration?: 'none' | 'gcr' | 'ucr';
        gcrStrength?: number;
        previewChannel?: 'composite' | 'c' | 'm' | 'y' | 'k';
        dotGain?: number;
      };
      // Map the UI 'pattern' field to the engine's effective dotShape.
      // Pattern is the high-level screen type; dotShape is the engine primitive.
      // When they differ, pattern takes precedence so the UI selector works.
      const patternToDotShape: Record<string, HalftoneDotShape> = {
        dot: 'round',
        line: 'line',
        cross: 'cross',
        circle: 'circle',
      };
      const effectiveDotShape = patternToDotShape[hf.pattern] ?? (hf.dotShape as HalftoneDotShape);
      // Document anchoring: the preview rasterizes the adjustment backdrop in
      // viewport-anchored device pixels, so the region's document-space origin
      // and the camera scale must reach the screening engine. Without this,
      // panning shifts the pattern phase relative to the artwork (swimming)
      // and zooming changes the dot density. Export (no coordSpace) keeps the
      // plain full-document behavior.
      const coord = options.coordSpace;
      let offsetX: number | undefined;
      let offsetY: number | undefined;
      let pixelScale = 1;
      if (coord && coord.scale > 0) {
        pixelScale = coord.scale;
        offsetX = (coord.regionX - coord.originX) / coord.scale;
        offsetY = (coord.regionY - coord.originY) / coord.scale;
      }
      applyHalftone(
        imageData,
        {
          pattern: hf.pattern as HalftonePattern,
          frequency: hf.frequency ?? 20,
          angle: hf.angle ?? 45,
          dotShape: effectiveDotShape,
          channel: hf.channel as HalftoneChannel,
          method: hf.method as HalftoneMethod,
          threshold: hf.threshold,
          intensity: hf.intensity,
          softness: hf.softness,
          invert: hf.invert,
          foregroundColor: hf.foregroundColor,
          backgroundColor: hf.backgroundColor,
        },
        offsetX,
        offsetY,
        pixelScale,
      );
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'chain': {
      for (const child of filter.filters) applySoftwareFilter(ctx, child, width, height);
      break;
    }
    case 'gradientMap': {
      const gf = filter as {
        stops: readonly {
          position: number;
          color: readonly [number, number, number, number];
          opacity?: number;
          midpoint?: number;
        }[];
        dither: boolean;
        preserveLuminosity: boolean;
        ditherSize?: 4 | 8;
        mode?: 'luminance' | 'channel';
        channelStops?: {
          r?: readonly {
            position: number;
            color: readonly [number, number, number, number];
            opacity?: number;
            midpoint?: number;
          }[];
          g?: readonly {
            position: number;
            color: readonly [number, number, number, number];
            opacity?: number;
            midpoint?: number;
          }[];
          b?: readonly {
            position: number;
            color: readonly [number, number, number, number];
            opacity?: number;
            midpoint?: number;
          }[];
        };
        opacityStops?: readonly {
          position: number;
          midpoint?: number;
          opacity: number;
        }[];
        reverse?: boolean;
        intensity?: number;
        luminanceMode?: import('./gradientMap').GradientMapLuminanceMode;
        preserveSourceAlpha?: boolean;
        interpolation?: import('@varve/shared').GradientInterpolationSpace;
        lutSize?: number;
      };
      applyGradientMapFilter(imageData, {
        stops: gf.stops,
        dither: gf.dither,
        preserveLuminosity: gf.preserveLuminosity,
        ditherSize: gf.ditherSize,
        mode: gf.mode,
        channelStops: gf.channelStops,
        opacityStops: gf.opacityStops,
        reverse: gf.reverse,
        intensity: gf.intensity,
        luminanceMode: gf.luminanceMode,
        preserveSourceAlpha: gf.preserveSourceAlpha,
        interpolation: gf.interpolation,
        lutSize: gf.lutSize,
      });
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'tritone': {
      const tf = filter as {
        shadowColor: readonly [number, number, number, number];
        midtoneColor: readonly [number, number, number, number];
        highlightColor: readonly [number, number, number, number];
        shadowPoint: number;
        highlightPoint: number;
        intensity: number;
        preserveLuminosity: boolean;
        interpolation?: 'smoothstep' | 'linear';
      };
      applyTritone(imageData, {
        shadowColor: tf.shadowColor,
        midtoneColor: tf.midtoneColor,
        highlightColor: tf.highlightColor,
        shadowPoint: tf.shadowPoint,
        highlightPoint: tf.highlightPoint,
        intensity: tf.intensity,
        preserveLuminosity: tf.preserveLuminosity,
        interpolation: tf.interpolation,
      });
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'colorHalftone': {
      const chf = filter as {
        screenSize: number;
        angle: number;
        dotShape: string;
        mode: string;
        intensity: number;
        inkColor?: readonly [number, number, number, number];
      };
      applyColorHalftone(imageData, {
        screenSize: chf.screenSize ?? 12,
        angle: chf.angle ?? 0,
        dotShape: chf.dotShape as ColorHalftoneDotShape,
        mode: chf.mode as ColorHalftoneMode,
        intensity: chf.intensity ?? 1,
        inkColor: chf.inkColor,
      });
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'duotone': {
      const df = filter as {
        shadowColor: readonly [number, number, number, number];
        highlightColor: readonly [number, number, number, number];
        shadowPoint: number;
        highlightPoint: number;
        intensity: number;
        preserveLuminosity: boolean;
        interpolation?: 'smoothstep' | 'linear';
      };
      applyDuotone(imageData, {
        shadowColor: df.shadowColor,
        highlightColor: df.highlightColor,
        shadowPoint: df.shadowPoint,
        highlightPoint: df.highlightPoint,
        intensity: df.intensity,
        preserveLuminosity: df.preserveLuminosity,
        interpolation: df.interpolation,
      });
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'blackAndWhite': {
      const bf = filter as {
        reds: number;
        yellows: number;
        greens: number;
        cyans: number;
        blues: number;
        magentas: number;
        brightness: number;
        tintColor?: readonly [number, number, number, number];
        preserveLuminosity: boolean;
      };
      applyBlackAndWhite(imageData, {
        reds: bf.reds,
        yellows: bf.yellows,
        greens: bf.greens,
        cyans: bf.cyans,
        blues: bf.blues,
        magentas: bf.magentas,
        brightness: bf.brightness,
        tintColor: bf.tintColor,
        preserveLuminosity: bf.preserveLuminosity,
      });
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'posterize': {
      const pf = filter as { levels: number };
      applyPosterize(imageData, { levels: pf.levels });
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'threshold': {
      const tf = filter as { level: number };
      applyThreshold(imageData, { level: tf.level });
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'lut': {
      const lf = filter as {
        lutJson: string;
        interpolation?: string;
        intensity?: number;
        linearize?: boolean;
      };
      if (lf.lutJson) {
        try {
          const transform = deserializeLutTransform(lf.lutJson);
          const interpolation =
            (lf.interpolation as 'nearest' | 'trilinear' | 'tetrahedral') ?? 'tetrahedral';
          const intensity = lf.intensity ?? 1;
          const linearize = lf.linearize ?? false;
          applyLutToImageData(imageData, transform, intensity, interpolation, linearize);
        } catch {
          // Parse failure: leave image unchanged
        }
      }
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'dither': {
      const df = filter as Parameters<typeof applyDither>[1];
      applyDither(imageData, df, options.coordSpace);
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'paletteSnap': {
      const pf = filter as Parameters<typeof applyPaletteSnap>[1];
      applyPaletteSnap(imageData, pf, options.coordSpace);
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'bloom': {
      const bf = filter as Parameters<typeof applyBloom>[1];
      applyBloom(imageData, bf, { quality: options.quality, coordSpace: options.coordSpace });
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'rgbSplit': {
      const rf = filter as Parameters<typeof applyRgbSplit>[1];
      applyRgbSplit(imageData, rf, options.coordSpace);
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'crt': {
      const cf = filter as Parameters<typeof applyCrt>[1];
      applyCrt(imageData, cf);
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'vhs': {
      const vf = filter as Parameters<typeof applyVhs>[1];
      applyVhs(imageData, vf, { quality: options.quality });
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'lightShafts': {
      const lf = filter as Parameters<typeof applyLightShafts>[1];
      applyLightShafts(imageData, lf, { quality: options.quality });
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'lensFlare': {
      const lf = filter as Parameters<typeof applyLensFlare>[1];
      applyLensFlare(imageData, lf, { quality: options.quality });
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'lightLeak': {
      const lf = filter as Parameters<typeof applyLightLeak>[1];
      applyLightLeak(imageData, lf);
      ctx.putImageData(imageData, 0, 0);
      break;
    }
    case 'caustics': {
      const cf = filter as Parameters<typeof applyCaustics>[1];
      applyCaustics(imageData, cf, { quality: options.quality, coordSpace: options.coordSpace });
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

function applyPortableCssFilter(data: ImageData, filter: FilterIR): void {
  const pixels = data.data;
  const amount = 'value' in filter ? filter.value : 0;
  const t = Math.max(0, Math.min(1, amount / 100));
  const radians = (amount * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    if (pixels[i + 3] === 0) continue;
    switch (filter.kind) {
      case 'brightness': {
        const factor = Math.max(0, 1 + amount / 100);
        pixels[i] = clampByte(r * factor);
        pixels[i + 1] = clampByte(g * factor);
        pixels[i + 2] = clampByte(b * factor);
        break;
      }
      case 'contrast': {
        const factor = Math.max(0, 1 + amount / 100);
        pixels[i] = clampByte((r - 128) * factor + 128);
        pixels[i + 1] = clampByte((g - 128) * factor + 128);
        pixels[i + 2] = clampByte((b - 128) * factor + 128);
        break;
      }
      case 'saturation': {
        const factor = Math.max(0, 1 + amount / 100);
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        pixels[i] = clampByte(luma + (r - luma) * factor);
        pixels[i + 1] = clampByte(luma + (g - luma) * factor);
        pixels[i + 2] = clampByte(luma + (b - luma) * factor);
        break;
      }
      case 'grayscale': {
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        pixels[i] = clampByte(r + (luma - r) * t);
        pixels[i + 1] = clampByte(g + (luma - g) * t);
        pixels[i + 2] = clampByte(b + (luma - b) * t);
        break;
      }
      case 'invert':
        pixels[i] = clampByte(r + (255 - 2 * r) * t);
        pixels[i + 1] = clampByte(g + (255 - 2 * g) * t);
        pixels[i + 2] = clampByte(b + (255 - 2 * b) * t);
        break;
      case 'opacity':
        pixels[i + 3] = clampByte(pixels[i + 3]! * t);
        break;
      case 'sepia': {
        const sr = 0.393 * r + 0.769 * g + 0.189 * b;
        const sg = 0.349 * r + 0.686 * g + 0.168 * b;
        const sb = 0.272 * r + 0.534 * g + 0.131 * b;
        pixels[i] = clampByte(r + (sr - r) * t);
        pixels[i + 1] = clampByte(g + (sg - g) * t);
        pixels[i + 2] = clampByte(b + (sb - b) * t);
        break;
      }
      case 'hueRotate': {
        pixels[i] = clampByte(
          r * (0.213 + cos * 0.787 - sin * 0.213) +
            g * (0.715 - cos * 0.715 - sin * 0.715) +
            b * (0.072 - cos * 0.072 + sin * 0.928),
        );
        pixels[i + 1] = clampByte(
          r * (0.213 - cos * 0.213 + sin * 0.143) +
            g * (0.715 + cos * 0.285 + sin * 0.14) +
            b * (0.072 - cos * 0.072 - sin * 0.283),
        );
        pixels[i + 2] = clampByte(
          r * (0.213 - cos * 0.213 - sin * 0.787) +
            g * (0.715 - cos * 0.715 + sin * 0.715) +
            b * (0.072 + cos * 0.928 + sin * 0.072),
        );
        break;
      }
    }
  }
}

function premultiply(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 255) continue;
    if (a === 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      continue;
    }
    data[i] = clampByte((data[i]! * a) / 255);
    data[i + 1] = clampByte((data[i + 1]! * a) / 255);
    data[i + 2] = clampByte((data[i + 2]! * a) / 255);
  }
}

function unpremultiply(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 0 || a === 255) continue;
    const inv = 255 / a;
    data[i] = clampByte(data[i]! * inv);
    data[i + 1] = clampByte(data[i + 1]! * inv);
    data[i + 2] = clampByte(data[i + 2]! * inv);
  }
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
  const factor = 2 ** value; // Exposure in EV
  const pixels = data.data;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const r = pixels[i]! / 255;
    const g = pixels[i + 1]! / 255;
    const b = pixels[i + 2]! / 255;
    // Linearize, apply exposure, gamma correct, re-quantize
    const lr = r ** 2.2 * factor + offset;
    const lg = g ** 2.2 * factor + offset;
    const lb = b ** 2.2 * factor + offset;
    const correctedR = Math.max(0, lr) ** (1 / gammaCorrection);
    const correctedG = Math.max(0, lg) ** (1 / gammaCorrection);
    const correctedB = Math.max(0, lb) ** (1 / gammaCorrection);
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

  // Operate on premultiplied alpha to avoid dark fringing at transparent edges
  premultiply(src);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
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

  unpremultiply(data.data);
}

/**
 * Color temperature adjustment: shift along blue-yellow axis.
 * Positive = warmer (more yellow), negative = cooler (more blue).
 */
function applyTemperature(data: ImageData, value: number): void {
  const pixels = data.data;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
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
    if (pixels[i + 3] === 0) continue;
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
    if (pixels[i + 3] === 0) continue;
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
    if (pixels[i + 3] === 0) continue;
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
    if (pixels[i + 3] === 0) continue;
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
    if (pixels[i + 3] === 0) continue;
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

    const nr = sr + (sr - avg) * boost;
    const ng = sg + (sg - avg) * boost;
    const nb = sb + (sb - avg) * boost;

    pixels[i] = clampByte(nr * 255);
    pixels[i + 1] = clampByte(ng * 255);
    pixels[i + 2] = clampByte(nb * 255);
  }
}
