/**
 * Filter IR and Canvas2D/CSS fallback for nondestructive image adjustments.
 *
 * This module defines both the user-facing adjustment types and the portable
 * filter IR. It lives in @varve/engine so the IR contract and the Canvas2D
 * fallback stay together; @varve/scene re-exports/adapts these as needed.
 *
 * Research basis: CSS filter functions, SVG filters, Photoshop adjustment layers.
 */

import type { BloomComposite } from './liveEffects/bloom';
import type { CausticsOutput } from './liveEffects/caustics';
import type { PhosphorMask } from './liveEffects/crt';
import type { DitherAlgorithm, DitherPaletteMode } from './liveEffects/dither';
import type { LightShaftOcclusion } from './liveEffects/lightShafts';
import type { ColorMetric } from './liveEffects/paletteCore';
import type { EffectQualityParam } from './liveEffects/quality';
import type { BorderMode, RgbSplitMode } from './liveEffects/rgbSplit';
import type { LutInputSpace, LutInterpolation } from './lut/types';
import type { Color, FilterIR } from './types';

export type AdjustmentKind =
  | 'brightness'
  | 'contrast'
  | 'exposure'
  | 'saturation'
  | 'hueSaturation'
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
  | 'shadowHighlight'
  | 'halftone'
  | 'gradientMap'
  | 'tritone'
  | 'colorHalftone'
  | 'duotone'
  | 'blackAndWhite'
  | 'posterize'
  | 'threshold'
  | 'lut'
  | 'dither'
  | 'paletteSnap'
  | 'bloom'
  | 'rgbSplit'
  | 'crt'
  | 'vhs'
  | 'lightShafts'
  | 'lensFlare'
  | 'lightLeak'
  | 'caustics';

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
export interface HueSaturationAdjustment extends AdjustmentBase {
  kind: 'hueSaturation';
  ranges: import('./adjustment/hueSaturation').HueSaturationParams;
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
  /** Invert the halftone output (swap ink and paper). Default false. */
  invert?: boolean;
  /** Foreground (ink) color as [r, g, b] (default [0, 0, 0] = black). */
  foregroundColor?: [number, number, number];
  /** Background (paper) color as [r, g, b] (default [255, 255, 255] = white). */
  backgroundColor?: [number, number, number];
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

// ── Live effects (non-destructive procedural) ──────────────────────────────
// These kinds render through the same Adjustment → FilterIR → CPU-kernel
// pipeline as every other adjustment. Parameters are plain JSON; seeds are
// explicit integers so output is deterministic per (params, time, surface).

export interface DitherAdjustment extends AdjustmentBase {
  kind: 'dither';
  algorithm: DitherAlgorithm;
  paletteMode: DitherPaletteMode;
  /** Bits per channel when paletteMode === 'levels' (1..8). */
  levels: number;
  /** Explicit palette when paletteMode === 'custom'. */
  colors: readonly (readonly number[])[];
  metric: ColorMetric;
  serpentine: boolean;
  /** 0..1 error/pattern strength. */
  strength: number;
  /** Bayer matrix size (2 | 4 | 8). */
  bayerSize: number;
  /** Pattern cell size in document pixels. */
  cellSize: number;
  /** Pixels below this alpha are forced fully transparent (0..1). */
  alphaCutoff: number;
  seed: number;
}

export interface PaletteSnapAdjustment extends AdjustmentBase {
  kind: 'paletteSnap';
  colors: readonly (readonly number[])[];
  metric: ColorMetric;
  /** 0..1 snap mix. */
  amount: number;
  dither: boolean;
  ditherAlgorithm: DitherAlgorithm;
  ditherStrength: number;
  alphaCutoff: number;
  seed: number;
}

export interface BloomAdjustment extends AdjustmentBase {
  kind: 'bloom';
  /** 0..1 luminance threshold. */
  threshold: number;
  /** 0..1 soft-knee width. */
  softKnee: number;
  /** 0..4 intensity. */
  intensity: number;
  /** Glow radius in document pixels. */
  radius: number;
  /** 0..1 weight toward wide pyramid levels. */
  diffusion: number;
  tint: readonly [number, number, number] | null;
  tintAmount: number;
  composite: BloomComposite;
  streakEnabled: boolean;
  /** Streak angle in degrees. */
  streakAngle: number;
  /** Streak length in document pixels. */
  streakLength: number;
  streakIntensity: number;
  /** 1..8 streak anisotropy. */
  streakAspect: number;
  quality: EffectQualityParam;
}

export interface RgbSplitAdjustment extends AdjustmentBase {
  kind: 'rgbSplit';
  mode: RgbSplitMode;
  /** Offset mode channel displacement in document pixels. */
  redX: number;
  redY: number;
  greenX: number;
  greenY: number;
  blueX: number;
  blueY: number;
  /** Radial separation at max radius (document px). */
  amount: number;
  /** Radial optical centre (normalized 0..1). */
  centerX: number;
  centerY: number;
  /** 0..1+ falloff exponent. */
  falloff: number;
  /** Fringe axis rotation in degrees. */
  fringeAngle: number;
  borderMode: BorderMode;
  /** 0..1 global intensity. */
  intensity: number;
}

export interface CrtAdjustment extends AdjustmentBase {
  kind: 'crt';
  curvature: number;
  cornerRadius: number;
  scanlinePeriod: number;
  scanlineStrength: number;
  scanlineSoftness: number;
  phosphorMask: PhosphorMask;
  phosphorPitch: number;
  phosphorIntensity: number;
  glow: number;
  vignette: number;
  vignetteRadius: number;
  convergenceX: number;
  convergenceY: number;
  brightness: number;
  contrast: number;
}

export interface VhsAdjustment extends AdjustmentBase {
  kind: 'vhs';
  lumaNoise: number;
  chromaNoise: number;
  chromaBleed: number;
  jitter: number;
  tracking: number;
  dropouts: number;
  headSwitching: number;
  tearing: number;
  signalBlur: number;
  timeInstability: number;
  seed: number;
  /** Time in seconds (animatable). */
  time: number;
  frameRate: number;
  quality: EffectQualityParam;
}

export interface LightShaftsAdjustment extends AdjustmentBase {
  kind: 'lightShafts';
  /** Light position normalized 0..1. */
  lightX: number;
  lightY: number;
  lightType: 'point' | 'directional';
  /** Directional angle in degrees. */
  direction: number;
  intensity: number;
  exposure: number;
  decay: number;
  density: number;
  weight: number;
  /** 8..96 ray-march steps. */
  sampleCount: number;
  /** 0..1 scattering spread. */
  scattering: number;
  tint: readonly [number, number, number] | null;
  occlusionSource: LightShaftOcclusion;
  quality: EffectQualityParam;
}

export interface LensFlareAdjustment extends AdjustmentBase {
  kind: 'lensFlare';
  /** Normalized 0..1; negative = auto (brightest pixel). */
  sourceX: number;
  sourceY: number;
  brightness: number;
  scale: number;
  ghostCount: number;
  ghostSpacing: number;
  halo: number;
  /** 0 = none, 3..12 aperture blades. */
  apertureBlades: number;
  apertureRotation: number;
  streakIntensity: number;
  anamorphicRatio: number;
  chromaticDispersion: number;
  seed: number;
  quality: EffectQualityParam;
}

export interface LightLeakAdjustment extends AdjustmentBase {
  kind: 'lightLeak';
  seed: number;
  /** Position normalized 0..1. */
  x: number;
  y: number;
  /** Orientation in degrees. */
  angle: number;
  /** 0..2 size. */
  size: number;
  softness: number;
  hue: number;
  saturation: number;
  lightness: number;
  intensity: number;
  noiseScale: number;
}

export interface CausticsAdjustment extends AdjustmentBase {
  kind: 'caustics';
  /** Wave scale in document pixels. */
  scale: number;
  depth: number;
  waveCount: number;
  complexity: number;
  refractionAmount: number;
  sharpness: number;
  /** Light angle in degrees. */
  lightAngle: number;
  brightness: number;
  contrast: number;
  dispersion: number;
  distortionAmount: number;
  output: CausticsOutput;
  waterTint: readonly [number, number, number] | null;
  surfaceTint: readonly [number, number, number] | null;
  seed: number;
  /** Time in seconds (animatable). */
  time: number;
  animationSpeed: number;
  tileable: boolean;
  quality: EffectQualityParam;
}

export interface ShadowHighlightAdjustment extends AdjustmentBase {
  kind: 'shadowHighlight';
  /** Shadow brightening amount (0-100, default 0). */
  shadows: number;
  /** Highlight darkening amount (0-100, default 0). */
  highlights: number;
  /** Tonal width: how broad the shadow/highlight zones are (0-100, default 50). */
  tonalWidth: number;
  /** Midpoint: balance between shadow and highlight bias (0-100, default 50). */
  midpoint: number;
}

export type Adjustment =
  | BrightnessAdjustment
  | ContrastAdjustment
  | ExposureAdjustment
  | SaturationAdjustment
  | HueSaturationAdjustment
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
  | LutAdjustment
  | DitherAdjustment
  | PaletteSnapAdjustment
  | BloomAdjustment
  | RgbSplitAdjustment
  | CrtAdjustment
  | VhsAdjustment
  | LightShaftsAdjustment
  | LensFlareAdjustment
  | LightLeakAdjustment
  | CausticsAdjustment
  | ShadowHighlightAdjustment;

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
    case 'hueSaturation':
      return { kind: 'hueSaturation', ranges: adjustment.ranges, ...base };
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
        invert: adjustment.invert,
        foregroundColor: adjustment.foregroundColor,
        backgroundColor: adjustment.backgroundColor,
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
    case 'dither':
      return {
        kind: 'dither',
        algorithm: adjustment.algorithm,
        paletteMode: adjustment.paletteMode,
        levels: adjustment.levels,
        colors: adjustment.colors,
        metric: adjustment.metric,
        serpentine: adjustment.serpentine,
        strength: adjustment.strength,
        bayerSize: adjustment.bayerSize,
        cellSize: adjustment.cellSize,
        alphaCutoff: adjustment.alphaCutoff,
        seed: adjustment.seed,
        ...base,
      };
    case 'paletteSnap':
      return {
        kind: 'paletteSnap',
        colors: adjustment.colors,
        metric: adjustment.metric,
        amount: adjustment.amount,
        dither: adjustment.dither,
        ditherAlgorithm: adjustment.ditherAlgorithm,
        ditherStrength: adjustment.ditherStrength,
        alphaCutoff: adjustment.alphaCutoff,
        seed: adjustment.seed,
        ...base,
      };
    case 'bloom':
      return {
        kind: 'bloom',
        threshold: adjustment.threshold,
        softKnee: adjustment.softKnee,
        intensity: adjustment.intensity,
        radius: adjustment.radius,
        diffusion: adjustment.diffusion,
        tint: adjustment.tint,
        tintAmount: adjustment.tintAmount,
        composite: adjustment.composite,
        streakEnabled: adjustment.streakEnabled,
        streakAngle: adjustment.streakAngle,
        streakLength: adjustment.streakLength,
        streakIntensity: adjustment.streakIntensity,
        streakAspect: adjustment.streakAspect,
        quality: adjustment.quality,
        ...base,
      };
    case 'rgbSplit':
      return {
        kind: 'rgbSplit',
        mode: adjustment.mode,
        redX: adjustment.redX,
        redY: adjustment.redY,
        greenX: adjustment.greenX,
        greenY: adjustment.greenY,
        blueX: adjustment.blueX,
        blueY: adjustment.blueY,
        amount: adjustment.amount,
        centerX: adjustment.centerX,
        centerY: adjustment.centerY,
        falloff: adjustment.falloff,
        fringeAngle: adjustment.fringeAngle,
        borderMode: adjustment.borderMode,
        intensity: adjustment.intensity,
        ...base,
      };
    case 'crt':
      return {
        kind: 'crt',
        curvature: adjustment.curvature,
        cornerRadius: adjustment.cornerRadius,
        scanlinePeriod: adjustment.scanlinePeriod,
        scanlineStrength: adjustment.scanlineStrength,
        scanlineSoftness: adjustment.scanlineSoftness,
        phosphorMask: adjustment.phosphorMask,
        phosphorPitch: adjustment.phosphorPitch,
        phosphorIntensity: adjustment.phosphorIntensity,
        glow: adjustment.glow,
        vignette: adjustment.vignette,
        vignetteRadius: adjustment.vignetteRadius,
        convergenceX: adjustment.convergenceX,
        convergenceY: adjustment.convergenceY,
        brightness: adjustment.brightness,
        contrast: adjustment.contrast,
        ...base,
      };
    case 'vhs':
      return {
        kind: 'vhs',
        lumaNoise: adjustment.lumaNoise,
        chromaNoise: adjustment.chromaNoise,
        chromaBleed: adjustment.chromaBleed,
        jitter: adjustment.jitter,
        tracking: adjustment.tracking,
        dropouts: adjustment.dropouts,
        headSwitching: adjustment.headSwitching,
        tearing: adjustment.tearing,
        signalBlur: adjustment.signalBlur,
        timeInstability: adjustment.timeInstability,
        seed: adjustment.seed,
        time: adjustment.time,
        frameRate: adjustment.frameRate,
        quality: adjustment.quality,
        ...base,
      };
    case 'lightShafts':
      return {
        kind: 'lightShafts',
        lightX: adjustment.lightX,
        lightY: adjustment.lightY,
        lightType: adjustment.lightType,
        direction: adjustment.direction,
        intensity: adjustment.intensity,
        exposure: adjustment.exposure,
        decay: adjustment.decay,
        density: adjustment.density,
        weight: adjustment.weight,
        sampleCount: adjustment.sampleCount,
        scattering: adjustment.scattering,
        tint: adjustment.tint,
        occlusionSource: adjustment.occlusionSource,
        quality: adjustment.quality,
        ...base,
      };
    case 'lensFlare':
      return {
        kind: 'lensFlare',
        sourceX: adjustment.sourceX,
        sourceY: adjustment.sourceY,
        brightness: adjustment.brightness,
        scale: adjustment.scale,
        ghostCount: adjustment.ghostCount,
        ghostSpacing: adjustment.ghostSpacing,
        halo: adjustment.halo,
        apertureBlades: adjustment.apertureBlades,
        apertureRotation: adjustment.apertureRotation,
        streakIntensity: adjustment.streakIntensity,
        anamorphicRatio: adjustment.anamorphicRatio,
        chromaticDispersion: adjustment.chromaticDispersion,
        seed: adjustment.seed,
        quality: adjustment.quality,
        ...base,
      };
    case 'lightLeak':
      return {
        kind: 'lightLeak',
        seed: adjustment.seed,
        x: adjustment.x,
        y: adjustment.y,
        angle: adjustment.angle,
        size: adjustment.size,
        softness: adjustment.softness,
        hue: adjustment.hue,
        saturation: adjustment.saturation,
        lightness: adjustment.lightness,
        intensity: adjustment.intensity,
        noiseScale: adjustment.noiseScale,
        ...base,
      };
    case 'caustics':
      return {
        kind: 'caustics',
        scale: adjustment.scale,
        depth: adjustment.depth,
        waveCount: adjustment.waveCount,
        complexity: adjustment.complexity,
        refractionAmount: adjustment.refractionAmount,
        sharpness: adjustment.sharpness,
        lightAngle: adjustment.lightAngle,
        brightness: adjustment.brightness,
        contrast: adjustment.contrast,
        dispersion: adjustment.dispersion,
        distortionAmount: adjustment.distortionAmount,
        output: adjustment.output,
        waterTint: adjustment.waterTint,
        surfaceTint: adjustment.surfaceTint,
        seed: adjustment.seed,
        time: adjustment.time,
        animationSpeed: adjustment.animationSpeed,
        tileable: adjustment.tileable,
        quality: adjustment.quality,
        ...base,
      };
    case 'shadowHighlight':
      return {
        kind: 'shadowHighlight',
        shadows: adjustment.shadows,
        highlights: adjustment.highlights,
        tonalWidth: adjustment.tonalWidth,
        midpoint: adjustment.midpoint,
        ...base,
      };
    default:
      return { kind: 'opacity', value: 100, opacity: 1, blendMode: 'normal' };
  }
}

