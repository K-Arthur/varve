/**
 * Filter IR and Canvas2D/CSS fallback for nondestructive image adjustments.
 *
 * This module defines both the user-facing adjustment types and the portable
 * filter IR. It lives in @varve/engine so the IR contract and the Canvas2D
 * fallback stay together; @varve/scene re-exports/adapts these as needed.
 *
 * Research basis: CSS filter functions, SVG filters, Photoshop adjustment layers.
 */

import type { LutInputSpace, LutInterpolation } from './lut/types';
import type { Color, FilterIR } from './types';

export type AdjustmentKind =
  | 'brightness'
  | 'contrast'
  | 'exposure'
  | 'saturation'
  | 'hueRotate'
  | 'sepia'
  | 'grayscale'
  | 'invert'
  | 'opacity'
  | 'blur'
  | 'sharpen'
  | 'temperature'
  | 'tint'
  | 'vibrance'
  | 'levels'
  | 'curves'
  | 'selectiveColor'
  | 'colorBalance'
  | 'channelMixer'
  | 'photoFilter'
  | 'halftone'
  | 'gradientMap'
  | 'tritone'
  | 'colorHalftone'
  | 'duotone'
  | 'blackAndWhite'
  | 'posterize'
  | 'threshold'
  | 'lut';

export type AdjustmentBlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'softLight'
  | 'hardLight'
  | 'colorDodge'
  | 'colorBurn'
  | 'darken'
  | 'lighten'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'passThrough';

export interface AdjustmentBase {
  id: string;
  kind: AdjustmentKind;
  visible: boolean;
  opacity: number;
  blendMode: AdjustmentBlendMode;
}

export interface BrightnessAdjustment extends AdjustmentBase {
  kind: 'brightness';
  value: number;
}
export interface ContrastAdjustment extends AdjustmentBase {
  kind: 'contrast';
  value: number;
}
export interface ExposureAdjustment extends AdjustmentBase {
  kind: 'exposure';
  value: number;
  offset: number;
  gammaCorrection: number;
}
export interface SaturationAdjustment extends AdjustmentBase {
  kind: 'saturation';
  value: number;
}
export interface HueRotateAdjustment extends AdjustmentBase {
  kind: 'hueRotate';
  value: number;
}
export interface SepiaAdjustment extends AdjustmentBase {
  kind: 'sepia';
  value: number;
}
export interface GrayscaleAdjustment extends AdjustmentBase {
  kind: 'grayscale';
  value: number;
}
export interface InvertAdjustment extends AdjustmentBase {
  kind: 'invert';
  value: number;
}
export interface OpacityAdjustment extends AdjustmentBase {
  kind: 'opacity';
  value: number;
}
export interface BlurAdjustment extends AdjustmentBase {
  kind: 'blur';
  radius: number;
}
export interface SharpenAdjustment extends AdjustmentBase {
  kind: 'sharpen';
  amount: number;
  radius: number;
  threshold: number;
}
export interface TemperatureAdjustment extends AdjustmentBase {
  kind: 'temperature';
  value: number;
}
export interface TintAdjustment extends AdjustmentBase {
  kind: 'tint';
  value: number;
}
export interface VibranceAdjustment extends AdjustmentBase {
  kind: 'vibrance';
  value: number;
}
export interface LevelsAdjustment extends AdjustmentBase {
  kind: 'levels';
  inputShadows: number;
  inputMidtones: number;
  inputHighlights: number;
  outputShadows: number;
  outputHighlights: number;
  channel: 'rgb' | 'red' | 'green' | 'blue';
}
export interface CurvesPoint {
  input: number;
  output: number;
}
export interface CurvesAdjustment extends AdjustmentBase {
  kind: 'curves';
  channel: 'rgb' | 'red' | 'green' | 'blue';
  points: CurvesPoint[];
}
export interface SelectiveColorAdjustment extends AdjustmentBase {
  kind: 'selectiveColor';
  colorRange:
    | 'reds'
    | 'yellows'
    | 'greens'
    | 'cyans'
    | 'blues'
    | 'magentas'
    | 'whites'
    | 'neutrals'
    | 'blacks';
  cyan: number;
  magenta: number;
  yellow: number;
  black: number;
  relative: boolean;
}
export interface ColorBalanceTriplet {
  cyanRed: number;
  magentaGreen: number;
  yellowBlue: number;
}
export interface ColorBalanceAdjustment extends AdjustmentBase {
  kind: 'colorBalance';
  shadows: ColorBalanceTriplet;
  midtones: ColorBalanceTriplet;
  highlights: ColorBalanceTriplet;
  preserveLuminosity: boolean;
}
export interface ChannelMixerAdjustment extends AdjustmentBase {
  kind: 'channelMixer';
  outputChannel: 'red' | 'green' | 'blue';
  redPercent: number;
  greenPercent: number;
  bluePercent: number;
  constant: number;
  monochrome: boolean;
}
export interface PhotoFilterAdjustment extends AdjustmentBase {
  kind: 'photoFilter';
  color: Color;
  density: number;
  preserveLuminosity: boolean;
}
export interface HalftoneAdjustment extends AdjustmentBase {
  kind: 'halftone';
  pattern: 'dot' | 'line' | 'cross' | 'circle';
  frequency: number;
  angle: number;
  dotShape: 'round' | 'elliptical' | 'square' | 'diamond' | 'line';
  channel: 'k' | 'c' | 'm' | 'y' | 'cmyk';
  method: 'am' | 'fm';
  threshold?: number;
  intensity?: number;
  softness?: number;
  /** Per-channel screen angle overrides (degrees). */
  channelAngles?: { c?: number; m?: number; y?: number; k?: number };
  /** Sub-pixel registration offset per channel. */
  registrationOffset?: {
    c?: [number, number];
    m?: [number, number];
    y?: [number, number];
    k?: [number, number];
  };
  /** Total area coverage limit (0-1). Default 1 (400%). */
  tacLimit?: number;
  /** Black generation method. Default 'none'. */
  blackGeneration?: 'none' | 'gcr' | 'ucr';
  /** GCR strength 0-1. Default 0.5. */
  gcrStrength?: number;
  /** Preview channel for CMYK mode. Default 'composite'. */
  previewChannel?: 'composite' | 'c' | 'm' | 'y' | 'k';
  /** Dot gain compensation 0-1. Default 0. */
  dotGain?: number;
}

