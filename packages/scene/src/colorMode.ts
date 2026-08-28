/**
 * Document color-mode operations.
 *
 * The historical `switchColorMode` conflated two operations with different
 * semantics:
 *
 * 1. **Assignment** — changes the document's working mode/intent. Stored
 *    values keep their space and are reinterpreted under the new mode at
 *    read boundaries (rendering, export). Non-destructive to values; may
 *    change appearance. See `assignDocumentColorMode`.
 *
 * 2. **Conversion** — rewrites stored process colors through the source →
 *    destination space so appearance is preserved as closely as the chosen
 *    algorithm allows. Destructive to values; undoable. See
 *    `convertDocumentColors`.
 *
 * `switchColorMode` is retained only as a deprecated alias for the
 * conversion operation; new callers MUST pick the explicit operation.
 *
 * Conversion algorithms:
 * - `analytical` (default, browser-safe): formula-based RGB-to-CMYK-to-gray
 *   (0-255 scale). Honest but NOT an ICC conversion — UIs must label it
 *   "approximate" and never present it as profile-accurate.
 * - `icc`: profile-aware conversion via the native/WASM engine. The scene
 *   package cannot perform ICC conversion itself; callers must supply a
 *   converter function, otherwise an `'icc-unavailable'` warning is
 *   emitted and the conversion is skipped.
 */

import { denormalizeChannel, labToRgb, lchToRgb, normalizeChannel } from '@varve/shared';
import {
  type BitDepth,
  type BlendEvaluationSpace,
  type ColorConfig,
  type ColorMode,
  colorConfigWithDefaults,
  defaultColorConfig,
  type ManagedColor,
  type WorkingSpace,
} from './colorManagement';
import type { Document } from './document';
import type {
  Effect,
  Fill,
  GradientInterpolationSpace,
  GradientStop,
  SceneNode,
  Stroke,
} from './types';

export type ColorConversionAlgorithm = 'analytical' | 'icc';

/** Per-color ICC converter supplied by a runtime engine (desktop/WASM). */
export type IccColorConverter = (color: ManagedColor, destMode: ColorMode) => ManagedColor | null;

export interface ConvertColorModeOptions {
  algorithm?: ColorConversionAlgorithm;
  /** Required when algorithm === 'icc'. Returns null when unconvertible. */
  iccConverter?: IccColorConverter;
}

/** Structured report of a document color conversion. */
export interface ColorConversionReport {
  /** Process colors rewritten by the conversion. */
  converted: number;
  /** Spot references preserved untouched (spot inks are not converted). */
  spotsPreserved: number;
  /** Values left as-is (registration, unresolved, unsupported ICC). */
  unsupported: number;
  warnings: string[];
}

type NormalizedRgb = { r: number; g: number; b: number; a: number };

function colorBitDepth(color: ManagedColor): BitDepth {
  return 'bitDepth' in color ? (color.bitDepth ?? 'uint8') : 'uint8';
}

function rgbToCmykNormalized(rgb: NormalizedRgb): { c: number; m: number; y: number; k: number } {
  const k = 1 - Math.max(rgb.r, rgb.g, rgb.b);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 1 };
  const denominator = 1 - k;
  return {
    c: (1 - rgb.r - k) / denominator,
    m: (1 - rgb.g - k) / denominator,
    y: (1 - rgb.b - k) / denominator,
    k,
  };
}

function cmykToRgbNormalized(c: number, m: number, y: number, k: number): NormalizedRgb {
  return { r: (1 - c) * (1 - k), g: (1 - m) * (1 - k), b: (1 - y) * (1 - k), a: 1 };
}

function luminanceNormalized(rgb: NormalizedRgb): number {
  return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
}

/**
 * Resolve any analytical process colour into normalized encoded sRGB. This
 * path is deliberately profile-free and therefore only used for the clearly
 * labelled analytical fallback; ICC conversions take the provider path.
 */
function normalizedRgbFromColor(color: ManagedColor): NormalizedRgb | null {
  const bitDepth = colorBitDepth(color);
  switch (color.space) {
    case 'rgb':
      return {
        r: normalizeChannel(color.r, bitDepth),
        g: normalizeChannel(color.g, bitDepth),
        b: normalizeChannel(color.b, bitDepth),
        a: normalizeChannel(color.a, bitDepth),
      };
    case 'cmyk': {
      const rgb = cmykToRgbNormalized(
        normalizeChannel(color.c, bitDepth),
        normalizeChannel(color.m, bitDepth),
        normalizeChannel(color.y, bitDepth),
        normalizeChannel(color.k, bitDepth),
      );
      return { ...rgb, a: normalizeChannel(color.a, bitDepth) };
    }
    case 'gray': {
      const v = normalizeChannel(color.v, bitDepth);
      return { r: v, g: v, b: v, a: normalizeChannel(color.a, bitDepth) };
    }
    case 'lab': {
      const [r, g, b] = labToRgb(color.l, color.av, color.b);
      return { r: r / 255, g: g / 255, b: b / 255, a: normalizeChannel(color.a, bitDepth) };
    }
    case 'lch': {
      const [r, g, b] = lchToRgb(color.l, color.c, color.h);
      return { r: r / 255, g: g / 255, b: b / 255, a: normalizeChannel(color.a, bitDepth) };
    }
    case 'spot':
    case 'registration':
    case 'unresolved':
      return null;
  }
}

