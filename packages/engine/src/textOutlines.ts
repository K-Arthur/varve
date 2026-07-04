/**
 * Text-to-outlines conversion utility.
 *
 * Converts editable text into vector path representations. This is a
 * non-destructive operation: the original TextNode is preserved as a hidden
 * source, and the outlines are rendered as a separate group.
 *
 * In the browser/Canvas2D environment, we cannot extract glyph path data from
 * fonts directly (Canvas2D does not expose glyph outlines). This module
 * provides the type infrastructure and a placeholder conversion that produces
 * bounding-box rectangles for each glyph. A full implementation requires
 * either opentype.js (web) or ab_glyph (native Rust engine) to extract actual
 * bezier path data from font files.
 *
 * Research basis: Figma "Outline text", Illustrator "Create Outlines",
 * opentype.js glyph path extraction, ab_glyph Rust crate.
 */

import type { PathPoint } from './types';

/** A single glyph outline represented as a series of path points. */
export interface GlyphOutline {
  char: string;
  /** Path points describing the glyph outline (bezier-compatible). */
  points: PathPoint[];
  /** Bounding box of the glyph. */
  bounds: { x: number; y: number; w: number; h: number };
  /** Advance width to the next glyph. */
  advance: number;
}

/** Result of converting text to outlines. */
export interface TextOutlineResult {
  /** One outline per character in the input text. */
  glyphs: GlyphOutline[];
  /** Total bounds of all glyphs. */
  bounds: { x: number; y: number; w: number; h: number };
  /** Whether the outlines are real glyph paths (true) or bounding-box placeholders (false). */
  isPlaceholder: boolean;
}

export interface TextOutlineOptions {
  fontSize: number;
  fontFamily: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  letterSpacing?: number;
  /** X origin for the text. */
  x?: number;
  /** Y origin (baseline) for the text. */
  y?: number;
}

/**
 * Convert text to vector outlines.
 *
 * Without a font parsing library, this produces bounding-box rectangles
 * as placeholder outlines. When a real font parser is available (opentype.js
 * or ab_glyph), this function should be replaced with actual glyph path
 * extraction.
 *
 * The placeholder approach is useful for:
 * - Export pipelines that need approximate text bounds
 * - Print preflight that needs to check text coverage
 * - Visual debugging of text layout
 */
export function textToOutlines(text: string, options: TextOutlineOptions): TextOutlineResult {
  const fs = options.fontSize;
  const ls = options.letterSpacing ?? 0;
  const x0 = options.x ?? 0;
  const y0 = options.y ?? 0;
  const weight = options.fontWeight ?? 400;
  const style = options.fontStyle ?? 'normal';

  const glyphs: GlyphOutline[] = [];
  let cursorX = x0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? '';

    if (char === '\n') {
      cursorX = x0;
      continue;
    }

    const advance = estimateGlyphAdvance(char, fs, weight, style);
    const glyphW = advance;
    const glyphH = fs;
    const glyphY = y0 - fs * 0.8;

    const points: PathPoint[] = [
      { x: cursorX, y: glyphY, handleIn: null, handleOut: null },
      { x: cursorX + glyphW, y: glyphY, handleIn: null, handleOut: null },
      { x: cursorX + glyphW, y: glyphY + glyphH, handleIn: null, handleOut: null },
      { x: cursorX, y: glyphY + glyphH, handleIn: null, handleOut: null },
    ];

    glyphs.push({
      char,
      points,
      bounds: { x: cursorX, y: glyphY, w: glyphW, h: glyphH },
      advance,
    });

    cursorX += advance + ls;
  }

  const bounds = {
    x: x0,
    y: y0 - fs,
    w: cursorX - x0,
    h: fs * 1.2,
  };

  return {
    glyphs,
    bounds,
    isPlaceholder: true,
  };
}

/** Estimate glyph advance width without a real font. */
function estimateGlyphAdvance(
  char: string,
  fontSize: number,
  _weight: number,
  _style: string,
): number {
  if (char === ' ') return fontSize * 0.3;
  if (char === '\t') return fontSize * 1.2;
  if (char.charCodeAt(0) > 0x4e00 && char.charCodeAt(0) < 0x9fff) return fontSize * 1.0;
  return fontSize * 0.6;
}

/**
 * Convert a GlyphOutline to an SVG path string.
 * For placeholder outlines, this produces a rectangle path.
 */
export function glyphOutlineToSvgPath(glyph: GlyphOutline): string {
  const pts = glyph.points;
  if (pts.length === 0) return '';
  const first = pts[0] ?? { x: 0, y: 0, handleIn: null, handleOut: null };
  let path = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i] ?? { x: 0, y: 0, handleIn: null, handleOut: null };
    path += ` L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }
  path += ' Z';
  return path;
}

/**
 * Convert a full TextOutlineResult to an SVG `<g>` element string.
 */
export function textOutlinesToSvg(
  result: TextOutlineResult,
  fill: string = 'currentColor',
): string {
  const paths = result.glyphs
    .map((g) => `  <path d="${glyphOutlineToSvgPath(g)}" fill="${fill}"/>`)
    .join('\n');
  return `<g>\n${paths}\n</g>`;
}