export interface GradientMapStop {
  position: number;
  color: Color;
  /** Per-stop opacity (0-1, default 1). */
  opacity?: number;
  /** Midpoint position (0-1, default 0.5) between this stop and the next. */
  midpoint?: number;
}

/** Opacity ramp stop (independent of color stops). */
export interface GradientMapOpacityStop {
  position: number;
  /** Midpoint position (0-1, default 0.5). */
  midpoint?: number;
  /** Normalized opacity 0-1. */
  opacity: number;
}

/** Luminance/tonal source for the gradient-map ramp input. */
export type GradientMapLuminanceMode =
  | 'relative-luminance'
  | 'perceptual-lightness'
  | 'average-rgb'
  | 'max-channel'
  | 'alpha'
  | 'red'
  | 'green'
  | 'blue'
  | 'compatibility';

/**
 * Structural snapshot of a gradient preset embedded on the adjustment so the
 * document stays portable when the global preset is renamed or deleted.
 * Uses `Color` tuples (engine-side mirror of the scene `GradientPreset`).
 */
export interface EmbeddedGradientColorStop {
  position: number;
  midpoint?: number;
  color: Color;
}

export interface EmbeddedGradientOpacityStop {
  position: number;
  midpoint?: number;
  opacity: number;
}

export interface EmbeddedGradientPreset {
  id: string;
  name: string;
  kind?: 'solid' | 'noise' | 'unsupported';
  colorStops: EmbeddedGradientColorStop[];
  opacityStops: EmbeddedGradientOpacityStop[];
  smoothness?: number;
  interpolation?: import('@varve/shared').GradientInterpolationSpace;
  source?: { origin: string; fileName?: string; originalName?: string };
  compatibility?: {
    status: 'ok' | 'approximated' | 'unsupported';
    message?: string;
    warnings?: string[];
  };
}