function makeRgbColor(rgb: NormalizedRgb, config: ColorConfig): ManagedColor {
  const bitDepth = config.bitDepth;
  return {
    space: 'rgb',
    bitDepth,
    r: denormalizeChannel(rgb.r, bitDepth),
    g: denormalizeChannel(rgb.g, bitDepth),
    b: denormalizeChannel(rgb.b, bitDepth),
    a: denormalizeChannel(rgb.a, bitDepth),
    profile: config.rgbProfile.id,
  };
}

function makeCmykColor(rgb: NormalizedRgb, config: ColorConfig): ManagedColor {
  const bitDepth = config.bitDepth;
  const cmyk = rgbToCmykNormalized(rgb);
  return {
    space: 'cmyk',
    bitDepth,
    c: denormalizeChannel(cmyk.c, bitDepth),
    m: denormalizeChannel(cmyk.m, bitDepth),
    y: denormalizeChannel(cmyk.y, bitDepth),
    k: denormalizeChannel(cmyk.k, bitDepth),
    a: denormalizeChannel(rgb.a, bitDepth),
    profile: config.cmykProfile.id,
  };
}

function makeGrayColor(rgb: NormalizedRgb, bitDepth: BitDepth): ManagedColor {
  const v = luminanceNormalized(rgb);
  return {
    space: 'gray',
    bitDepth,
    v: denormalizeChannel(v, bitDepth),
    a: denormalizeChannel(rgb.a, bitDepth),
  };
}

/**
 * Analytical conversion of a single color into `newMode`. Spot, registration,
 * and unresolved colors are never rewritten.
 */
function convertColorAnalytical(
  color: ManagedColor,
  newMode: ColorMode,
  destinationConfig: ColorConfig,
  report: ColorConversionReport,
): ManagedColor {
  if (color.space === 'spot') {
    report.spotsPreserved++;
    return color;
  }
  if (color.space === 'registration' || color.space === 'unresolved') {
    report.unsupported++;
    return color;
  }

  if (newMode === 'rgb' && color.space === 'rgb') return color;
  if (newMode === 'cmyk' && color.space === 'cmyk') return color;
  if (newMode === 'grayscale' && color.space === 'gray') return color;

  const rgb = normalizedRgbFromColor(color);
  if (!rgb) {
    report.unsupported++;
    return color;
  }
  report.converted++;
  if (newMode === 'rgb') return makeRgbColor(rgb, destinationConfig);
  if (newMode === 'cmyk') return makeCmykColor(rgb, destinationConfig);
  return makeGrayColor(rgb, destinationConfig.bitDepth);
}

function updateColorConfig(config: ColorConfig | undefined, newMode: ColorMode): ColorConfig {
  if (!config) return { ...defaultColorConfig(newMode), mode: newMode };
  // Preserve bitDepth and workingSpace — mode change is not a precision or
  // blending change.
  return { ...config, mode: newMode };
}

function walkAndConvert(
  node: SceneNode,
  newMode: ColorMode,
  convertColor: (c: ManagedColor, mode: ColorMode) => ManagedColor,
): SceneNode {
  let updated = { ...node, fill: convertColor(node.fill, newMode) };

  if ('strokes' in updated && updated.strokes) {
    updated = {
      ...updated,
      strokes: updated.strokes.map((s: Stroke) => ({
        ...s,
        color: convertColor(s.color, newMode),
      })),
    } as SceneNode;
  }

  if ('effects' in updated && updated.effects) {
    updated = {
      ...updated,
      effects: updated.effects.map((e: Effect) => {
        if ('color' in e && e.color) {
          return { ...e, color: convertColor(e.color as ManagedColor, newMode) } as Effect;
        }
        return e;
      }),
    } as SceneNode;
  }

  if ('fills' in updated && updated.fills) {
    updated = {
      ...updated,
      fills: updated.fills.map((f: Fill) => ({
        ...f,
        color: f.color ? convertColor(f.color, newMode) : f.color,
        gradient: f.gradient
          ? {
              ...f.gradient,
              stops: f.gradient.stops.map((gs: GradientStop) => ({
                ...gs,
                color: convertColor(gs.color, newMode),
              })),
            }
          : f.gradient,
      })),
    } as SceneNode;
  }

  return updated;
}

/**
 * Assign a color mode without rewriting stored values. Existing colors keep
 * their space and are interpreted under the new mode at read boundaries.
 * This is a document-intent change; it may alter appearance.
 */
