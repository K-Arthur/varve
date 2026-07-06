/**
 * Filter IR and Canvas2D/CSS fallback for nondestructive image adjustments.
 *
 * This module defines both the user-facing adjustment types and the portable
 * filter IR. It lives in @strata/engine so the IR contract and the Canvas2D
 * fallback stay together; @strata/scene re-exports/adapts these as needed.
 *
 * Research basis: CSS filter functions, SVG filters, Photoshop adjustment layers.
 */

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
  | 'halftone';

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
  | PhotoFilterAdjustment;

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
      // No direct CSS equivalent; use identity or a placeholder.
      return null;
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