export interface GradientMapAdjustment extends AdjustmentBase {
  kind: 'gradientMap';
  stops: GradientMapStop[];
  dither: boolean;
  preserveLuminosity: boolean;
  /** Bayer matrix size: 4 or 8. 8×8 gives 64 dither levels, 4×4 gives 16. Default 8. */
  ditherSize?: 4 | 8;
  /** Mapping mode: 'luminance' (default) maps luma through one gradient;
   *  'channel' maps R, G, B independently through channelStops. */
  mode?: 'luminance' | 'channel';
  /** Per-channel gradient stops for channel-aware mode. */
  channelStops?: {
    r?: GradientMapStop[];
    g?: GradientMapStop[];
    b?: GradientMapStop[];
  };
  /** Independent opacity ramp (defaults to full opacity). */
  opacityStops?: GradientMapOpacityStop[];
  /** Reverse the ramp (shadows sample the last stop). Default false. */
  reverse?: boolean;
  /** Mix with the source: 0 = unchanged, 1 = fully mapped. Default 1. */
  intensity?: number;
  /** Tonal source. Default 'relative-luminance'. */
  luminanceMode?: GradientMapLuminanceMode;
  /** Keep source alpha untouched. Default true. */
  preserveSourceAlpha?: boolean;
  /** Interpolation space for stop blending. Legacy default: 'srgb'. */
  interpolation?: import('@varve/shared').GradientInterpolationSpace;
  /** LUT resolution. Default 256. */
  lutSize?: number;
  /** Reference to a global preset (for diagnostics). Rendering uses
   *  `embeddedGradient`/`stops`, so a missing global preset never breaks it. */
  presetId?: string;
  /** Embedded fallback gradient for portability. */
  embeddedGradient?: EmbeddedGradientPreset;
}

export interface TritoneAdjustment extends AdjustmentBase {
  kind: 'tritone';
  shadowColor: Color;
  midtoneColor: Color;
  highlightColor: Color;
  shadowPoint: number;
  highlightPoint: number;
  intensity: number;
  preserveLuminosity: boolean;
  /** Interpolation shape: 'smoothstep' (default) for natural transitions,
   *  'linear' for sharp photographic splits. */
  interpolation?: 'smoothstep' | 'linear';
}

export interface ColorHalftoneAdjustment extends AdjustmentBase {
  kind: 'colorHalftone';
  screenSize: number;
  angle: number;
  dotShape: 'round' | 'square' | 'diamond' | 'line';
  mode: 'cmyk' | 'rgb' | 'mono';
  intensity: number;
  inkColor?: Color;
}

export interface DuotoneAdjustment extends AdjustmentBase {
  kind: 'duotone';
  shadowColor: Color;
  highlightColor: Color;
  shadowPoint: number;
  highlightPoint: number;
  intensity: number;
  preserveLuminosity: boolean;
  interpolation?: 'smoothstep' | 'linear';
}

export interface BlackAndWhiteAdjustment extends AdjustmentBase {
  kind: 'blackAndWhite';
  reds: number;
  yellows: number;
  greens: number;
  cyans: number;
  blues: number;
  magentas: number;
  brightness: number;
  tintColor?: Color;
  preserveLuminosity: boolean;
}

export interface PosterizeAdjustment extends AdjustmentBase {
  kind: 'posterize';
  levels: number;
}

export interface ThresholdAdjustment extends AdjustmentBase {
  kind: 'threshold';
  level: number;
}

export interface LutAdjustment extends AdjustmentBase {
  kind: 'lut';
  /** Serialized LUT transform (embedded in document) */
  lutJson: string;
  /** Original filename for display */
  originalFilename?: string;
  /** Assumed input colour space */
  inputSpace: LutInputSpace;
  /** Interpolation method */
  interpolation: LutInterpolation;
  /** Mix amount (0..1) */
  intensity: number;
  /** Whether to linearize sRGB before applying */
  linearize: boolean;
}

export type Adjustment =
  | BrightnessAdjustment
  | ContrastAdjustment
  | ExposureAdjustment
  | SaturationAdjustment
  | HueRotateAdjustment
  | SepiaAdjustment
  | GrayscaleAdjustment
  | InvertAdjustment
  | HalftoneAdjustment
  | OpacityAdjustment
  | BlurAdjustment
  | SharpenAdjustment
  | TemperatureAdjustment
  | TintAdjustment
  | VibranceAdjustment
  | LevelsAdjustment
  | CurvesAdjustment
  | SelectiveColorAdjustment
  | ColorBalanceAdjustment
  | ChannelMixerAdjustment
  | PhotoFilterAdjustment
  | GradientMapAdjustment
  | TritoneAdjustment
  | ColorHalftoneAdjustment
  | DuotoneAdjustment
  | BlackAndWhiteAdjustment
  | PosterizeAdjustment
  | ThresholdAdjustment
  | LutAdjustment;