export function adjustmentsToFilters(adjustments: readonly Adjustment[]): FilterIR[] {
  return adjustments
    .filter((a) => a.visible !== false && (a.opacity ?? 1) > 0 && isKnownAdjustmentKind(a.kind))
    .map(adjustmentToFilter);
}

/** Runtime guard for forward-compatible document payloads. */
export function isKnownAdjustmentKind(kind: unknown): kind is AdjustmentKind {
  return typeof kind === 'string' && ADJUSTMENT_KINDS.has(kind as AdjustmentKind);
}

const ADJUSTMENT_KINDS: ReadonlySet<AdjustmentKind> = new Set<AdjustmentKind>([
  'brightness',
  'contrast',
  'exposure',
  'saturation',
  'hueSaturation',
  'hueRotate',
  'sepia',
  'grayscale',
  'invert',
  'opacity',
  'blur',
  'sharpen',
  'temperature',
  'tint',
  'vibrance',
  'levels',
  'curves',
  'selectiveColor',
  'colorBalance',
  'channelMixer',
  'photoFilter',
  'shadowHighlight',
  'halftone',
  'gradientMap',
  'tritone',
  'colorHalftone',
  'duotone',
  'blackAndWhite',
  'posterize',
  'threshold',
  'lut',
  'dither',
  'paletteSnap',
  'bloom',
  'rgbSplit',
  'crt',
  'vhs',
  'lightShafts',
  'lensFlare',
  'lightLeak',
  'caustics',
]);

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
    case 'hueSaturation':
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
    case 'dither':
    case 'paletteSnap':
    case 'bloom':
    case 'rgbSplit':
    case 'crt':
    case 'vhs':
    case 'lightShafts':
    case 'lensFlare':
    case 'lightLeak':
    case 'caustics':
      return null; // Live effects are software kernels only; no CSS equivalent
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
    case 'hueSaturation':
      return 'Hue / Saturation';
    case 'colorBalance':
      return 'Color Balance';
    case 'channelMixer':
      return 'Channel Mixer';
    case 'photoFilter':
      return 'Photo Filter';
    case 'shadowHighlight':
      return 'Shadow / Highlight';
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
    case 'dither':
      return 'Dither';
    case 'paletteSnap':
      return 'Palette Snap';
    case 'bloom':
      return 'Bloom';
    case 'rgbSplit':
      return 'RGB Split';
    case 'crt':
      return 'CRT';
    case 'vhs':
      return 'VHS';
    case 'lightShafts':
      return 'Light Shafts';
    case 'lensFlare':
      return 'Lens Flare';
    case 'lightLeak':
      return 'Light Leak';
    case 'caustics':
      return 'Caustics';
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
    case 'hueSaturation':
      return {
        ...base,
        ranges: Object.fromEntries(
          ['master', 'reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'].map((range) => [
            range,
            { hue: 0, saturation: 0, lightness: 0 },
          ]),
        ),
      } as Omit<Adjustment, 'id' | 'kind'>;
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
    case 'shadowHighlight':
      return {
        ...base,
        shadows: 0,
        highlights: 0,
        tonalWidth: 50,
        midpoint: 50,
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
        invert: false,
        foregroundColor: [0, 0, 0] as [number, number, number],
        backgroundColor: [255, 255, 255] as [number, number, number],
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
    case 'dither':
      return {
        ...base,
        algorithm: 'floyd-steinberg',
        paletteMode: 'levels',
        levels: 4,
        colors: [],
        metric: 'rgb',
        serpentine: true,
        strength: 1,
        bayerSize: 8,
        cellSize: 1,
        alphaCutoff: 0,
        seed: 0,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'paletteSnap':
      return {
        ...base,
        colors: [
          [0, 0, 0],
          [255, 255, 255],
          [255, 0, 0],
          [0, 255, 0],
          [0, 0, 255],
          [255, 255, 0],
          [0, 255, 255],
          [255, 0, 255],
        ],
        metric: 'oklab',
        amount: 1,
        dither: false,
        ditherAlgorithm: 'floyd-steinberg',
        ditherStrength: 0.6,
        alphaCutoff: 0,
        seed: 0,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'bloom':
      return {
        ...base,
        threshold: 0.6,
        softKnee: 0.2,
        intensity: 1,
        radius: 24,
        diffusion: 0.5,
        tint: null,
        tintAmount: 0,
        composite: 'screen',
        streakEnabled: false,
        streakAngle: 0,
        streakLength: 64,
        streakIntensity: 0.5,
        streakAspect: 2,
        quality: 'auto',
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'rgbSplit':
      return {
        ...base,
        mode: 'offset',
        redX: 4,
        redY: 0,
        greenX: 0,
        greenY: 0,
        blueX: -4,
        blueY: 0,
        amount: 4,
        centerX: 0.5,
        centerY: 0.5,
        falloff: 1,
        fringeAngle: 0,
        borderMode: 'transparent',
        intensity: 1,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'crt':
      return {
        ...base,
        curvature: 0.1,
        cornerRadius: 0.3,
        scanlinePeriod: 3,
        scanlineStrength: 0.5,
        scanlineSoftness: 0.5,
        phosphorMask: 'rgb-stripe',
        phosphorPitch: 4,
        phosphorIntensity: 0.5,
        glow: 0.35,
        vignette: 0.35,
        vignetteRadius: 0.5,
        convergenceX: 0.5,
        convergenceY: 0,
        brightness: 0,
        contrast: 1.1,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'vhs':
      return {
        ...base,
        lumaNoise: 0.25,
        chromaNoise: 0.2,
        chromaBleed: 0.3,
        jitter: 0.25,
        tracking: 0.2,
        dropouts: 0.1,
        headSwitching: 0.3,
        tearing: 0.15,
        signalBlur: 0.15,
        timeInstability: 0.2,
        seed: 1,
        time: 0,
        frameRate: 24,
        quality: 'auto',
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'lightShafts':
      return {
        ...base,
        lightX: 0.5,
        lightY: 0.1,
        lightType: 'point',
        direction: 0,
        intensity: 1,
        exposure: 0,
        decay: 0.88,
        density: 0.15,
        weight: 0.85,
        sampleCount: 24,
        scattering: 0.3,
        tint: null,
        occlusionSource: 'luminance',
        quality: 'auto',
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'lensFlare':
      return {
        ...base,
        sourceX: 0.5,
        sourceY: 0.3,
        brightness: 1,
        scale: 1,
        ghostCount: 4,
        ghostSpacing: 0.8,
        halo: 0.5,
        apertureBlades: 0,
        apertureRotation: 0,
        streakIntensity: 0.5,
        anamorphicRatio: 0.2,
        chromaticDispersion: 0.4,
        seed: 0,
        quality: 'auto',
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'lightLeak':
      return {
        ...base,
        seed: 4,
        x: 0.15,
        y: 0.4,
        angle: 20,
        size: 1,
        softness: 0.65,
        hue: 25,
        saturation: 0.85,
        lightness: 0.6,
        intensity: 0.6,
        noiseScale: 0.5,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'caustics':
      return {
        ...base,
        scale: 28,
        depth: 0.5,
        waveCount: 4,
        complexity: 0.3,
        refractionAmount: 0.4,
        sharpness: 0.5,
        lightAngle: 60,
        brightness: 1,
        contrast: 1.1,
        dispersion: 0.1,
        distortionAmount: 0.8,
        output: 'combined',
        waterTint: null,
        surfaceTint: null,
        seed: 3,
        time: 0,
        animationSpeed: 0.5,
        tileable: false,
        quality: 'auto',
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