export function assignDocumentColorMode(doc: Document, newMode: ColorMode): Document {
  if (doc.colorConfig?.mode === newMode) return doc;
  return { ...doc, colorConfig: updateColorConfig(doc.colorConfig, newMode) };
}

/**
 * Convert stored process colors into `newMode`. Explicit, cancellable (by
 * caller), and undoable through the normal transaction system.
 *
 * - Analytical algorithm is the honest browser fallback (approximate).
 * - ICC algorithm requires `options.iccConverter`; without it the conversion
 *   is skipped with an 'icc-unavailable' warning rather than silently
 *   degrading to formulas.
 */
export function convertDocumentColors(
  doc: Document,
  newMode: ColorMode,
  options: ConvertColorModeOptions = {},
): { doc: Document; report: ColorConversionReport } {
  const algorithm = options.algorithm ?? 'analytical';
  const report: ColorConversionReport = {
    converted: 0,
    spotsPreserved: 0,
    unsupported: 0,
    warnings: [],
  };

  if (doc.colorConfig?.mode === newMode) {
    report.warnings.push('document is already in the target mode');
    return { doc, report };
  }

  if (algorithm === 'icc' && !options.iccConverter) {
    report.warnings.push(
      'icc conversion requested but no ICC converter is available; conversion skipped',
    );
    return { doc, report };
  }

  const destinationConfig = updateColorConfig(doc.colorConfig, newMode);

  const convertColor: (c: ManagedColor, mode: ColorMode) => ManagedColor =
    algorithm === 'icc'
      ? (c, mode) => options.iccConverter!(c, mode) ?? c
      : (c, mode) => convertColorAnalytical(c, mode, destinationConfig, report);

  const nodes: Record<string, SceneNode> = {};
  for (const [id, node] of Object.entries(doc.nodes)) {
    nodes[id] = walkAndConvert(node, newMode, convertColor);
  }

  let swatches = doc.swatches;
  if (swatches) {
    swatches = swatches.map((s) => ({ ...s, color: convertColor(s.color, newMode) }));
  }

  let canvasBackground = doc.canvasBackground;
  if (canvasBackground && canvasBackground.space !== 'spot') {
    canvasBackground = convertColor(canvasBackground, newMode);
  }

  if (algorithm === 'analytical') {
    report.warnings.push(
      'analytical conversion is approximate; profile-accurate conversion requires the ICC engine (desktop/WASM)',
    );
  }

  return {
    doc: {
      ...doc,
      nodes,
      swatches,
      canvasBackground,
      colorConfig: destinationConfig,
    },
    report,
  };
}

/**
 * @deprecated Ambiguous: this performs ANALYTICAL CONVERSION of stored
 * values. Call `assignDocumentColorMode` when the intent is to change the
 * document's working mode without rewriting values, or
 * `convertDocumentColors` when rewriting values is intended. Kept for
 * backward compatibility with callers and tests predating the split.
 */
export function switchColorMode(doc: Document, newMode: ColorMode): Document {
  return convertDocumentColors(doc, newMode).doc;
}

/**
 * Set the document's default bit depth for newly authored colors.
 *
 * This changes document settings only — existing color VALUES are not
 * rewritten (that would be a precision-conversion operation, which is a
 * separate explicit workflow). uint16/float documents author new colors at
 * the stated depth via the picker's precision-aware fields.
 */
export function setDocumentBitDepth(doc: Document, bitDepth: BitDepth): Document {
  const config = colorConfigWithDefaults(doc.colorConfig);
  if (config.bitDepth === bitDepth) return doc;
  return { ...doc, colorConfig: { ...config, bitDepth } };
}

/**
 * Set the document's authored working RGB encoding ('srgb' or 'linear').
 * This does not change the separate artistic blend evaluation policy or
 * rewrite authored values.
 */
export function setDocumentWorkingSpace(doc: Document, workingSpace: WorkingSpace): Document {
  const config = colorConfigWithDefaults(doc.colorConfig);
  if (config.workingSpace === workingSpace) return doc;
  return { ...doc, colorConfig: { ...config, workingSpace } };
}

/** Set artistic blend evaluation without changing the authored working space. */
export function setDocumentBlendEvaluationSpace(
  doc: Document,
  blendEvaluationSpace: BlendEvaluationSpace,
): Document {
  const config = colorConfigWithDefaults(doc.colorConfig);
  if (config.blendEvaluationSpace === blendEvaluationSpace) return doc;
  return { ...doc, colorConfig: { ...config, blendEvaluationSpace } };
}

/** Set the default interpolation space used by newly authored/inherited gradients. */
export function setDocumentGradientInterpolation(
  doc: Document,
  interpolation: GradientInterpolationSpace,
): Document {
  const config = colorConfigWithDefaults(doc.colorConfig);
  if (config.defaultGradientInterpolation === interpolation) return doc;
  return { ...doc, colorConfig: { ...config, defaultGradientInterpolation: interpolation } };
}