export function adjustmentToFilter(adjustment: Adjustment): FilterIR {
  const base = { opacity: adjustment.opacity, blendMode: adjustment.blendMode };
  switch (adjustment.kind) {
    case 'brightness':
      return { kind: 'brightness', value: adjustment.value, ...base };
    case 'contrast':
      return { kind: 'contrast', value: adjustment.value, ...base };
    case 'exposure':
      return {
        kind: 'exposure',
        value: adjustment.value,
        offset: adjustment.offset,
        gammaCorrection: adjustment.gammaCorrection,
        ...base,
      };
    case 'saturation':
      return { kind: 'saturation', value: adjustment.value, ...base };
    case 'hueRotate':
      return { kind: 'hueRotate', value: adjustment.value, ...base };
    case 'sepia':
      return { kind: 'sepia', value: adjustment.value, ...base };
    case 'grayscale':
      return { kind: 'grayscale', value: adjustment.value, ...base };
    case 'invert':
      return { kind: 'invert', value: adjustment.value, ...base };
    case 'opacity':
      return { kind: 'opacity', value: adjustment.value, ...base };
    case 'blur':
      return { kind: 'blur', radius: adjustment.radius, ...base };
    case 'sharpen':
      return {
        kind: 'sharpen',
        amount: adjustment.amount,
        radius: adjustment.radius,
        threshold: adjustment.threshold,
        ...base,
      };
    case 'temperature':
      return { kind: 'temperature', value: adjustment.value, ...base };
    case 'tint':
      return { kind: 'tint', value: adjustment.value, ...base };
    case 'vibrance':
      return { kind: 'vibrance', value: adjustment.value, ...base };
    case 'levels':
      return {
        kind: 'levels',
        inputShadows: adjustment.inputShadows,
        inputMidtones: adjustment.inputMidtones,
        inputHighlights: adjustment.inputHighlights,
        outputShadows: adjustment.outputShadows,
        outputHighlights: adjustment.outputHighlights,
        channel: adjustment.channel,
        ...base,
      };
    case 'curves':
      return { kind: 'curves', channel: adjustment.channel, points: adjustment.points, ...base };
    case 'selectiveColor':
      return {
        kind: 'selectiveColor',
        colorRange: adjustment.colorRange,
        cyan: adjustment.cyan,
        magenta: adjustment.magenta,
        yellow: adjustment.yellow,
        black: adjustment.black,
        relative: adjustment.relative,
        ...base,
      };
    case 'colorBalance':
      return {
        kind: 'colorBalance',
        shadows: adjustment.shadows,
        midtones: adjustment.midtones,
        highlights: adjustment.highlights,
        preserveLuminosity: adjustment.preserveLuminosity,
        ...base,
      };
    case 'channelMixer':
      return {
        kind: 'channelMixer',
        outputChannel: adjustment.outputChannel,
        redPercent: adjustment.redPercent,
        greenPercent: adjustment.greenPercent,
        bluePercent: adjustment.bluePercent,
        constant: adjustment.constant,
        monochrome: adjustment.monochrome,
        ...base,
      };
    case 'photoFilter':
      return {
        kind: 'photoFilter',
        color: adjustment.color,
        density: adjustment.density,
        preserveLuminosity: adjustment.preserveLuminosity,
        ...base,
      };
    case 'halftone':
      return {
        kind: 'halftone',
        pattern: adjustment.pattern,
        frequency: adjustment.frequency,
        angle: adjustment.angle,
        dotShape: adjustment.dotShape,
        channel: adjustment.channel,
        method: adjustment.method,
        threshold: adjustment.threshold,
        intensity: adjustment.intensity,
        softness: adjustment.softness,
        channelAngles: adjustment.channelAngles,
        registrationOffset: adjustment.registrationOffset,
        tacLimit: adjustment.tacLimit,
        blackGeneration: adjustment.blackGeneration,
        gcrStrength: adjustment.gcrStrength,
        previewChannel: adjustment.previewChannel,
        dotGain: adjustment.dotGain,
        ...base,
      };
    case 'gradientMap':
      return {
        kind: 'gradientMap',
        stops: adjustment.stops.map((s) => ({
          position: s.position,
          color: s.color as readonly [number, number, number, number],
          opacity: s.opacity,
          midpoint: s.midpoint,
        })),
        dither: adjustment.dither,
        preserveLuminosity: adjustment.preserveLuminosity,
        ditherSize: adjustment.ditherSize,
        mode: adjustment.mode,
        channelStops: adjustment.channelStops
          ? {
              r: adjustment.channelStops.r?.map((s) => ({
                position: s.position,
                color: s.color as readonly [number, number, number, number],
                opacity: s.opacity,
                midpoint: s.midpoint,
              })),
              g: adjustment.channelStops.g?.map((s) => ({
                position: s.position,
                color: s.color as readonly [number, number, number, number],
                opacity: s.opacity,
                midpoint: s.midpoint,
              })),
              b: adjustment.channelStops.b?.map((s) => ({
                position: s.position,
                color: s.color as readonly [number, number, number, number],
                opacity: s.opacity,
                midpoint: s.midpoint,
              })),
            }
          : undefined,
        ...(adjustment.opacityStops !== undefined ? { opacityStops: adjustment.opacityStops } : {}),
        ...(adjustment.reverse !== undefined ? { reverse: adjustment.reverse } : {}),
        ...(adjustment.intensity !== undefined ? { intensity: adjustment.intensity } : {}),
        ...(adjustment.luminanceMode !== undefined
          ? { luminanceMode: adjustment.luminanceMode }
          : {}),
        ...(adjustment.preserveSourceAlpha !== undefined
          ? { preserveSourceAlpha: adjustment.preserveSourceAlpha }
          : {}),
        ...(adjustment.interpolation !== undefined
          ? { interpolation: adjustment.interpolation }
          : {}),
        ...(adjustment.lutSize !== undefined ? { lutSize: adjustment.lutSize } : {}),
        ...base,
      };
    case 'tritone':
      return {
        kind: 'tritone',
        shadowColor: adjustment.shadowColor as readonly [number, number, number, number],
        midtoneColor: adjustment.midtoneColor as readonly [number, number, number, number],
        highlightColor: adjustment.highlightColor as readonly [number, number, number, number],
        shadowPoint: adjustment.shadowPoint,
        highlightPoint: adjustment.highlightPoint,
        intensity: adjustment.intensity,
        preserveLuminosity: adjustment.preserveLuminosity,
        interpolation: adjustment.interpolation,
        ...base,
      };
    case 'duotone':
      return {
        kind: 'duotone',
        shadowColor: adjustment.shadowColor as readonly [number, number, number, number],
        highlightColor: adjustment.highlightColor as readonly [number, number, number, number],
        shadowPoint: adjustment.shadowPoint,
        highlightPoint: adjustment.highlightPoint,
        intensity: adjustment.intensity,
        preserveLuminosity: adjustment.preserveLuminosity,
        interpolation: adjustment.interpolation,
        ...base,
      };
    case 'blackAndWhite':
      return {
        kind: 'blackAndWhite',
        reds: adjustment.reds,
        yellows: adjustment.yellows,
        greens: adjustment.greens,
        cyans: adjustment.cyans,
        blues: adjustment.blues,
        magentas: adjustment.magentas,
        brightness: adjustment.brightness,
        tintColor: adjustment.tintColor as readonly [number, number, number, number] | undefined,
        preserveLuminosity: adjustment.preserveLuminosity,
        ...base,
      };
    case 'posterize':
      return { kind: 'posterize', levels: adjustment.levels, ...base };
    case 'threshold':
      return { kind: 'threshold', level: adjustment.level, ...base };
    case 'colorHalftone':
      return {
        kind: 'colorHalftone',
        screenSize: adjustment.screenSize,
        angle: adjustment.angle,
        dotShape: adjustment.dotShape,
        mode: adjustment.mode,
        intensity: adjustment.intensity,
        inkColor: adjustment.inkColor as readonly [number, number, number, number] | undefined,
        ...base,
      };
    case 'lut':
      return {
        kind: 'lut',
        lutJson: adjustment.lutJson,
        originalFilename: adjustment.originalFilename,
        inputSpace: adjustment.inputSpace,
        interpolation: adjustment.interpolation,
        intensity: adjustment.intensity,
        linearize: adjustment.linearize,
        ...base,
      };
    default:
      return { kind: 'opacity', value: 100, opacity: 1, blendMode: 'normal' };
  }
}

