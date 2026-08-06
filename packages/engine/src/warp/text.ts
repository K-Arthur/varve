/**
 * Text warp: derive per-cluster affine adjustments from a warp evaluation so
 * editable text renders warped without ever converting it to outlines.
 *
 * The renderer (replay `drawClusters`) already applies per-cluster
 * glyphAdjustments: translate, rotate, scale, applied around each cluster's
 * layout origin. This module computes those adjustments from the warp's
 * Jacobian at each cluster's source position — the same approach as
 * `@varve/scene` `warpGlyph`.
 *
 * Scope (documented): single visual line of plain text in LTR or non-RTL
 * auto direction, point or area mode, no rich text, no path text, no case
 * transform, no tabs/wrapping. Anything else returns `unsupported` so the
 * caller can warn instead of silently mis-warping.
 */

import type { GlyphAdjustmentIR } from '../types';
import type { WarpEvaluation } from './geometry';

export interface WarpTextOptions {
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  letterSpacing?: number;
  tracking?: number;
  /** Text box width (area text) or measured width (point text). */
  w: number;
  h: number;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  direction?: 'auto' | 'ltr' | 'rtl';
  /** Measure one grapheme cluster's advance (defaults to proportional). */
  measure?: (cluster: string, index: number) => number;
}

export interface WarpTextResult {
  /** Cluster-index → adjustment, keyed like the scene glyphAdjustments. */
  adjustments: Record<number, GlyphAdjustmentIR>;
  /** Reason when the text cannot be warp-rendered; null when supported. */
  unsupported: string | null;
  /** Total shaped width of the line. */
  lineWidth: number;
}

export function splitGraphemesText(text: string): string[] {
  // Minimal UAX#29 surrogate-pair + combining-mark clustering (the engine's
  // shared text pipeline is used where available; this mirrors splitGraphemes).
  const clusters: string[] = [];
  let current = '';
  for (const ch of text) {
    if (current === '') {
      current = ch;
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    const prev = current.codePointAt(current.length - 1) ?? 0;
    const combining =
      (code >= 0x0300 && code <= 0x036f) ||
      (code >= 0x1ab0 && code <= 0x1aff) ||
      (code >= 0xfe20 && code <= 0xfe2f);
    const mark =
      (code >= 0x0590 && code <= 0x08ff) ||
      (code >= 0x0e00 && code <= 0x0fff) ||
      (code >= 0x0d00 && code <= 0x0d7f) ||
      (code >= 0x0900 && code <= 0x097f);
    const zwj = code === 0x200d;
    const prevHigh = prev >= 0xd800 && prev <= 0xdbff;
    const isLow = code >= 0xdc00 && code <= 0xdfff;
    if (combining || mark || zwj || (prevHigh && isLow)) {
      current += ch;
    } else {
      clusters.push(current);
      current = ch;
    }
  }
  if (current !== '') clusters.push(current);
  return clusters;
}

/** Create a measure function backed by a scratch canvas context (null-safe). */
export function createClusterMeasure(
  fontSize: number,
  fontFamily: string,
): (cluster: string) => number {
  const fallback = (cluster: string) => Math.max(fontSize * 0.55 * cluster.length, 1);
  try {
    if (typeof document === 'undefined') return fallback;
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return fallback;
    ctx.font = `${fontSize}px "${fontFamily}"`;
    return (cluster) => ctx.measureText(cluster).width;
  } catch {
    return fallback;
  }
}

const EPS = 1e-6;

/**
 * Compute per-cluster glyph adjustments for a warp evaluation.
 * `evalWarp.sourceBounds` is the text's local box; clusters are laid out
 * along the baseline with per-grapheme advances.
 */
export function warpTextToClusterAdjustments(
  opts: WarpTextOptions,
  evalWarp: WarpEvaluation,
): WarpTextResult {
  const empty: WarpTextResult = { adjustments: {}, unsupported: null, lineWidth: 0 };
  if (!opts.text || opts.text.trim() === '') return empty;
  if (opts.direction === 'rtl') {
    return {
      adjustments: {},
      unsupported: 'RTL text is not warp-rendered in this version',
      lineWidth: 0,
    };
  }
  if (opts.text.includes('\n')) {
    return {
      adjustments: {},
      unsupported: 'multi-line text is not warp-rendered in this version',
      lineWidth: 0,
    };
  }
  if (opts.text.includes('\t')) {
    return {
      adjustments: {},
      unsupported: 'tabs are not warp-rendered in this version',
      lineWidth: 0,
    };
  }

  const clusters = splitGraphemesText(opts.text);
  const measure = opts.measure ?? createClusterMeasure(opts.fontSize, opts.fontFamily);
  const letterSpacing = opts.letterSpacing ?? 0;
  const trackingAdvance = ((opts.tracking ?? 0) / 1000) * opts.fontSize;
  const lineHeight = opts.h;
  const baselineY = lineHeight * 0.5; // top baseline: glyph vertical center ≈ h/2

  const advances: number[] = [];
  let width = 0;
  for (let ci = 0; ci < clusters.length; ci++) {
    const a = measure(clusters[ci]!, ci) + letterSpacing + trackingAdvance;
    advances.push(a);
    width += a;
  }

  // center/right align shift the line start; justify behaves as left here.
  const startX =
    opts.textAlign === 'right'
      ? opts.w - width
      : opts.textAlign === 'center'
        ? (opts.w - width) / 2
        : 0;

  const adjustments: Record<number, GlyphAdjustmentIR> = {};
  let cursorX = startX;
  for (let ci = 0; ci < clusters.length; ci++) {
    const advance = advances[ci]!;
    const cx = cursorX + advance / 2;
    const cy = baselineY;
    const mapped = evalWarp.map(cx, cy);
    // The renderer translates the cluster start to (cursorX + dx, y + dy);
    // choosing dx/dy so the cluster's center lands on the warped position.
    const dx = mapped[0] - cursorX - advance / 2;
    const dy = mapped[1] - cy;
    const jac = evalWarp.jacobian(cx, cy);
    const rotation = Math.atan2(jac.dydu, jac.dxdu);
    const scaleX = Math.max(0.05, Math.min(20, Math.hypot(jac.dxdu, jac.dydu)));
    const scaleY = Math.max(0.05, Math.min(20, Math.hypot(jac.dxdv, jac.dydv)));
    if (
      Math.abs(dx) > EPS ||
      Math.abs(dy) > EPS ||
      Math.abs(rotation) > 1e-9 ||
      Math.abs(scaleX - 1) > 1e-6 ||
      Math.abs(scaleY - 1) > 1e-6
    ) {
      adjustments[ci] = {
        dx,
        dy,
        advance: 0,
        rotation,
        scaleX,
        scaleY,
      };
    }
    cursorX += advance;
  }

  return { adjustments, unsupported: null, lineWidth: width };
}
