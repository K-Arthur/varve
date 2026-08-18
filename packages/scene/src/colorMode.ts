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

import { cmykToRgb, labToRgb, lchToRgb, rgbToCmyk } from '@varve/shared';
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
import type { Effect, Fill, GradientStop, SceneNode, Stroke } from './types';

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

function luminance(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/** Analytical RGB<->CMYK (0-255 scale) — single source: @varve/shared. */
function rgbToCmykChannels(
  r: number,
  g: number,
  b: number,
): { c: number; m: number; y: number; k: number } {
  const [c, m, y, k] = rgbToCmyk(r, g, b);
  return { c, m, y, k };
}

function cmykToRgbChannels(
  c: number,
  m: number,
  y: number,
  k: number,
): { r: number; g: number; b: number } {
  const [r, g, b] = cmykToRgb(c, m, y, k);
  return { r, g, b };
}

/**
 * Analytical conversion of a single color into `newMode`. Spot, registration,
 * and unresolved colors are never rewritten.
 */
function convertColorAnalytical(
  color: ManagedColor,
  newMode: ColorMode,
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

  // Lab/LCH reduce to sRGB first so every mode conversion has one entry point.
  if (color.space === 'lab' || color.space === 'lch') {
    return convertColorAnalytical(rgbFromLabOrLch(color), newMode, report);
  }

  if (newMode === 'rgb') {
    if (color.space === 'rgb') return color;
    if (color.space === 'cmyk') {
      const { r, g, b } = cmykToRgbChannels(color.c, color.m, color.y, color.k);
      report.converted++;
      return withProfile({ space: 'rgb', r, g, b, a: color.a }, color);
    }
    if (color.space === 'gray') {
      const v = color.v;
      report.converted++;
      return withProfile({ space: 'rgb', r: v, g: v, b: v, a: color.a }, color);
    }
  }
  if (newMode === 'cmyk') {
    if (color.space === 'cmyk') return color;
    if (color.space === 'rgb') {
      const { c, m, y, k } = rgbToCmykChannels(color.r, color.g, color.b);
      report.converted++;
      return withProfile({ space: 'cmyk', c, m, y, k, a: color.a }, color);
    }
    if (color.space === 'gray') {
      const k = Math.round((1 - color.v / 255) * 255);
      report.converted++;
      return withProfile({ space: 'cmyk', c: 0, m: 0, y: 0, k, a: color.a }, color);
    }
  }
  if (newMode === 'grayscale') {
    if (color.space === 'gray') return color;
    if (color.space === 'rgb') {
      const v = luminance(color.r, color.g, color.b);
      report.converted++;
      return withProfile({ space: 'gray', v, a: color.a }, color);
    }
    if (color.space === 'cmyk') {
      const { c, m, y, k } = color;
      const r = Math.round(255 * (1 - c / 255) * (1 - k / 255));
      const g = Math.round(255 * (1 - m / 255) * (1 - k / 255));
      const b = Math.round(255 * (1 - y / 255) * (1 - k / 255));
      const v = luminance(r, g, b);
      report.converted++;
      return withProfile({ space: 'gray', v, a: color.a }, color);
    }
  }
  return color;
}

/** Lab/LCH → rgb ManagedColor via the canonical shared conversion. */
function rgbFromLabOrLch(color: ManagedColor): ManagedColor {
  let rgb: [number, number, number];
  if (color.space === 'lab') {
    rgb = labToRgb(color.l, color.av, color.b);
  } else if (color.space === 'lch') {
    rgb = lchToRgb(color.l, color.c, color.h);
  } else {
    throw new Error(`expected lab or lch, got ${color.space}`);
  }
  const profile = 'profile' in color ? color.profile : undefined;
  const profileFingerprint = 'profileFingerprint' in color ? color.profileFingerprint : undefined;
  return {
    space: 'rgb',
    r: rgb[0],
    g: rgb[1],
    b: rgb[2],
    a: color.a,
    profile,
    profileFingerprint,
  };
}

function withProfile<T extends { a: number }>(result: T, source: ManagedColor): T {
  if ('profile' in source && source.profile) {
    return { ...result, profile: source.profile } as T;
  }
  return result;
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

  const convertColor: (c: ManagedColor, mode: ColorMode) => ManagedColor =
    algorithm === 'icc'
      ? (c, mode) => options.iccConverter!(c, mode) ?? c
      : (c, mode) => convertColorAnalytical(c, mode, report);

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
      colorConfig: updateColorConfig(doc.colorConfig, newMode),
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