export function adjustmentsToFilters(adjustments: Adjustment[]): FilterIR[] {
  return adjustments.filter((a) => a.visible && a.opacity > 0).map(adjustmentToFilter);
}

/** Convert a single filter IR to a CSS filter string (Canvas2D fallback). */
export function filterToCss(filter: FilterIR): string | null {
  switch (filter.kind) {
    case 'brightness':
      return `brightness(${100 + filter.value}%)`;
    case 'contrast':
      return `contrast(${100 + filter.value}%)`;
    case 'saturation':
      return `saturate(${100 + filter.value}%)`;
    case 'hueRotate':
      return `hue-rotate(${filter.value}deg)`;
    case 'sepia':
      return `sepia(${filter.value}%)`;
    case 'grayscale':
      return `grayscale(${filter.value}%)`;
    case 'invert':
      return `invert(${filter.value}%)`;
    case 'opacity':
      return `opacity(${filter.value}%)`;
    case 'blur':
      return `blur(${filter.radius}px)`;
    case 'vibrance':
      // CSS has no vibrance; approximate with saturate
      return `saturate(${100 + filter.value * 0.7}%)`;
    case 'exposure':
    case 'sharpen':
    case 'temperature':
    case 'tint':
    case 'levels':
    case 'curves':
    case 'selectiveColor':
    case 'colorBalance':
    case 'channelMixer':
    case 'photoFilter':
    case 'halftone':
    case 'gradientMap':
    case 'tritone':
    case 'colorHalftone':
    case 'duotone':
    case 'blackAndWhite':
    case 'posterize':
    case 'threshold':
      // No direct CSS equivalent; use identity or a placeholder.
      return null;
    case 'lut':
      return null; // LUT has no CSS equivalent; software-only
    case 'chain':
      return filterChainToCss(filter.filters);
    default:
      return null;
  }
}

/** Compose a filter chain into one CSS filter string. */
export function filterChainToCss(filters: FilterIR[]): string | null {
  const parts = filters.map(filterToCss).filter((p): p is string => p !== null && p.length > 0);
  return parts.length > 0 ? parts.join(' ') : null;
}

/** True only when the runtime implements CanvasRenderingContext2D.filter. */
export function supportsCanvasFilter(target: object): target is { filter: string } {
  return 'filter' in target && typeof (target as { filter?: unknown }).filter === 'string';
}

/** Apply a filter chain to a Canvas2D context by setting ctx.filter. */
export function applyFilterChain(target: { filter: string }, filters: FilterIR[]): void {
  const css = filterChainToCss(filters);
  if (css) {
    target.filter = css;
  }
}

export function filterKindDisplayName(kind: AdjustmentKind): string {
  switch (kind) {
    case 'hueRotate':
      return 'Hue Rotate';
    case 'colorBalance':
      return 'Color Balance';
    case 'channelMixer':
      return 'Channel Mixer';
    case 'photoFilter':
      return 'Photo Filter';
    case 'selectiveColor':
      return 'Selective Color';
    case 'gradientMap':
      return 'Gradient Map';
    case 'lut':
      return 'LUT';
    case 'tritone':
      return 'Tritone';
    case 'colorHalftone':
      return 'Color Halftone';
    case 'duotone':
      return 'Duotone';
    case 'blackAndWhite':
      return 'Black & White';
    case 'posterize':
      return 'Posterize';
    case 'threshold':
      return 'Threshold';
    default:
      return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}

export function adjustmentDefaults(kind: AdjustmentKind): Omit<Adjustment, 'id' | 'kind'> {
  const base = { visible: true, opacity: 1, blendMode: 'normal' as AdjustmentBlendMode };
  switch (kind) {
    case 'brightness':
    case 'contrast':
    case 'saturation':
    case 'vibrance':
      return { ...base, value: 0 } as Omit<Adjustment, 'id' | 'kind'>;
    case 'exposure':
      return { ...base, value: 0, offset: 0, gammaCorrection: 1 } as Omit<
        Adjustment,
        'id' | 'kind'
      >;
    case 'hueRotate':
      return { ...base, value: 0 } as Omit<Adjustment, 'id' | 'kind'>;
    case 'sepia':
    case 'grayscale':
    case 'invert':
      return { ...base, value: 0 } as Omit<Adjustment, 'id' | 'kind'>;
    case 'opacity':
      return { ...base, value: 100 } as Omit<Adjustment, 'id' | 'kind'>;
    case 'blur':
      return { ...base, radius: 0 } as Omit<Adjustment, 'id' | 'kind'>;
    case 'sharpen':
      return { ...base, amount: 0, radius: 1, threshold: 0 } as Omit<Adjustment, 'id' | 'kind'>;
    case 'temperature':
    case 'tint':
      return { ...base, value: 0 } as Omit<Adjustment, 'id' | 'kind'>;
    case 'levels':
      return {
        ...base,
        inputShadows: 0,
        inputMidtones: 1,
        inputHighlights: 255,
        outputShadows: 0,
        outputHighlights: 255,
        channel: 'rgb',
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'curves':
      return { ...base, channel: 'rgb', points: [] } as Omit<Adjustment, 'id' | 'kind'>;
    case 'selectiveColor':
      return {
        ...base,
        colorRange: 'reds',
        cyan: 0,
        magenta: 0,
        yellow: 0,
        black: 0,
        relative: true,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'colorBalance':
      return {
        ...base,
        shadows: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
        midtones: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
        highlights: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
        preserveLuminosity: true,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'channelMixer':
      return {
        ...base,
        outputChannel: 'red',
        redPercent: 100,
        greenPercent: 0,
        bluePercent: 0,
        constant: 0,
        monochrome: false,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'photoFilter':
      return {
        ...base,
        color: [255, 255, 0, 255] as Color,
        density: 25,
        preserveLuminosity: true,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'halftone':
      return {
        ...base,
        pattern: 'dot',
        frequency: 45,
        angle: 45,
        dotShape: 'round',
        channel: 'k',
        method: 'am',
        threshold: 128,
        intensity: 1,
        softness: 0,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'gradientMap':
      return {
        ...base,
        stops: [
          { position: 0, color: [0, 0, 0, 255] as Color },
          { position: 1, color: [255, 255, 255, 255] as Color },
        ],
        dither: true,
        preserveLuminosity: false,
        ditherSize: 8,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'tritone':
      return {
        ...base,
        shadowColor: [20, 30, 80, 255] as Color,
        midtoneColor: [180, 160, 140, 255] as Color,
        highlightColor: [255, 245, 220, 255] as Color,
        shadowPoint: 0.35,
        highlightPoint: 0.65,
        intensity: 1,
        preserveLuminosity: false,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'colorHalftone':
      return {
        ...base,
        screenSize: 12,
        angle: 0,
        dotShape: 'round',
        mode: 'cmyk',
        intensity: 1,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'duotone':
      return {
        ...base,
        shadowColor: [30, 40, 100, 255] as Color,
        highlightColor: [255, 220, 180, 255] as Color,
        shadowPoint: 0.25,
        highlightPoint: 0.75,
        intensity: 1,
        preserveLuminosity: false,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'blackAndWhite':
      return {
        ...base,
        reds: 40,
        yellows: 60,
        greens: 40,
        cyans: 60,
        blues: 20,
        magentas: 80,
        brightness: 0,
        preserveLuminosity: true,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'posterize':
      return {
        ...base,
        levels: 4,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'threshold':
      return {
        ...base,
        level: 128,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'lut':
      return {
        ...base,
        lutJson: '{}',
        inputSpace: 'sRGB' as LutInputSpace,
        interpolation: 'tetrahedral' as LutInterpolation,
        intensity: 1,
        linearize: false,
      } as Omit<Adjustment, 'id' | 'kind'>;
    default:
      return { ...base } as Omit<Adjustment, 'id' | 'kind'>;
  }
}

export function makeAdjustment(
  id: string,
  kind: AdjustmentKind,
  overrides: Partial<Adjustment> = {},
): Adjustment {
  const defaults = adjustmentDefaults(kind);
  return { id, kind, ...defaults, ...overrides } as Adjustment;
}
